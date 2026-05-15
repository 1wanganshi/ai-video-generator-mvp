import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg.js";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";
const DEFAULT_CLONE_MODEL = "qwen-voice-enrollment";
const DEFAULT_TTS_MODEL = "qwen3-tts-vc-2026-01-22";

export async function createAliyunVoiceClone({ modelConfig, name, file, text }) {
  assertAliyunConfig(modelConfig);

  const cloneModel = modelConfig.cloneModel || DEFAULT_CLONE_MODEL;
  const targetModel = modelConfig.cloneTargetModel || modelConfig.model || DEFAULT_TTS_MODEL;
  const endpoint = `${normalizeBaseUrl(modelConfig.baseUrl)}/services/audio/tts/customization`;
  const preferredName = sanitizePreferredName(name);
  const input =
    cloneModel === "qwen-voice-enrollment"
      ? {
          action: "create",
          target_model: targetModel,
          preferred_name: preferredName,
          audio: {
            data: toAudioDataUrl(file)
          },
          language: modelConfig.cloneLanguage || "zh"
        }
      : {
          action: "create_voice",
          target_model: targetModel,
          prefix: preferredName.slice(0, 10),
          url: modelConfig.samplePublicUrl,
          language_hints: [modelConfig.cloneLanguage || "zh"]
        };

  if (text && cloneModel === "qwen-voice-enrollment") {
    input.text = String(text).slice(0, 600);
  }

  if (cloneModel === "voice-enrollment" && !input.url) {
    throw new Error("CosyVoice 复刻需要公网可访问的音频 URL；当前本地上传请选择 Qwen 声音复刻。");
  }

  const payload = await postJson(endpoint, modelConfig.apiKey, {
    model: cloneModel,
    input
  });

  const providerVoiceId = payload.output?.voice ?? payload.output?.voice_id;
  if (!providerVoiceId) {
    throw new Error("阿里 TTS 声音复刻响应缺少 voice/voice_id。");
  }

  return {
    provider: "aliyun-dashscope",
    providerVoiceId,
    targetModel: payload.output?.target_model ?? targetModel,
    requestId: payload.request_id,
    fallbackMode: payload.output?.fallback_mode ?? false,
    fallbackReason: payload.output?.fallback_reason ?? null
  };
}

export async function synthesizeAliyunNarration({ scenes, modelConfig, voice, prompt, outputPath }) {
  assertAliyunConfig(modelConfig);

  const text = scenes.map((scene) => scene.narration).join("\n");
  const endpoint = `${normalizeBaseUrl(modelConfig.baseUrl)}/services/aigc/multimodal-generation/generation`;
  const providerVoice = voice.providerVoiceId || voice.voice || modelConfig.voice || "Cherry";
  const payload = await postJson(endpoint, modelConfig.apiKey, {
    model: modelConfig.model || voice.targetModel || DEFAULT_TTS_MODEL,
    input: {
      text: text.slice(0, Number(modelConfig.maxTextLength || 600)),
      voice: providerVoice,
      language_type: modelConfig.languageType || "Chinese",
      ...(prompt ? { instructions: prompt.slice(0, 1600) } : {}),
      ...(modelConfig.optimizeInstructions ? { optimize_instructions: true } : {})
    }
  });

  const audio = payload.output?.audio;
  if (!audio?.url && !audio?.data) {
    throw new Error("阿里 TTS 响应缺少 output.audio.url/data。");
  }

  const rawPath = path.join(path.dirname(outputPath), "aliyun-tts-source.audio");
  if (audio.data) {
    await writeFile(rawPath, Buffer.from(audio.data, "base64"));
  } else {
    const response = await fetch(audio.url);
    if (!response.ok) {
      throw new Error(`下载阿里 TTS 音频失败：HTTP ${response.status}`);
    }
    await writeFile(rawPath, Buffer.from(await response.arrayBuffer()));
  }

  await runFfmpeg([
    "-y",
    "-i",
    path.resolve(rawPath),
    "-ar",
    "44100",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    path.resolve(outputPath)
  ]);

  return {
    provider: "aliyun-dashscope",
    model: modelConfig.model || DEFAULT_TTS_MODEL,
    voiceId: voice.id,
    voiceName: voice.name,
    voiceType: voice.type,
    providerVoiceId: providerVoice,
    requestId: payload.request_id,
    audioId: audio.id,
    sourceUrl: audio.url ?? null,
    expiresAt: audio.expires_at ?? null,
    usage: payload.usage ?? null
  };
}

export async function testAliyunTts(modelConfig) {
  assertAliyunConfig(modelConfig);
  const endpoint = `${normalizeBaseUrl(modelConfig.baseUrl)}/services/audio/tts/customization`;
  const payload = await postJson(endpoint, modelConfig.apiKey, {
    model: modelConfig.cloneModel || DEFAULT_CLONE_MODEL,
    input: {
      action: modelConfig.cloneModel === "voice-enrollment" ? "list_voice" : "list",
      page_size: 1,
      page_index: 0
    }
  });

  return {
    ok: true,
    message: `阿里 TTS 连接成功，request_id=${payload.request_id ?? "unknown"}`
  };
}

function assertAliyunConfig(modelConfig) {
  if (!modelConfig.apiKey) {
    throw new Error("请先填写阿里百炼 DashScope API Key。");
  }
}

async function postJson(endpoint, apiKey, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.code) {
    throw new Error(payload.message || `阿里接口返回 HTTP ${response.status}`);
  }
  return payload;
}

function toAudioDataUrl(file) {
  const mimeType = normalizeMimeType(file.mimeType, file.filename);
  return `data:${mimeType};base64,${file.buffer.toString("base64")}`;
}

function normalizeMimeType(mimeType, filename) {
  if (["audio/wav", "audio/mpeg", "audio/mp4"].includes(mimeType)) {
    return mimeType;
  }

  const extension = path.extname(String(filename || "")).toLowerCase();
  if (extension === ".wav") {
    return "audio/wav";
  }
  if (extension === ".mp3") {
    return "audio/mpeg";
  }
  if (extension === ".m4a" || extension === ".mp4") {
    return "audio/mp4";
  }

  throw new Error("阿里 Qwen 声音复刻仅支持 wav、mp3、m4a/mp4 音频样本。");
}

function sanitizePreferredName(value) {
  const ascii = String(value || "myvoice")
    .normalize("NFKD")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  return ascii || "myvoice";
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}
