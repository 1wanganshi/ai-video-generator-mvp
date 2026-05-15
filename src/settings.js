import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot, readJson, writeJson } from "./storage.js";
import { createAliyunVoiceClone } from "./aliyun-tts.js";

const settingsFileName = "settings.json";
const voicesDirName = "voices";

let cachedSettings = null;

export async function loadSettings() {
  const settingsPath = getSettingsPath();
  const existing = await readJson(settingsPath).catch(() => null);
  cachedSettings = normalizeSettings(existing ?? createDefaultSettings());
  await persistSettings();
  return clone(cachedSettings);
}

export async function getSettings() {
  if (!cachedSettings) {
    await loadSettings();
  }
  return clone(cachedSettings);
}

export async function updateModels(modelsPatch) {
  if (!cachedSettings) {
    await loadSettings();
  }

  for (const key of ["llm", "image", "tts"]) {
    if (!modelsPatch?.[key]) {
      continue;
    }

    cachedSettings.models[key] = {
      ...cachedSettings.models[key],
      ...pickDefined(stripEmptyApiKey(modelsPatch[key]))
    };
  }

  cachedSettings.updatedAt = new Date().toISOString();
  await persistSettings();
  return clone(cachedSettings);
}

export async function updatePrompts(promptPatch) {
  if (!cachedSettings) {
    await loadSettings();
  }

  const incomingPrompts = Array.isArray(promptPatch?.prompts) ? promptPatch.prompts : [];
  for (const incoming of incomingPrompts) {
    const existing = cachedSettings.prompts.find((prompt) => prompt.id === incoming.id);
    if (!existing) {
      continue;
    }

    existing.prompt = String(incoming.prompt ?? existing.prompt);
    existing.updatedAt = new Date().toISOString();
  }

  cachedSettings.updatedAt = new Date().toISOString();
  await persistSettings();
  return clone(cachedSettings);
}

export async function updateContentModules(modulePatch) {
  if (!cachedSettings) {
    await loadSettings();
  }

  const incomingModules = Array.isArray(modulePatch?.modules) ? modulePatch.modules : [];
  for (const incoming of incomingModules) {
    const normalized = normalizeIncomingContentModule(incoming);
    const existing = cachedSettings.contentModules.find((module) => module.id === normalized.id);

    if (existing) {
      Object.assign(existing, normalized, {
        updatedAt: new Date().toISOString()
      });
    } else {
      cachedSettings.contentModules.push({
        ...normalized,
        updatedAt: new Date().toISOString()
      });
    }
  }

  if (modulePatch?.activeModuleId) {
    const activeModule = cachedSettings.contentModules.find(
      (module) => module.id === modulePatch.activeModuleId && module.enabled
    );
    if (!activeModule) {
      throw new Error("短视频模块不存在或未启用。");
    }
    cachedSettings.activeContentModuleId = activeModule.id;
  }

  cachedSettings.updatedAt = new Date().toISOString();
  await persistSettings();
  return clone(cachedSettings);
}

export async function addClonedVoice({ name, authorized, file }) {
  if (!cachedSettings) {
    await loadSettings();
  }

  if (!authorized) {
    throw new Error("必须确认已获得声音样本授权，才能创建克隆音色。");
  }

  if (!cachedSettings.models.tts.cloneEnabled) {
    throw new Error("后台未启用音色克隆。");
  }

  if (!file?.buffer?.length) {
    throw new Error("请上传一段声音样本。");
  }

  if (file.buffer.length > 25 * 1024 * 1024) {
    throw new Error("声音样本不能超过 25MB。");
  }

  const id = `voice_${crypto.randomUUID()}`;
  const safeName = String(name || "克隆音色").trim().slice(0, 40);
  const extension = safeExtension(file.filename);
  const voicesDir = getVoicesDir();
  await mkdir(voicesDir, { recursive: true });

  const samplePath = path.join(voicesDir, `${id}${extension}`);
  await writeFile(samplePath, file.buffer);
  const ttsConfig = cachedSettings.models.tts;
  const providerClone =
    ttsConfig.provider === "aliyun-dashscope" && ttsConfig.apiKey
      ? await createAliyunVoiceClone({
          modelConfig: ttsConfig,
          name: safeName,
          file,
          text: cachedSettings.prompts.find((prompt) => prompt.id === "tts")?.prompt
        })
      : null;

  if (ttsConfig.provider === "aliyun-dashscope" && !ttsConfig.apiKey && ttsConfig.fallbackLocal === false) {
    throw new Error("当前选择阿里 TTS，但未填写 DashScope API Key。");
  }

  const voice = {
    id,
    name: safeName || "克隆音色",
    type: "cloned",
    status: "ready",
    provider: providerClone?.provider ?? "local-preview",
    providerVoiceId: providerClone?.providerVoiceId ?? null,
    targetModel: providerClone?.targetModel ?? null,
    cloneRequestId: providerClone?.requestId ?? null,
    fallbackMode: providerClone?.fallbackMode ?? false,
    fallbackReason: providerClone?.fallbackReason ?? null,
    authorized: true,
    sourceFileName: file.filename || "voice-sample",
    mimeType: file.mimeType || "application/octet-stream",
    size: file.buffer.length,
    samplePath,
    baseFrequency: 180 + Math.floor(Math.random() * 120),
    createdAt: new Date().toISOString()
  };

  cachedSettings.voices.push(voice);
  cachedSettings.models.tts.defaultVoiceId = voice.id;
  cachedSettings.updatedAt = new Date().toISOString();
  await persistSettings();

  return clone(voice);
}

