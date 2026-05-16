const elements = {
  adminStatus: document.querySelector("#adminStatus"),
  activeJob: document.querySelector("#activeJob"),
  waitingCount: document.querySelector("#waitingCount"),
  jobCount: document.querySelector("#jobCount"),
  jobTable: document.querySelector("#jobTable"),
  refreshButton: document.querySelector("#refreshButton"),
  saveModelsButton: document.querySelector("#saveModelsButton"),
  saveTtsModelButton: document.querySelector("#saveTtsModelButton"),
  savePromptsButton: document.querySelector("#savePromptsButton"),
  saveContentModulesButton: document.querySelector("#saveContentModulesButton"),
  addContentModuleButton: document.querySelector("#addContentModuleButton"),
  llmPresetButtons: document.querySelector("#llmPresetButtons"),
  contentModuleList: document.querySelector("#contentModuleList"),
  promptList: document.querySelector("#promptList"),
  defaultVoiceSelect: document.querySelector("#defaultVoiceSelect"),
  setDefaultVoiceButton: document.querySelector("#setDefaultVoiceButton"),
  voiceCloneForm: document.querySelector("#voiceCloneForm"),
  voiceList: document.querySelector("#voiceList"),
  adminMessage: document.querySelector("#adminMessage")
};

let settings = null;

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.adminTab));
});
elements.refreshButton.addEventListener("click", loadAdminState);
elements.saveModelsButton.addEventListener("click", saveModelsConfig);
elements.saveTtsModelButton.addEventListener("click", saveTtsModel);
elements.savePromptsButton.addEventListener("click", savePrompts);
elements.saveContentModulesButton.addEventListener("click", saveContentModules);
elements.addContentModuleButton.addEventListener("click", addContentModule);
elements.setDefaultVoiceButton.addEventListener("click", setDefaultVoice);
elements.voiceCloneForm.addEventListener("submit", uploadVoiceClone);
document.querySelectorAll("[data-test-model]").forEach((button) => {
  button.addEventListener("click", () => testModel(button.dataset.testModel));
});

loadAdminState();
window.setInterval(loadQueueState, 1200);

function activateTab(tabId) {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === tabId);
  });
  document.querySelectorAll("[data-admin-view]").forEach((view) => {
    view.classList.toggle("active", view.dataset.adminView === tabId);
  });
}

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
  renderLlmPresets(nextSettings.llmPresets ?? []);
  renderContentModules(nextSettings.contentModules ?? [], nextSettings.activeContentModuleId);
  renderPrompts(nextSettings.prompts ?? []);
  renderVoices(nextSettings.voices ?? [], nextSettings.models.tts.defaultVoiceId);
}

function renderLlmPresets(presets) {
  elements.llmPresetButtons.innerHTML = presets
    .map(
      (preset) => `
        <button class="preset-button" type="button" data-llm-preset="${escapeHtml(preset.id)}">
          <strong>${escapeHtml(preset.name)}</strong>
          <span>${escapeHtml(preset.model)}</span>
        </button>
      `
    )
    .join("");

  elements.llmPresetButtons.querySelectorAll("[data-llm-preset]").forEach((button) => {
    button.addEventListener("click", () => applyLlmPreset(button.dataset.llmPreset));
  });
}

