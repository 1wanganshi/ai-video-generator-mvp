const state = {
  templates: [],
  contentModules: [],
  selectedContentModuleId: null,
  selectedTemplateId: "zen",
  currentJobId: null,
  pollTimer: null
};

const elements = {
  moduleTitle: document.querySelector("#moduleTitle"),
  moduleSubtitle: document.querySelector("#moduleSubtitle"),
  moduleCount: document.querySelector("#moduleCount"),
  moduleTabs: document.querySelector("#moduleTabs"),
  scriptText: document.querySelector("#scriptText"),
  charCount: document.querySelector("#charCount"),
  templateCount: document.querySelector("#templateCount"),
  templateGrid: document.querySelector("#templateGrid"),
  submitButton: document.querySelector("#submitButton"),
  errorMessage: document.querySelector("#errorMessage"),
  connectionStatus: document.querySelector("#connectionStatus"),
  stageLabel: document.querySelector("#stageLabel"),
  progressNumber: document.querySelector("#progressNumber"),
  progressBar: document.querySelector("#progressBar"),
  timeline: document.querySelector("#timeline"),
  videoPlayer: document.querySelector("#videoPlayer"),
  emptyPreview: document.querySelector("#emptyPreview"),
  downloadLink: document.querySelector("#downloadLink"),
  storyboardStrip: document.querySelector("#storyboardStrip")
};

const initialTimeline = [
  "内容分析中",
  "生成分镜",
  "生成图片",
  "生成旁白中",
  "合成视频中",
  "完成"
];

init();

async function init() {
  bindEvents();
  updateCharCount();
  renderTimeline("等待任务");
  await Promise.all([loadTemplates(), loadContentModules()]);
}

function bindEvents() {
  elements.scriptText.addEventListener("input", updateCharCount);
  elements.submitButton.addEventListener("click", submitJob);
}

async function loadTemplates() {
  try {
    const data = await fetchJson("/api/templates");
    state.templates = data.templates;
    elements.templateCount.textContent = `${state.templates.length} 个模板`;
    renderTemplates();
  } catch (error) {
    showError(error.message);
    elements.templateCount.textContent = "加载失败";
  }
}

async function loadContentModules() {
  try {
    const data = await fetchJson("/api/content-module");
    state.contentModules = data.modules ?? [];
    state.selectedContentModuleId = data.activeModuleId ?? state.contentModules[0]?.id ?? null;
    elements.moduleCount.textContent = `${state.contentModules.length} 个模块`;
    applySelectedContentModule({ replaceText: true });
    renderContentModules();
    renderTemplates();
  } catch (error) {
    showError(error.message);
    elements.moduleCount.textContent = "加载失败";
  }
}

function renderTemplates() {
  elements.templateGrid.innerHTML = "";

  for (const template of state.templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-card";
    button.setAttribute("aria-pressed", String(template.id === state.selectedTemplateId));
    button.innerHTML = `
      <div class="swatches">
        ${Object.values(template.colors)
          .slice(0, 4)
          .map((color) => `<i class="swatch" style="background:#${color}"></i>`)
          .join("")}
      </div>
      <strong>${escapeHtml(template.name)}</strong>
      <span>${escapeHtml(template.description)}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedTemplateId = template.id;
      renderTemplates();
    });
    elements.templateGrid.append(button);
  }
}

function renderContentModules() {
  elements.moduleTabs.innerHTML = "";

  for (const module of state.contentModules) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "content-module-tab";
    button.setAttribute("aria-pressed", String(module.id === state.selectedContentModuleId));
    button.innerHTML = `
      <strong>${escapeHtml(module.name)}</strong>
      <span>${escapeHtml(module.description || module.frontSubtitle || "")}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedContentModuleId = module.id;
      applySelectedContentModule({ replaceText: true });
      renderContentModules();
      renderTemplates();
    });
    elements.moduleTabs.append(button);
  }
}

function applySelectedContentModule({ replaceText = false } = {}) {
  const module = getSelectedContentModule();
  if (!module) {
    return;
  }

  elements.moduleTitle.textContent = module.frontTitle || module.name || "文字生成分镜视频";
  elements.moduleSubtitle.textContent = module.frontSubtitle || module.description || "";
  state.selectedTemplateId = module.templateId || state.selectedTemplateId;

  if (replaceText && module.defaultText) {
    elements.scriptText.value = module.defaultText;
    updateCharCount();
  }
}

