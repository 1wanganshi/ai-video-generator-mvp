import { createStoryboard } from "./storyboard.js";
import { testAliyunTts } from "./aliyun-tts.js";
import { testImage2 } from "./image2.js";

const DEFAULT_TIMEOUT_MS = 30000;

export async function analyzeStoryboard({ text, template, settings }) {
  const prompt = getPrompt(settings, "storyboard");
  const llm = settings.models.llm;

  if (!llm.enabled) {
    return {
      scenes: createStoryboard(text, template),
      analysis: {
        source: "local",
        reason: "llm-disabled",
        promptId: "storyboard"
      }
    };
  }

  try {
    const scenes = await createStoryboardWithOpenAICompatible({
      text,
      template,
      prompt,
      modelConfig: llm
    });

    return {
      scenes,
      analysis: {
        source: "llm",
        provider: llm.provider,
        model: llm.model,
        promptId: "storyboard"
      }
    };
  } catch (error) {
    return {
      scenes: createStoryboard(text, template),
      analysis: {
        source: "local-fallback",
        provider: llm.provider,
        model: llm.model,
        promptId: "storyboard",
        error: error.message
      }
    };
  }
}

export async function testModelConnection({ kind, settings }) {
  const startedAt = Date.now();
  const modelConfig = settings.models[kind];

  if (!modelConfig) {
    throw new Error("模型类型不存在。");
  }

  if (kind === "tts" && modelConfig.provider === "local-ffmpeg") {
    return {
      ok: true,
      kind,
      provider: modelConfig.provider,
      model: modelConfig.model,
      latencyMs: Date.now() - startedAt,
      message: "本地 TTS 预览适配器可用。"
    };
  }

  if (kind === "tts" && modelConfig.provider === "aliyun-dashscope") {
    const result = await testAliyunTts(modelConfig);
    return {
      ok: result.ok,
      kind,
      provider: modelConfig.provider,
      model: modelConfig.model,
      latencyMs: Date.now() - startedAt,
      message: result.message
    };
  }

  if (!modelConfig.enabled) {
    return {
      ok: false,
      kind,
      provider: modelConfig.provider,
      model: modelConfig.model,
      latencyMs: Date.now() - startedAt,
      message: "该模型未启用。"
    };
  }

  if (!modelConfig.baseUrl) {
    return {
      ok: false,
      kind,
      provider: modelConfig.provider,
      model: modelConfig.model,
      latencyMs: Date.now() - startedAt,
      message: "未填写 Base URL。"
    };
  }

  if (kind === "llm") {
    await callOpenAICompatibleChat({
      modelConfig,
      messages: [
        {
          role: "system",
          content: "Return only compact JSON."
        },
        {
          role: "user",
          content: "{\"ok\":true}"
        }
      ],
      temperature: 0
    });

    return {
      ok: true,
      kind,
      provider: modelConfig.provider,
      model: modelConfig.model,
      latencyMs: Date.now() - startedAt,
      message: "大模型连接成功。"
    };
  }

  if (kind === "image" && modelConfig.provider === "image2") {
    const result = await testImage2(modelConfig);
    return {
      ok: result.ok,
      kind,
      provider: modelConfig.provider,
      model: modelConfig.model,
      latencyMs: Date.now() - startedAt,
      message: result.message
    };
  }

  const response = await fetch(normalizeBaseUrl(modelConfig.baseUrl), {
    method: "GET",
    headers: buildAuthHeaders(modelConfig),
    signal: AbortSignal.timeout(10000)
  });

  return {
    ok: response.ok,
    kind,
    provider: modelConfig.provider,
    model: modelConfig.model,
    latencyMs: Date.now() - startedAt,
    message: response.ok ? "接口地址可访问。" : `接口返回 HTTP ${response.status}。`
  };
}

async function createStoryboardWithOpenAICompatible({ text, template, prompt, modelConfig }) {
  if (modelConfig.provider === "local") {
    throw new Error("本地大模型适配器未接入。");
  }

  if (!modelConfig.baseUrl || !modelConfig.model) {
    throw new Error("大模型 Base URL 或模型名未配置。");
  }

  const content = await callOpenAICompatibleChat({
    modelConfig,
    messages: [
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: [
          "请严格输出 JSON，不要输出 Markdown。",
          "JSON 格式：",
          "{\"scenes\":[{\"visualDescription\":\"\",\"narration\":\"\",\"subtitle\":\"\",\"duration\":3}]}",
          `视频模板：${template.name}`,
          `模板画风：${template.stylePrompt}`,
          `用户文本：${text}`
        ].join("\n")
      }
    ],
    temperature: 0.45,
    responseFormat: true
  });

  return normalizeScenes(parseJsonContent(content), template);
}

async function callOpenAICompatibleChat({ modelConfig, messages, temperature, responseFormat = false }) {
  const endpoint = toChatCompletionsEndpoint(modelConfig.baseUrl);
  const body = {
    model: modelConfig.model,
    messages,
    temperature
  };

  if (responseFormat) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...buildAuthHeaders(modelConfig)
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`大模型接口返回 HTTP ${response.status}: ${payloadText.slice(0, 240)}`);
  }

  const payload = JSON.parse(payloadText);
  const content = payload.choices?.[0]?.message?.content ?? payload.output_text;
  if (!content) {
    throw new Error("大模型响应缺少 message.content。");
  }

  return content;
}

function parseJsonContent(content) {
  const cleanContent = String(content)
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleanContent);
  } catch {
    const start = cleanContent.indexOf("{");
    const end = cleanContent.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("大模型没有返回可解析的 JSON。");
    }
    return JSON.parse(cleanContent.slice(start, end + 1));
  }
}

function normalizeScenes(payload, template) {
  const rawScenes = Array.isArray(payload) ? payload : payload.scenes;
  if (!Array.isArray(rawScenes) || rawScenes.length === 0) {
    throw new Error("大模型 JSON 中缺少 scenes 数组。");
  }

  return rawScenes.slice(0, 8).map((scene, index) => {
    const narration = String(scene.narration ?? scene.voiceover ?? scene.text ?? "").trim();
    const visualDescription = String(scene.visualDescription ?? scene.imagePrompt ?? scene.visual ?? "").trim();
    const subtitle = String(scene.subtitle ?? narration).trim();

    return {
      index: index + 1,
      duration: normalizeDuration(scene.duration),
      narration: narration || subtitle || `分镜 ${index + 1}`,
      subtitle: compactSubtitle(subtitle || narration || `分镜 ${index + 1}`),
      visualDescription: visualDescription || `${template.stylePrompt}; ${narration || subtitle}`,
      imageUrl: null
    };
  });
}

function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    return 3;
  }
  return Math.min(8, Math.max(2, Math.round(duration)));
}

function compactSubtitle(value) {
  const compact = String(value).replace(/\s+/g, "");
  return compact.length > 34 ? `${compact.slice(0, 34)}...` : compact;
}

function getPrompt(settings, id) {
  return settings.prompts.find((prompt) => prompt.id === id)?.prompt ?? "";
}

function toChatCompletionsEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? "").replace(/\/+$/, "");
}

function buildAuthHeaders(modelConfig) {
  if (!modelConfig.apiKey) {
    return {};
  }
  return {
    authorization: `Bearer ${modelConfig.apiKey}`
  };
}