export async function setDefaultVoice(voiceId) {
  if (!cachedSettings) {
    await loadSettings();
  }

  const voice = cachedSettings.voices.find((item) => item.id === voiceId);
  if (!voice) {
    throw new Error("音色不存在。");
  }

  cachedSettings.models.tts.defaultVoiceId = voice.id;
  cachedSettings.updatedAt = new Date().toISOString();
  await persistSettings();
  return clone(cachedSettings);
}

function normalizeSettings(settings) {
  const defaults = createDefaultSettings();
  const image = { ...defaults.models.image, ...settings?.models?.image };
  if (image.provider === "openai-compatible" && image.model === "gpt-image-1" && !image.apiKey) {
    Object.assign(image, defaults.models.image);
  }

  return {
    ...defaults,
    ...settings,
    models: {
      llm: { ...defaults.models.llm, ...settings?.models?.llm },
      image,
      tts: { ...defaults.models.tts, ...settings?.models?.tts }
    },
    prompts: mergePrompts(defaults.prompts, settings?.prompts),
    contentModules: mergeContentModules(defaults.contentModules, settings?.contentModules),
    activeContentModuleId:
      settings?.activeContentModuleId && settings?.contentModules?.some((module) => module.id === settings.activeContentModuleId)
        ? settings.activeContentModuleId
        : defaults.activeContentModuleId,
    voices: mergeVoices(defaults.voices, settings?.voices),
    updatedAt: settings?.updatedAt ?? defaults.updatedAt
  };
}

function mergePrompts(defaultPrompts, prompts) {
  if (!Array.isArray(prompts)) {
    return defaultPrompts;
  }

  return defaultPrompts.map((defaultPrompt) => ({
    ...defaultPrompt,
    ...(prompts.find((prompt) => prompt.id === defaultPrompt.id) ?? {})
  }));
}

function mergeVoices(defaultVoices, voices) {
  if (!Array.isArray(voices)) {
    return defaultVoices;
  }

  const seen = new Set();
  return [...defaultVoices, ...voices].filter((voice) => {
    if (seen.has(voice.id)) {
      return false;
    }
    seen.add(voice.id);
    return true;
  });
}

function mergeContentModules(defaultModules, modules) {
  if (!Array.isArray(modules)) {
    return defaultModules;
  }

  const mergedDefaults = defaultModules.map((defaultModule) => ({
    ...defaultModule,
    ...(modules.find((module) => module.id === defaultModule.id) ?? {})
  }));
  const customModules = modules.filter((module) => !defaultModules.some((defaultModule) => defaultModule.id === module.id));
  return [...mergedDefaults, ...customModules];
}

function normalizeIncomingContentModule(module) {
  const id = String(module?.id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 48);

  if (!id) {
    throw new Error("短视频模块缺少 ID。");
  }

  const name = String(module?.name ?? "").trim() || id;

  return {
    id,
    enabled: Boolean(module?.enabled),
    name,
    description: String(module?.description ?? ""),
    templateId: String(module?.templateId ?? "zen"),
    frontTitle: String(module?.frontTitle ?? name),
    frontSubtitle: String(module?.frontSubtitle ?? ""),
    defaultText: String(module?.defaultText ?? ""),
    prompt: String(module?.prompt ?? "")
  };
}

