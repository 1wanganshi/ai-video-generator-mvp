import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { templates } from "./templates.js";
import { createJob, getJob, getQueueStatus, listJobs, loadPersistedJobs } from "./jobs.js";
import { ensureStorage } from "./storage.js";
import {
  addClonedVoice,
  getSettings,
  loadSettings,
  setDefaultVoice,
  updateContentModules,
  updateModels,
  updatePrompts
} from "./settings.js";
import { testModelConnection } from "./llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT ?? 5174);

await ensureStorage();
await loadSettings();
await loadPersistedJobs();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/templates") {
      return sendJson(response, { templates });
    }

    if (request.method === "GET" && url.pathname === "/api/content-module") {
      const settings = await getSettings();
      return sendJson(response, toPublicContentModuleSettings(settings));
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, {
        ok: true,
        service: "ai-video-generator-mvp",
        queue: getQueueStatus(),
        time: new Date().toISOString()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/queue") {
      return sendJson(response, {
        queue: getQueueStatus(),
        jobs: listJobs()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/admin/settings") {
      return sendJson(response, toAdminSettings(await getSettings()));
    }

    if (request.method === "PUT" && url.pathname === "/api/admin/models") {
      const payload = JSON.parse((await readBody(request, 1024 * 1024)) || "{}");
      return sendJson(response, toAdminSettings(await updateModels(payload.models ?? payload)));
    }

    if (request.method === "POST" && url.pathname === "/api/admin/models/test") {
      const payload = JSON.parse((await readBody(request, 1024 * 1024)) || "{}");
      const settings = await getSettings();
      const testSettings = payload.models
        ? {
            ...settings,
            models: {
              llm: mergeModelForTest(settings.models.llm, payload.models.llm),
              image: mergeModelForTest(settings.models.image, payload.models.image),
              tts: mergeModelForTest(settings.models.tts, payload.models.tts)
            }
          }
        : settings;
      return sendJson(response, await testModelConnection({ kind: String(payload.kind ?? "llm"), settings: testSettings }));
    }

    if (request.method === "PUT" && url.pathname === "/api/admin/prompts") {
      const payload = JSON.parse((await readBody(request, 1024 * 1024)) || "{}");
      return sendJson(response, toAdminSettings(await updatePrompts(payload)));
    }

    if (request.method === "PUT" && url.pathname === "/api/admin/content-modules") {
      const payload = JSON.parse((await readBody(request, 2 * 1024 * 1024)) || "{}");
      return sendJson(response, toAdminSettings(await updateContentModules(payload)));
    }

    if (request.method === "PUT" && url.pathname === "/api/admin/voices/default") {
      const payload = JSON.parse((await readBody(request, 128 * 1024)) || "{}");
      return sendJson(response, toAdminSettings(await setDefaultVoice(String(payload.voiceId ?? ""))));
    }

    if (request.method === "POST" && url.pathname === "/api/admin/voices/clone") {
      const form = await readMultipartForm(request, 26 * 1024 * 1024);
      const voice = await addClonedVoice({
        name: form.fields.name,
        authorized: form.fields.authorized === "true" || form.fields.authorized === "on",
        file: form.files.sample
      });
      return sendJson(response, { voice: toAdminVoice(voice), settings: toAdminSettings(await getSettings()) }, 201);
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      return sendJson(response, { jobs: listJobs() });
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      const job = getJob(id);
      if (!job) {
        return sendJson(response, { error: "任务不存在" }, 404);
      }
      return sendJson(response, job);
    }

    if (request.method === "POST" && url.pathname === "/api/jobs") {
      const body = await readBody(request, 512 * 1024);
      const payload = JSON.parse(body || "{}");
      const text = String(payload.text ?? "").trim();
      const templateId = payload.templateId ? String(payload.templateId) : null;
      const contentModuleId = payload.contentModuleId ? String(payload.contentModuleId) : null;

      if (text.length < 6) {
        return sendJson(response, { error: "请输入至少 6 个字的文本内容。" }, 400);
      }

      if (text.length > 2400) {
        return sendJson(response, { error: "MVP 暂时限制文本在 2400 字以内。" }, 400);
      }

      const job = await createJob({ text, templateId, contentModuleId });
      return sendJson(response, { jobId: job.id, job }, 202);
    }

    if (request.method === "GET") {
      return serveStatic(url.pathname, response);
    }

    sendJson(response, { error: "Method Not Allowed" }, 405);
  } catch (error) {
    sendJson(response, { error: error.message || "Internal Server Error" }, 500);
  }
});