function applyLlmPreset(presetId) {
  const preset = (settings.llmPresets ?? []).find((item) => item.id === presetId);
  if (!preset) {
    return;
  }

  document.querySelector("#llmProvider").value = preset.provider ?? "openai-compatible";
  document.querySelector("#llmBaseUrl").value = preset.baseUrl ?? "";
  document.querySelector("#llmModel").value = preset.model ?? "";
  document.querySelector("#llmEnabled").checked = true;
  showMessage(`已套用 ${preset.name} 预配置，填入 API Key 后保存。`, false);
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

function renderContentModules(modules, activeModuleId) {
  elements.contentModuleList.innerHTML = modules
    .map(
      (module) => `
        <article class="content-module-card" data-content-module-id="${escapeHtml(module.id)}">
          <div class="content-module-head">
            <label class="radio-row">
              <input name="activeContentModule" type="radio" value="${escapeHtml(module.id)}" ${module.id === activeModuleId ? "checked" : ""} />
              前台展示
            </label>
            <label class="check-row"><input class="module-enabled" type="checkbox" ${module.enabled ? "checked" : ""} /> 启用</label>
          </div>
          <div class="module-fields">
            <label>模块 ID<input class="module-id" type="text" value="${escapeHtml(module.id)}" readonly /></label>
            <label>模块名称<input class="module-name" type="text" value="${escapeHtml(module.name || "")}" /></label>
            <label>关联风格模板
              <select class="module-template">
                ${templateOptions(module.templateId)}
              </select>
            </label>
            <label>业务大模型
              <select class="module-llm-preset">
                ${llmPresetOptions(module.llmPresetId)}
              </select>
            </label>
            <label>业务音色
              <select class="module-voice">
                ${voiceOptions(module.voiceId)}
              </select>
            </label>
            <label>提示词方案
              <select class="module-prompt-set">
                ${promptSetOptions(module)}
              </select>
            </label>
            <label>前台标题<input class="module-front-title" type="text" value="${escapeHtml(module.frontTitle || "")}" /></label>
            <label class="wide">前台副标题<input class="module-front-subtitle" type="text" value="${escapeHtml(module.frontSubtitle || "")}" /></label>
            <label class="wide">后台说明<input class="module-description" type="text" value="${escapeHtml(module.description || "")}" /></label>
            <label class="wide">前台默认文案<textarea class="module-default-text">${escapeHtml(module.defaultText || "")}</textarea></label>
            <label class="wide">模块总逻辑<textarea class="module-prompt">${escapeHtml(module.prompt || "")}</textarea></label>
            <div class="wide business-flow">
              <div class="business-step">
                <strong>1. 内容分析</strong>
                <textarea class="module-script-prompt">${escapeHtml(activePromptSet(module).scriptPrompt)}</textarea>
              </div>
              <div class="business-step">
                <strong>2. 生成分镜</strong>
                <textarea class="module-storyboard-prompt">${escapeHtml(activePromptSet(module).storyboardPrompt)}</textarea>
              </div>
              <div class="business-step">
                <strong>3. 分镜生成图片</strong>
                <textarea class="module-image-prompt">${escapeHtml(activePromptSet(module).imagePrompt)}</textarea>
              </div>
              <div class="business-step">
                <strong>4. TTS 配音</strong>
                <textarea class="module-tts-prompt">${escapeHtml(activePromptSet(module).ttsPrompt)}</textarea>
              </div>
              <div class="business-step">
                <strong>5. 合成成片</strong>
                <textarea class="module-compose-prompt">${escapeHtml(activePromptSet(module).composePrompt)}</textarea>
              </div>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  elements.contentModuleList.querySelectorAll(".module-prompt-set").forEach((select) => {
    select.addEventListener("change", () => refreshPromptSetFields(select.closest(".content-module-card")));
  });
}

function refreshPromptSetFields(card) {
  const moduleId = card.querySelector(".module-id").value.trim();
  const promptSetId = card.querySelector(".module-prompt-set").value;
  const module = (settings.contentModules ?? []).find((item) => item.id === moduleId);
  const promptSet = (module?.promptSets ?? []).find((item) => item.id === promptSetId);
  if (!promptSet) {
    return;
  }

  card.querySelector(".module-script-prompt").value = promptSet.scriptPrompt ?? "";
  card.querySelector(".module-storyboard-prompt").value = promptSet.storyboardPrompt ?? "";
  card.querySelector(".module-image-prompt").value = promptSet.imagePrompt ?? "";
  card.querySelector(".module-tts-prompt").value = promptSet.ttsPrompt ?? "";
  card.querySelector(".module-compose-prompt").value = promptSet.composePrompt ?? "";
}

function addContentModule() {
  clearMessage();
  const id = `module_${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  settings.contentModules = [
    ...(settings.contentModules ?? []),
    {
      id,
      name: "新模块",
      enabled: true,
      templateId: "zen",
      llmPresetId: "chatgpt",
      voiceId: "default-narrator",
      promptSetId: "prompt_1",
      frontTitle: "新模块短视频",
      frontSubtitle: "在这里配置前台展示文案。",
      description: "自定义短视频内容方向。",
      defaultText: "把这里改成前台默认展示的短视频文案。",
      prompt: "内容模块：新模块。请描述这个模块的内容逻辑、语言风格、画面意象和字幕风格。",
      promptSets: createDefaultPromptSets("新模块"),
      updatedAt: now
    }
  ];
  settings.activeContentModuleId = id;
  renderContentModules(settings.contentModules, settings.activeContentModuleId);
  showMessage("已新增模块，编辑后点击保存。", false);
}

function llmPresetOptions(selectedPresetId) {
  return (settings?.llmPresets ?? [])
    .map(
      (preset) => `<option value="${escapeHtml(preset.id)}" ${preset.id === selectedPresetId ? "selected" : ""}>${escapeHtml(preset.name)}</option>`
    )
    .join("");
}

function voiceOptions(selectedVoiceId) {
  return (settings?.voices ?? [])
    .map(
      (voice) => `<option value="${escapeHtml(voice.id)}" ${voice.id === selectedVoiceId ? "selected" : ""}>${escapeHtml(voice.name)}</option>`
    )
    .join("");
}

function promptSetOptions(module) {
  return (module.promptSets ?? [])
    .map(
      (promptSet) =>
        `<option value="${escapeHtml(promptSet.id)}" ${promptSet.id === module.promptSetId ? "selected" : ""}>${escapeHtml(promptSet.name)}</option>`
    )
    .join("");
}

function activePromptSet(module) {
  return (module.promptSets ?? []).find((promptSet) => promptSet.id === module.promptSetId) ?? module.promptSets?.[0] ?? createDefaultPromptSets(module.name)[0];
}

function createDefaultPromptSets(moduleName) {
  return [
    {
      id: "prompt_1",
      name: "提示词一",
      scriptPrompt: `把用户输入改写成${moduleName}短视频脚本，保留核心观点，语言直接、有节奏。`,
      storyboardPrompt: "分镜要有开场、展开、转折和收束，每个分镜默认 3 秒。",
      imagePrompt: "图片要统一画风、统一色调，避免画面内文字和水印。",
      ttsPrompt: "旁白要像真人口播，语速稳定，句间有自然停顿。",
      composePrompt: "合成时保持图片 3 秒节奏，旁白优先，背景音乐降低音量。"
    },
    {
      id: "prompt_2",
      name: "提示词二",
      scriptPrompt: "先抛问题，再给方法，适合知识型短视频。",
      storyboardPrompt: "分镜强调问题、原因、方法、结果。",
      imagePrompt: "图片强化主题意象和层次关系。",
      ttsPrompt: "旁白沉稳，重点句稍作停顿。",
      composePrompt: "合成用平稳转场，字幕与旁白节奏一致。"
    },
    {
      id: "prompt_3",
      name: "提示词三",
      scriptPrompt: "结构更锋利，结尾留一句记忆点。",
      storyboardPrompt: "分镜要有强开头、强对比、强结尾。",
      imagePrompt: "图片要有更强构图和情绪张力。",
      ttsPrompt: "旁白更有推动力，短句优先。",
      composePrompt: "合成节奏更紧凑，背景音乐不压人声。"
    }
  ];
}

function templateOptions(selectedTemplateId) {
  const templates = [
    ["zen", "禅宗型"],
    ["mao", "毛选型"],
    ["tech", "科技感"],
    ["guofeng", "国风"]
  ];

  return templates
    .map(
      ([id, name]) => `<option value="${id}" ${id === selectedTemplateId ? "selected" : ""}>${name}</option>`
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

async function saveModelsConfig() {
  clearMessage();
  const models = { llm: readLlmFields(), image: readImageFields() };

  try {
    showMessage("正在测试语言大模型和图片大模型...", false);
    const testKinds = ["llm", "image"].filter((kind) => models[kind].enabled);
    for (const kind of testKinds) {
      const result = await testModelConnection(kind, models);
      if (!result.ok) {
        showMessage(`${kind === "llm" ? "语言大模型" : "图片大模型"}测试未通过：${result.message}`);
        return;
      }
    }
    await saveModels(models, "大模型测试通过，配置已保存。");
  } catch (error) {
    showMessage(error.message);
  }
}

async function saveTtsModel() {
  clearMessage();
  await saveModels({ tts: readTtsFields() }, "TTS 模型已保存。");
}

async function saveModels(models, successMessage) {
  try {
    settings = await fetchJson("/api/admin/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models })
    });
    renderSettings(settings);
    showMessage(successMessage, false);
  } catch (error) {
    showMessage(error.message);
  }
}

async function testModel(kind) {
  clearMessage();
  try {
    const result = await testModelConnection(kind, {
      llm: readLlmFields(),
      image: readImageFields(),
      tts: readTtsFields()
    });
    showMessage(`${result.kind}: ${result.message} (${result.latencyMs}ms)`, !result.ok);
  } catch (error) {
    showMessage(error.message);
  }
}

async function testModelConnection(kind, models) {
  return fetchJson("/api/admin/models/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, models })
  });
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

function readLlmFields() {
  return {
    ...readModelFields("llm")
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

async function saveContentModules() {
  clearMessage();
  const modules = [...document.querySelectorAll(".content-module-card")].map((card) => ({
    id: card.querySelector(".module-id").value.trim(),
    enabled: card.querySelector(".module-enabled").checked,
    name: card.querySelector(".module-name").value.trim(),
    templateId: card.querySelector(".module-template").value,
    llmPresetId: card.querySelector(".module-llm-preset").value,
    voiceId: card.querySelector(".module-voice").value,
    promptSetId: card.querySelector(".module-prompt-set").value,
    frontTitle: card.querySelector(".module-front-title").value.trim(),
    frontSubtitle: card.querySelector(".module-front-subtitle").value.trim(),
    description: card.querySelector(".module-description").value.trim(),
    defaultText: card.querySelector(".module-default-text").value.trim(),
    prompt: card.querySelector(".module-prompt").value.trim(),
    promptSets: updatePromptSetsFromCard(card)
  }));
  const activeModuleId = document.querySelector('input[name="activeContentModule"]:checked')?.value;

  try {
    settings = await fetchJson("/api/admin/content-modules", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activeModuleId, modules })
    });
    renderSettings(settings);
    showMessage("短视频模块已保存，前台会按当前模块展示。", false);
  } catch (error) {
    showMessage(error.message);
  }
}

function updatePromptSetsFromCard(card) {
  const selectedPromptSetId = card.querySelector(".module-prompt-set").value;
  const moduleId = card.querySelector(".module-id").value.trim();
  const module = (settings.contentModules ?? []).find((item) => item.id === moduleId);
  const promptSets = module?.promptSets?.length ? module.promptSets : createDefaultPromptSets(card.querySelector(".module-name").value.trim());

  return promptSets.map((promptSet) =>
    promptSet.id === selectedPromptSetId
      ? {
          ...promptSet,
          scriptPrompt: card.querySelector(".module-script-prompt").value.trim(),
          storyboardPrompt: card.querySelector(".module-storyboard-prompt").value.trim(),
          imagePrompt: card.querySelector(".module-image-prompt").value.trim(),
          ttsPrompt: card.querySelector(".module-tts-prompt").value.trim(),
          composePrompt: card.querySelector(".module-compose-prompt").value.trim()
        }
      : promptSet
  );
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
      <span>模块 / 模板</span>
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
            <span>
              <strong>${escapeHtml(job.contentModule?.name || "通用")}</strong>
              <small>${escapeHtml(job.templateName || job.templateId)}</small>
            </span>
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