function createDefaultSettings() {
  const now = new Date().toISOString();
  return {
    models: {
      llm: {
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "",
        model: "gpt-4o-mini",
        enabled: false
      },
      image: {
        provider: "image2",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
        model: "gpt-image-2",
        enabled: false,
        size: "1536x864",
        quality: "high",
        outputFormat: "png",
        background: "auto",
        count: 1,
        fallbackLocal: true
      },
      tts: {
        provider: "local-ffmpeg",
        baseUrl: "https://dashscope.aliyuncs.com/api/v1",
        apiKey: "",
        model: "local-preview-voice",
        enabled: true,
        cloneEnabled: true,
        defaultVoiceId: "default-narrator",
        cloneModel: "qwen-voice-enrollment",
        cloneTargetModel: "qwen3-tts-vc-2026-01-22",
        languageType: "Chinese",
        cloneLanguage: "zh",
        fallbackLocal: true
      }
    },
    prompts: [
      {
        id: "storyboard",
        name: "分镜拆解提示词",
        description: "把用户输入拆成结构化分镜 JSON。",
        prompt:
          "你是视频分镜导演。把用户文本拆成 3-8 个分镜。每个分镜输出 visualDescription、narration、subtitle、duration，duration 默认 3 秒。画面描述要适配所选模板风格，并保持统一色调。",
        updatedAt: now
      },
      {
        id: "image",
        name: "图片生成提示词",
        description: "把单个分镜扩写成图片模型提示词。",
        prompt:
          "根据分镜 visualDescription 生成一张 16:9 图片。保持同一视频内角色、画风、色调、光线一致。避免文字、水印、畸形手部和低清晰度。",
        updatedAt: now
      },
      {
        id: "tts",
        name: "TTS 旁白提示词",
        description: "约束旁白语气、停顿和音色克隆使用。",
        prompt:
          "把 narration 合成为自然口播。语速稳定，停顿清晰，不夸张表演。若使用克隆音色，只使用已授权声音样本，并保持原声音色特征。",
        updatedAt: now
      }
    ],
    activeContentModuleId: "guoxue",
    contentModules: [
      {
        id: "guoxue",
        name: "国学",
        enabled: true,
        templateId: "guofeng",
        frontTitle: "国学短视频",
        frontSubtitle: "经典智慧、修身处世、东方审美，适合做沉稳、有余味的知识短视频。",
        description: "面向国学、传统文化、修身处世内容。",
        defaultText:
          "人这一生，最难的不是懂很多道理，而是在起心动念处看见自己。能收住一分急躁，就多一分从容；能少一分计较，就多一分天地。",
        prompt:
          "内容模块：国学。分镜要围绕经典智慧、修身处世、东方审美展开。语言要克制、含蓄、有余味，避免鸡汤和玄学化表达。画面可使用古籍、山水、书房、竹影、烛火、云气、宣纸质感等意象。字幕要像短视频金句，但不要夸张。",
        updatedAt: now
      },
      {
        id: "maoxuan",
        name: "毛选",
        enabled: true,
        templateId: "mao",
        frontTitle: "毛选短视频",
        frontSubtitle: "矛盾分析、实践方法、组织视角，适合做有力量的观点型短视频。",
        description: "面向毛选、方法论、实践论、矛盾论内容。",
        defaultText:
          "很多问题不是没有答案，而是没有回到实际情况里去看。脱离调查，就容易被表象牵着走；回到实践，矛盾的主次才会慢慢显出来。",
        prompt:
          "内容模块：毛选。分镜要强调实践、调查研究、矛盾分析、主要矛盾、群众视角和行动方法。语言要坚定、清楚、有组织性，避免空泛口号。画面可使用红色海报质感、笔记、会议桌、工厂、田野、队伍、阳光和强对比构图。",
        updatedAt: now
      },
      {
        id: "ai_business",
        name: "AI 商业",
        enabled: true,
        templateId: "tech",
        frontTitle: "AI 商业短视频",
        frontSubtitle: "产品、效率、增长、自动化，适合做清晰直接的商业解释型短视频。",
        description: "面向 AI 产品、商业效率、自动化和增长内容。",
        defaultText:
          "AI 真正改变业务的地方，不是替代某一个岗位，而是把重复流程变成可复制的系统。谁先把流程跑通，谁就先拿到效率红利。",
        prompt:
          "内容模块：AI 商业。分镜要突出系统、流程、数据、效率、增长、自动化和产品化。语言要具体、可执行、商业感强。画面可使用深色科技界面、数据面板、流程图、团队协作、发光网格、玻璃质感等元素。",
        updatedAt: now
      }
    ],
    voices: [
      {
        id: "default-narrator",
        name: "默认旁白",
        type: "default",
        status: "ready",
        authorized: true,
        baseFrequency: 220,
        createdAt: now
      }
    ],
    updatedAt: now
  };
}

async function persistSettings() {
  await writeJson(getSettingsPath(), cachedSettings);
}

function getSettingsPath() {
  return path.join(getStorageRoot(), settingsFileName);
}

function getVoicesDir() {
  return path.join(getStorageRoot(), voicesDirName);
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function stripEmptyApiKey(value) {
  if (!value || value.apiKey !== "") {
    return value;
  }

  const { apiKey, ...rest } = value;
  return rest;
}

function safeExtension(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  if ([".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"].includes(extension)) {
    return extension;
  }
  return ".audio";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
