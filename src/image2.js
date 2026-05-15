import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-2";
const WIDTH = 1280;
const HEIGHT = 720;

export async function generateImage2({ prompt, modelConfig, outputPath }) {
  if (!modelConfig.apiKey) {
    throw new Error("请先填写 image2 API Key。");
  }

  const endpoint = `${normalizeBaseUrl(modelConfig.baseUrl)}/images/generations`;
  const body = {
    model: modelConfig.model || DEFAULT_MODEL,
    prompt,
    n: Number(modelConfig.count || 1)
  };

  for (const key of ["size", "quality", "background", "output_format"]) {
    const value = modelConfig[key] ?? modelConfig[toCamelCase(key)];
    if (value) {
      body[key] = value;
    }
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${modelConfig.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(modelConfig.timeoutMs || 120000))
  });

  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    throw new Error(payload.error?.message || `image2 返回 HTTP ${response.status}`);
  }

  const image = payload.data?.[0];
  if (!image?.b64_json && !image?.url) {
    throw new Error("image2 响应缺少 data[0].b64_json/url。");
  }

  const rawPath = `${outputPath}.image2-source`;
  if (image.b64_json) {
    await writeFile(rawPath, Buffer.from(image.b64_json, "base64"));
  } else {
    const download = await fetch(image.url);
    if (!download.ok) {
      throw new Error(`下载 image2 图片失败：HTTP ${download.status}`);
    }
    await writeFile(rawPath, Buffer.from(await download.arrayBuffer()));
  }

  await normalizeImage(rawPath, outputPath);

  return {
    provider: "image2",
    model: body.model,
    size: body.size ?? "auto",
    quality: body.quality ?? "auto",
    outputFormat: body.output_format ?? "auto",
    revisedPrompt: image.revised_prompt ?? null
  };
}

export async function testImage2(modelConfig) {
  if (!modelConfig.apiKey) {
    throw new Error("请先填写 image2 API Key。");
  }

  const endpoint = `${normalizeBaseUrl(modelConfig.baseUrl)}/models/${encodeURIComponent(modelConfig.model || DEFAULT_MODEL)}`;
  const response = await fetch(endpoint, {
    headers: {
      authorization: `Bearer ${modelConfig.apiKey}`
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`image2 模型检查返回 HTTP ${response.status}`);
  }

  return {
    ok: true,
    message: "image2 连接成功。"
  };
}

async function normalizeImage(inputPath, outputPath) {
  await runFfmpeg([
    "-y",
    "-i",
    path.resolve(inputPath),
    "-vf",
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},format=rgb24`,
    "-frames:v",
    "1",
    path.resolve(outputPath)
  ]);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function toCamelCase(value) {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