async function submitJob() {
  clearError();
  const text = elements.scriptText.value.trim();

  if (text.length < 6) {
    showError("请输入至少 6 个字的文本内容。");
    return;
  }

  setBusy(true);
  resetPreview();
  updateProgress({ stage: "提交任务中", progress: 3, status: "running", scenes: [] });

  try {
    const data = await fetchJson("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        templateId: state.selectedTemplateId,
        contentModuleId: state.selectedContentModuleId
      })
    });

    state.currentJobId = data.jobId;
    pollJob();
    state.pollTimer = window.setInterval(pollJob, 900);
  } catch (error) {
    showError(error.message);
    setBusy(false);
    updateStatus("提交失败");
  }
}

async function pollJob() {
  if (!state.currentJobId) {
    return;
  }

  try {
    const job = await fetchJson(`/api/jobs/${state.currentJobId}`);
    updateProgress(job);
    renderStoryboard(job.scenes ?? []);

    if (job.status === "completed") {
      stopPolling();
      setBusy(false);
      showVideo(job.videoUrl, job.downloadUrl);
      updateStatus("已完成");
      return;
    }

    if (job.status === "failed") {
      stopPolling();
      setBusy(false);
      showError(job.error || "任务失败");
      updateStatus("失败");
    }
  } catch (error) {
    stopPolling();
    setBusy(false);
    showError(error.message);
    updateStatus("连接异常");
  }
}

function updateProgress(job) {
  const progress = Math.max(0, Math.min(100, Number(job.progress ?? 0)));
  elements.stageLabel.textContent = job.stage || "处理中";
  elements.progressNumber.textContent = `${progress}%`;
  elements.progressBar.style.width = `${progress}%`;
  updateStatus(statusText(job.status));
  renderTimeline(job.stage || "");
}

function renderTimeline(stage) {
  elements.timeline.innerHTML = "";
  for (const item of initialTimeline) {
    const li = document.createElement("li");
    li.className = stage.includes(item) ? "active" : "";
    li.textContent = item;
    elements.timeline.append(li);
  }
}

function renderStoryboard(scenes) {
  elements.storyboardStrip.innerHTML = "";

  for (const scene of scenes) {
    const card = document.createElement("article");
    card.className = "scene-thumb";
    card.innerHTML = `
      ${scene.imageUrl ? `<img src="${scene.imageUrl}" alt="分镜 ${scene.index}" />` : ""}
      <p>${escapeHtml(scene.index)}. ${escapeHtml(scene.subtitle || scene.narration || "")}</p>
    `;
    elements.storyboardStrip.append(card);
  }
}

function showVideo(videoUrl, downloadUrl) {
  elements.videoPlayer.src = videoUrl;
  elements.videoPlayer.classList.add("ready");
  elements.emptyPreview.classList.add("hidden");
  elements.downloadLink.href = downloadUrl || videoUrl;
  elements.downloadLink.classList.remove("disabled");
}

function resetPreview() {
  elements.videoPlayer.pause();
  elements.videoPlayer.removeAttribute("src");
  elements.videoPlayer.load();
  elements.videoPlayer.classList.remove("ready");
  elements.emptyPreview.classList.remove("hidden");
  elements.downloadLink.href = "#";
  elements.downloadLink.classList.add("disabled");
  elements.storyboardStrip.innerHTML = "";
}

function updateCharCount() {
  elements.charCount.textContent = `${elements.scriptText.value.length} / 2400`;
}

function getSelectedContentModule() {
  return state.contentModules.find((module) => module.id === state.selectedContentModuleId) ?? null;
}

function setBusy(isBusy) {
  elements.submitButton.disabled = isBusy;
  elements.submitButton.textContent = isBusy ? "生成中..." : "生成视频";
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function updateStatus(text) {
  elements.connectionStatus.textContent = text;
}

function statusText(status) {
  return {
    queued: "排队中",
    running: "生成中",
    completed: "已完成",
    failed: "失败"
  }[status] ?? "处理中";
}

function showError(message) {
  elements.errorMessage.textContent = message;
}

function clearError() {
  elements.errorMessage.textContent = "";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }

  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
