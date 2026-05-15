const elements = {
  adminStatus: document.querySelector("#adminStatus"),
  activeJob: document.querySelector("#activeJob"),
  waitingCount: document.querySelector("#waitingCount"),
  jobCount: document.querySelector("#jobCount"),
  jobTable: document.querySelector("#jobTable"),
  refreshButton: document.querySelector("#refreshButton"),
  saveModelsButton: document.querySelector("#saveModelsButton"),
  savePromptsButton: document.querySelector("#savePromptsButton"),
  promptList: document.querySelector("#promptList"),
  defaultVoiceSelect: document.querySelector("#defaultVoiceSelect"),
  setDefaultVoiceButton: document.querySelector("#setDefaultVoiceButton"),
  voiceCloneForm: document.querySelector("#voiceCloneForm"),
  voiceList: document.querySelector("#voiceList"),
  adminMessage: document.querySelector("#adminMessage")
};

let settings = null;

elements.refreshButton.addEventListener("click", loadAdminState);
elements.saveModelsButton.addEventListener("click", saveModels);
elements.savePromptsButton.addEventListener("click", savePrompts);
elements.setDefaultVoiceButton.addEventListener("click", setDefaultVoice);
elements.voiceCloneForm.addEventListener("submit", uploadVoiceClone);
document.querySelectorAll("[data-test-model]").forEach((button) => {
  button.addEventListener("click", () => testModel(button.dataset.testModel));
});

loadAdminState();
window.setInterval(loadQueueState, 1200);

async function loadAdminState() {
  clearMessage();
  try {
    const [queueData, settingsData] = await Promise.all([
      fetchJson("/api/admin/queue"),
      fetchJson("/api/admin/settings")
    ]);
    settings = settingsData;
    elements.adminStatus.textContent = "在线";
    renderQueue(queueData);
    renderSettings(settingsData);
  } catch (error) {
    elements.adminStatus.textContent = "异常";
    showMessage(error.message);
  }
}

async function loadQueueState() {
  try {
    const queueData = await fetchJson("/api/admin/queue");
    renderQueue(queueData);
  } catch {
    elements.adminStatus.textContent = "异常";
  }
}

function renderQueue(data) {
  const jobs = data.jobs ?? [];
  elements.activeJob.textContent = data.queue?.activeJobId ? shortId(data.queue.activeJobId) : "无";
  elements.waitingCount.textContent = String(data.queue?.waitingCount ?? 0);
  elements.jobCount.textContent = String(jobs.length);
  renderJobs(jobs);
}

function renderSettings(nextSettings) {
  fillModelFields("llm", nextSettings.models.llm);
  fillModelFields("image", nextSettings.models.image);
  fillModelFields("tts", nextSettings.models.tts);
  document.querySelector("#ttsCloneEnabled").checked = Boolean(nextSettings.models.tts.cloneEnabled);
  renderPrompts(nextSettings.prompts ?? []);
  renderVoices(nextSettings.voices ?? [], nextSettings.models.tts.defaultVoiceId);
}

function fillModelFields(prefix, model) {
  document.querySelector(`#${prefix}Enabled`).checked = Boolean(model.enabled);
  document.querySelector(`#${prefix}Provider`).value = model.provider ?? "";
  document.querySelector(`#${prefix}BaseUrl`).value = model.baseUrl ?? "";
  const apiKeyInput = document.querySelector(`#${prefix}ApiKey`);
  apiKeyInput.value = "";
  apiKeyInput.placeholder = model.hasApiKey ? "已保存，留空不修改" : "";
  document.querySelector(`#${prefix}Model`).value = model.model ?? "";
  setValueIfExists(`#${prefix}Size`, model.size);
  setValueIfExists(`#${prefix}Quality`, model.quality);
  setValueIfExists(`#${prefix}OutputFormat`, model.outputFormat ?? model.output_format);
  setValueIfExists(`#${prefix}Background`, model.background);
  setValueIfExists(`#${prefix}CloneModel`, model.cloneModel);
  setValueIfExists(`#${prefix}CloneTargetModel`, model.cloneTargetModel);
  setValueIfExists(`#${prefix}LanguageType`, model.languageType);
}

function renderPrompts(prompts) {
  elements.promptList.innerHTML = prompts
    .map(
      (prompt) => `
        <article class="prompt-item">
          <div class="prompt-head">
            <strong>${escapeHtml(prompt.name)}</strong>
            <span>${escapeHtml(prompt.id)}</span>
          </div>
          <p>${escapeHtml(prompt.description || "")}</p>
          <textarea class="prompt-textarea" data-prompt-id="${escapeHtml(prompt.id)}">${escapeHtml(prompt.prompt || "")}</textarea>
        </article>
      `
    )
    .join("");
}

function renderVoices(voices, defaultVoiceId) {
  elements.defaultVoiceSelect.innerHTML = voices
    .map((voice) => `<option value="${escapeHtml(voice.id)}">${escapeHtml(voice.name)} / ${voice.type}</option>`)
    .join("");
  elements.defaultVoiceSelect.value = defaultVoiceId;

  elements.voiceList.innerHTML = voices
    .map(
      (voice) => `
        <article class="voice-row">
          <span>
            <strong>${escapeHtml(voice.name)}</strong>
            <small>${voice.id === defaultVoiceId ? "默认音色" : voice.type}</small>
          </span>
          <span>${escapeHtml(voice.status)}</span>
          <span>${voice.type === "cloned" ? `${Math.round((voice.size || 0) / 1024)} KB` : "内置"}</span>
        </article>
      `
    )
    .join("");
}