server.listen(port, () => {
  console.log(`AI Video Generator MVP running at http://localhost:${port}`);
});

async function readBody(request, maxBytes = 2 * 1024 * 1024) {
  return (await readBuffer(request, maxBytes)).toString("utf8");
}

async function readBuffer(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("请求体过大。");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readMultipartForm(request, maxBytes) {
  const contentTypeHeader = request.headers["content-type"] ?? "";
  const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error("缺少 multipart boundary。");
  }

  const boundary = boundaryMatch[1] ?? boundaryMatch[2];
  const buffer = await readBuffer(request, maxBytes);
  return parseMultipart(buffer, boundary);
}

function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = {};
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    cursor += delimiter.length;

    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) {
      break;
    }

    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) {
      cursor += 2;
    }

    const next = buffer.indexOf(delimiter, cursor);
    if (next === -1) {
      break;
    }

    let part = buffer.slice(cursor, next);
    if (part.at(-2) === 13 && part.at(-1) === 10) {
      part = part.slice(0, -2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const rawHeaders = part.slice(0, headerEnd).toString("utf8");
      const body = part.slice(headerEnd + 4);
      const disposition = rawHeaders.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
      const name = disposition.match(/name="([^"]+)"/i)?.[1];
      const filename = disposition.match(/filename="([^"]*)"/i)?.[1];
      const mimeType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();

      if (name && filename !== undefined) {
        files[name] = {
          filename,
          mimeType,
          buffer: body
        };
      } else if (name) {
        fields[name] = body.toString("utf8");
      }
    }

    cursor = next;
  }

  return { fields, files };
}

async function serveStatic(urlPathname, response) {
  const pathname = decodeURIComponent(urlPathname === "/" ? "/index.html" : urlPathname);
  const targetPath = path.normalize(path.join(publicDir, pathname));

  if (!targetPath.startsWith(publicDir)) {
    return sendText(response, "Forbidden", 403, "text/plain; charset=utf-8");
  }

  try {
    const fileStat = await stat(targetPath);
    if (!fileStat.isFile()) {
      return sendText(response, "Not found", 404, "text/plain; charset=utf-8");
    }
    const file = await readFile(targetPath);
    response.writeHead(200, {
      "content-type": contentType(targetPath),
      "cache-control": targetPath.includes(`${path.sep}storage${path.sep}`) ? "public, max-age=3600" : "no-store"
    });
    response.end(file);
  } catch {
    sendText(response, "Not found", 404, "text/plain; charset=utf-8");
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, payload, status, contentTypeHeader) {
  response.writeHead(status, {
    "content-type": contentTypeHeader,
    "cache-control": "no-store"
  });
  response.end(payload);
}

function toAdminSettings(settings) {
  return {
    ...settings,
    models: Object.fromEntries(
      Object.entries(settings.models).map(([key, model]) => [
        key,
        {
          ...model,
          apiKey: "",
          hasApiKey: Boolean(model.apiKey)
        }
      ])
    ),
    voices: settings.voices.map(toAdminVoice)
  };
}

function mergeModelForTest(savedModel, modelPatch) {
  if (!modelPatch) {
    return savedModel;
  }

  const patch = { ...modelPatch };
  if (patch.apiKey === "") {
    delete patch.apiKey;
  }
  return { ...savedModel, ...patch };
}

function toPublicContentModuleSettings(settings) {
  const modules = (settings.contentModules ?? []).filter((module) => module.enabled).map(toPublicContentModule);
  const activeModule =
    modules.find((module) => module.id === settings.activeContentModuleId) ??
    modules[0] ??
    null;

  return {
    activeModuleId: activeModule?.id ?? null,
    activeModule,
    modules
  };
}

function toPublicContentModule(module) {
  return {
    id: module.id,
    name: module.name,
    description: module.description,
    templateId: module.templateId,
    promptSetId: module.promptSetId,
    frontTitle: module.frontTitle,
    frontSubtitle: module.frontSubtitle,
    defaultText: module.defaultText
  };
}

function toAdminVoice(voice) {
  const { samplePath, ...publicVoice } = voice;
  return publicVoice;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg"
  }[extension] ?? "application/octet-stream";
}
