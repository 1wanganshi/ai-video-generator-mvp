import crypto from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { getTemplate } from "./templates.js";
import { generateSceneImage } from "./image-generator.js";
import { composeVideo } from "./video-composer.js";
import { getSettings } from "./settings.js";
import { synthesizeNarration } from "./tts.js";
import { analyzeStoryboard } from "./llm.js";
import {
  createJobDirectory,
  getJobStoragePaths,
  getStorageRoot,
  readJson,
  toPublicUrl,
  writeJson
} from "./storage.js";

const jobs = new Map();
const queue = [];
let activeJobId = null;

const stages = {
  queued: "排队中",
  analyzing: "内容分析中",
  storyboard: "生成分镜",
  images: "生成图片",
  tts: "生成旁白中",
  composing: "合成视频中",
  completed: "完成",
  failed: "失败"
};

export async function loadPersistedJobs() {
  const entries = await readdir(getStorageRoot(), { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const jobPath = path.join(getStorageRoot(), entry.name, "job.json");
    const job = await readJson(jobPath).catch(() => null);
    if (!job?.id) {
      continue;
    }

    if (job.status === "running" || job.status === "queued") {
      job.status = "failed";
      job.stage = stages.failed;
      job.error = "服务重启后任务已中断，请重新提交。";
      job.updatedAt = new Date().toISOString();
      job.events = [
        ...(job.events ?? []),
        {
          time: job.updatedAt,
          status: job.status,
          stage: job.stage,
          progress: job.progress
        }
      ];
      await persistJobSnapshot(job);
    }

    jobs.set(job.id, job);
  }
}

export async function createJob({ text, templateId, contentModuleId }) {
  const id = crypto.randomUUID();
  const settings = await getSettings();
  const contentModule = resolveContentModule(settings, contentModuleId);
  const resolvedTemplateId = templateId || contentModule?.templateId || "zen";
  const template = getTemplate(resolvedTemplateId);
  await createJobDirectory(id);

  const now = new Date().toISOString();
  const job = {
    id,
    status: "queued",
    stage: stages.queued,
    progress: 0,
    sourceType: "text",
    queuePosition: queue.length + 1,
    templateId: template.id,
    templateName: template.name,
    contentModule: contentModule ? toJobContentModule(contentModule) : null,
    scenes: [],
    analysis: null,
    tts: null,
    modelSnapshot: null,
    videoUrl: null,
    downloadUrl: null,
    error: null,
    events: [
      {
        time: now,
        status: "queued",
        stage: stages.queued,
        progress: 0
      }
    ],
    createdAt: now,
    updatedAt: now
  };

  jobs.set(id, job);
  await persistJobSnapshot(job);

  const paths = getJobStoragePaths(id);
  queue.push({
    id,
    text,
    template,
    contentModule,
    ...paths
  });
  refreshQueuePositions();
  processQueue();

  return job;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getQueueStatus() {
  return {
    activeJobId,
    waitingCount: queue.length,
    waiting: queue.map((item, index) => {
      const job = jobs.get(item.id);
      return {
        jobId: item.id,
        position: index + 1,
        templateName: job?.templateName ?? "",
        stage: job?.stage ?? stages.queued,
        progress: job?.progress ?? 0
      };
    })
  };
}

function processQueue() {
  if (activeJobId || queue.length === 0) {
    return;
  }

  const next = queue.shift();
  activeJobId = next.id;
  refreshQueuePositions();

  runJob(next)
    .catch(async (error) => {
      const job = jobs.get(next.id);
      if (job) {
        await updateJob(job, {
          status: "failed",
          stage: stages.failed,
          progress: Math.max(job.progress, 1),
          error: error.message
        });
      }
    })
    .finally(() => {
      activeJobId = null;
      processQueue();
    });
}

async function runJob({ id, text, template, contentModule, jobDir, publicJobDir }) {
  const job = jobs.get(id);
  if (!job) {
    return;
  }

  try {
    await updateJob(job, {
      status: "running",
      queuePosition: 0,
      stage: stages.analyzing,
      progress: 8
    });

    await sleep(350);

    await updateJob(job, {
      stage: stages.storyboard,
      progress: 18
    });

    const settings = await getSettings();
    const currentContentModule = contentModule ?? resolveContentModule(settings);
    const moduleSettings = withCurrentContentModule(settings, currentContentModule);
    const analysisResult = await analyzeStoryboard({ text, template, settings: moduleSettings, contentModule: currentContentModule });
    const scenes = analysisResult.scenes;
    if (!scenes.length) {
      throw new Error("文本内容为空，无法生成分镜。");
    }

    await writeJson(path.join(jobDir, "storyboard.json"), {
      template,
      contentModule: currentContentModule ? toJobContentModule(currentContentModule) : null,
      analysis: analysisResult.analysis,
      scenes
    });
    await updateJob(job, {
      scenes,
      analysis: analysisResult.analysis,
      contentModule: currentContentModule ? toJobContentModule(currentContentModule) : null,
      progress: 22,
      modelSnapshot: {
        llm: {
          provider: moduleSettings.models.llm.provider,
          model: resolveLlmModelName(moduleSettings, currentContentModule),
          enabled: moduleSettings.models.llm.enabled
        },
        image: {
          provider: settings.models.image.provider,
          model: settings.models.image.model,
          enabled: settings.models.image.enabled
        },
        tts: {
          provider: settings.models.tts.provider,
          model: settings.models.tts.model,
          enabled: settings.models.tts.enabled,
          defaultVoiceId: settings.models.tts.defaultVoiceId
        },
        prompts: settings.prompts.map((prompt) => ({
          id: prompt.id,
          updatedAt: prompt.updatedAt
        })),
        contentModule: currentContentModule
          ? {
              id: currentContentModule.id,
              updatedAt: currentContentModule.updatedAt
            }
          : null
      }
    });

    const imagePaths = [];

    for (let index = 0; index < scenes.length; index += 1) {
      await updateJob(job, {
        stage: `生成图片第 ${index + 1}/${scenes.length} 张`,
        progress: 25 + Math.round((index / scenes.length) * 48)
      });

      const imagePath = path.join(publicJobDir, `scene-${String(index + 1).padStart(2, "0")}.png`);
      const imageResult = await generateSceneImage({
        scene: scenes[index],
        template,
        outputPath: imagePath,
        settings: moduleSettings,
        contentModule: currentContentModule
      });

      imagePaths.push(imagePath);
      scenes[index].imageUrl = toPublicUrl(imagePath);
      scenes[index].image = imageResult;
      await updateJob(job, {
        scenes: [...scenes],
        progress: 25 + Math.round(((index + 1) / scenes.length) * 48)
      });
    }

    await updateJob(job, {
      stage: stages.tts,
      progress: 78
    });

    const narrationAudioPath = path.join(jobDir, "narration.wav");
    const ttsResult = await synthesizeNarration({
      scenes,
      settings: moduleSettings,
      outputPath: narrationAudioPath
    });

    await updateJob(job, {
      tts: ttsResult,
      progress: 80
    });

    await updateJob(job, {
      stage: stages.composing,
      progress: 82
    });

    const outputPath = path.join(publicJobDir, "video.mp4");
    await composeVideo({
      scenes,
      imagePaths,
      outputPath,
      workDir: jobDir,
      narrationAudioPath: ttsResult?.path ?? null
    });

    const videoUrl = toPublicUrl(outputPath);
    await updateJob(job, {
      status: "completed",
      queuePosition: 0,
      stage: stages.completed,
      progress: 100,
      videoUrl,
      downloadUrl: videoUrl
    });
  } catch (error) {
    await updateJob(job, {
      status: "failed",
      queuePosition: 0,
      stage: stages.failed,
      progress: Math.max(job.progress, 1),
      error: error.message
    });
  }
}

async function updateJob(job, patch) {
  const now = new Date().toISOString();
  const shouldRecordEvent =
    patch.status !== undefined ||
    patch.stage !== undefined ||
    patch.progress !== undefined ||
    patch.error !== undefined;

  Object.assign(job, patch, {
    updatedAt: now
  });

  if (shouldRecordEvent) {
    job.events = [
      ...(job.events ?? []),
      {
        time: now,
        status: job.status,
        stage: job.stage,
        progress: job.progress
      }
    ].slice(-80);
  }

  await persistJobSnapshot(job);
}

function refreshQueuePositions() {
  queue.forEach((item, index) => {
    const job = jobs.get(item.id);
    if (job) {
      job.queuePosition = index + 1;
      job.updatedAt = new Date().toISOString();
    }
  });
}

function resolveContentModule(settings, moduleId = null) {
  const enabledModules = (settings.contentModules ?? []).filter((module) => module.enabled);
  return (
    enabledModules.find((module) => module.id === moduleId) ??
    enabledModules.find((module) => module.id === settings.activeContentModuleId) ??
    enabledModules[0] ??
    null
  );
}

function withCurrentContentModule(settings, contentModule) {
  return {
    ...settings,
    currentContentModule: contentModule
  };
}

function resolveLlmModelName(settings, contentModule) {
  return (
    (settings.llmPresets ?? []).find((preset) => preset.id === contentModule?.llmPresetId)?.model ??
    settings.models.llm.model
  );
}

function toJobContentModule(module) {
  return {
    id: module.id,
    name: module.name,
    templateId: module.templateId,
    frontTitle: module.frontTitle,
    llmPresetId: module.llmPresetId,
    voiceId: module.voiceId,
    promptSetId: module.promptSetId
  };
}

async function persistJobSnapshot(job) {
  const { jobDir } = getJobStoragePaths(job.id);
  await writeJson(path.join(jobDir, "job.json"), job);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