async function saveModels() {
  clearMessage();
  const payload = readModelsPayload();

  try {
    settings = await fetchJson("/api/admin/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    renderSettings(settings);
    showMessage("模型配置已保存。", false);
  } catch (error) {
    showMessage(error.message);
  }
}

async function testModel(kind) {
  clearMessage();
  try {
    const result = await fetchJson("/api/admin/models/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        ...readModelsPayload()
      })
    });
    showMessage(`${result.kind}: ${result.message} (${result.latencyMs}ms)`, !result.ok);
  } catch (error) {
    showMessage(error.message);
  }
}

function readModelsPayload() {
  return {
    models: {
      llm: readModelFields("llm"),
      image: readImageFields(),
      tts: readTtsFields()
    }
  };
}

function readModelFields(prefix) {
  return {
    enabled: document.querySelector(`#${prefix}Enabled`).checked,
    provider: document.querySelector(`#${prefix}Provider`).value,
    baseUrl: document.querySelector(`#${prefix}BaseUrl`).value.trim(),
    apiKey: document.querySelector(`#${prefix}ApiKey`).value.trim(),
    model: document.querySelector(`#${prefix}Model`).value.trim()
  };
}

function readImageFields() {
  return {
    ...readModelFields("image"),
    size: document.querySelector("#imageSize").value.trim() || "1536x864",
    quality: document.querySelector("#imageQuality").value,
    outputFormat: document.querySelector("#imageOutputFormat").value,
    background: document.querySelector("#imageBackground").value,
    count: 1,
    fallbackLocal: true
  };
}

function readTtsFields() {
  return {
    ...readModelFields("tts"),
    cloneEnabled: document.querySelector("#ttsCloneEnabled").checked,
    defaultVoiceId: elements.defaultVoiceSelect.value,
    cloneModel: document.querySelector("#ttsCloneModel").value.trim() || "qwen-voice-enrollment",
    cloneTargetModel: document.querySelector("#ttsCloneTargetModel").value.trim() || "qwen3-tts-vc-2026-01-22",
    languageType: document.querySelector("#ttsLanguageType").value,
    cloneLanguage: document.querySelector("#ttsLanguageType").value === "English" ? "en" : "zh",
    fallbackLocal: true
  };
}

function setValueIfExists(selector, value) {
  const element = document.querySelector(selector);
  if (element && value !== undefined && value !== null) {
    element.value = value;
  }
}

async function savePrompts() {
  clearMessage();
  const prompts = [...document.querySelectorAll(".prompt-textarea")].map((textarea) => ({
    id: textarea.dataset.promptId,
    prompt: textarea.value
  }));

  try {
    settings = await fetchJson("/api/admin/prompts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompts })
    });
    renderSettings(settings);
    showMessage("提示词已保存。", false);
  } catch (error) {
    showMessage(error.message);
  }
}

async function setDefaultVoice() {
  clearMessage();
  try {
    settings = await fetchJson("/api/admin/voices/default", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voiceId: elements.defaultVoiceSelect.value })
    });
    renderSettings(settings);
    showMessage("默认音色已更新。", false);
  } catch (error) {
    showMessage(error.message);
  }
}

async function uploadVoiceClone(event) {
  event.preventDefault();
  clearMessage();

  const formData = new FormData(elements.voiceCloneForm);
  formData.set("authorized", elements.voiceCloneForm.elements.authorized.checked ? "true" : "false");

  try {
    const result = await fetchJson("/api/admin/voices/clone", {
      method: "POST",
      body: formData
    });
    settings = result.settings;
    elements.voiceCloneForm.reset();
    renderSettings(settings);
    showMessage("克隆音色已创建，并设为默认音色。", false);
  } catch (error) {
    showMessage(error.message);
  }
}

function renderJobs(jobs) {
  if (!jobs.length) {
    elements.jobTable.innerHTML = `<p class="hint">暂无任务。</p>`;
    return;
  }

  elements.jobTable.innerHTML = `
    <div class="job-row job-head">
      <span>任务</span>
      <span>模板</span>
      <span>阶段</span>
      <span>分析</span>
      <span>进度</span>
      <span>产物</span>
    </div>
    ${jobs
      .map(
        (job) => `
          <article class="job-row">
            <span>
              <strong>${shortId(job.id)}</strong>
              <small>${formatTime(job.createdAt)}</small>
            </span>
            <span>${escapeHtml(job.templateName || job.templateId)}</span>
            <span>
              <b class="badge ${job.status}">${statusText(job.status)}</b>
              <small>${escapeHtml(job.stage || "")}</small>
            </span>
            <span>
              <b class="badge">${escapeHtml(job.analysis?.source || "local")}</b>
              <small>${escapeHtml(job.analysis?.model || job.modelSnapshot?.llm?.model || "")}</small>
            </span>
            <span>
              <div class="mini-track"><i style="width:${Number(job.progress || 0)}%"></i></div>
              <small>${Number(job.progress || 0)}%</small>
            </span>
            <span>${renderArtifact(job)}</span>
          </article>
        `
      )
      .join("")}
  `;
}

function renderArtifact(job) {
  if (job.videoUrl) {
    return `<a class="ghost-link inline" href="${job.videoUrl}" target="_blank" rel="noreferrer">视频</a>`;
  }

  if (job.error) {
    return `<small class="error">${escapeHtml(job.error)}</small>`;
  }

  return `<small>生成中</small>`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload;
}

function shortId(id) {
  return String(id).slice(0, 8);
}

function statusText(status) {
  return {
    queued: "排队",
    running: "运行",
    completed: "完成",
    failed: "失败"
  }[status] ?? "未知";
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function showMessage(message, isError = true) {
  elements.adminMessage.textContent = message;
  elements.adminMessage.classList.toggle("success", !isError);
}

function clearMessage() {
  elements.adminMessage.textContent = "";
  elements.adminMessage.classList.remove("success");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
