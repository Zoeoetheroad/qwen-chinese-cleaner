const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const fileList = document.querySelector("#fileList");
const clearFilesBtn = document.querySelector("#clearFilesBtn");
const instructionText = document.querySelector("#instructionText");
const resultText = document.querySelector("#resultText");
const generateBtn = document.querySelector("#generateBtn");
const copyBtn = document.querySelector("#copyBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const fileCount = document.querySelector("#fileCount");
const totalSize = document.querySelector("#totalSize");
const fileLimitWarning = document.querySelector("#fileLimitWarning");
const processingInfo = document.querySelector("#processingInfo");
const toast = document.querySelector("#toast");
const quickActions = document.querySelectorAll(".quick-action");
const historyList = document.querySelector("#historyList");
const connectionStatus = document.querySelector("#connectionStatus");
const connectionText = document.querySelector("#connectionText");
const refreshConnectionBtn = document.querySelector("#refreshConnectionBtn");
const openSettingsBtn = document.querySelector("#openSettingsBtn");
const checkUpdateBtn = document.querySelector("#checkUpdateBtn");
const configModal = document.querySelector("#configModal");
const configApiKey = document.querySelector("#configApiKey");
const configBaseUrl = document.querySelector("#configBaseUrl");
const configModel = document.querySelector("#configModel");
const configOcrModel = document.querySelector("#configOcrModel");
const configMessage = document.querySelector("#configMessage");
const testConfigBtn = document.querySelector("#testConfigBtn");
const saveConfigBtn = document.querySelector("#saveConfigBtn");

let selectedFiles = [];
let currentResult = "";
let currentDownloadName = "清洗结果.md";
let selectedMode = "standard";
let toastTimer = null;
let pendingUpdateUrl = "";
const MAX_FILES = 12;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

function showToast(message, type = "") {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = ["toast", "show", type].filter(Boolean).join(" ");
  toastTimer = window.setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFileKind(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";

  if (extension === "txt" || extension === "md") return "文本";
  if (extension === "pdf") return "PDF";
  if (extension === "pptx") return "PPTX";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return "图片 OCR";
  return "不支持";
}

function getTotalSize(files = selectedFiles) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function getLimitMessage(files = selectedFiles) {
  const oversized = files.filter((file) => file.size > MAX_FILE_SIZE);

  if (files.length > MAX_FILES) {
    return `当前已选 ${files.length} 个文件，超过单次最多 ${MAX_FILES} 个的限制。`;
  }

  if (oversized.length > 0) {
    return `有 ${oversized.length} 个文件超过 50MB，请移除后再生成。`;
  }

  return "";
}

function setLoading(isLoading) {
  generateBtn.disabled = isLoading;
  fileInput.disabled = isLoading;
  clearFilesBtn.disabled = isLoading || selectedFiles.length === 0;
  generateBtn.textContent = isLoading ? "生成中..." : "生成 Markdown";
}

function setConnectionState(state, text) {
  connectionStatus.className = `connection-status ${state}`;
  connectionText.textContent = text;
}

async function checkBackendConnection() {
  setConnectionState("checking", "检查中");
  refreshConnectionBtn.disabled = true;

  try {
    const response = await fetch("/api/health", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("后端未连接");
    }

    await response.json();
    setConnectionState("connected", "后端已连接");
  } catch (_error) {
    setConnectionState("disconnected", "后端未连接");
  } finally {
    refreshConnectionBtn.disabled = false;
  }
}

async function checkForUpdate() {
  if (pendingUpdateUrl) {
    window.open(pendingUpdateUrl, "_blank", "noopener");
    return;
  }

  checkUpdateBtn.disabled = true;
  checkUpdateBtn.textContent = "检查中...";

  try {
    const data = await fetchJson("/api/update-check", {
      cache: "no-store",
    });

    if (!data.hasRelease) {
      showToast("还没有发布版本。");
      return;
    }

    if (!data.hasUpdate) {
      showToast(`当前已是最新版本 v${data.currentVersion}`, "success");
      return;
    }

    pendingUpdateUrl = data.downloadUrl || data.releaseUrl;
    checkUpdateBtn.textContent = "下载新版";
    showToast(`发现新版本 v${data.latestVersion}，点击“下载新版”打开下载页。`, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    checkUpdateBtn.disabled = false;
    if (!pendingUpdateUrl) {
      checkUpdateBtn.textContent = "检查更新";
    }
  }
}

function resetUpdateButton() {
  pendingUpdateUrl = "";
  checkUpdateBtn.textContent = "检查更新";
}

function getConfigPayload() {
  return {
    apiKey: configApiKey.value.trim(),
    baseURL: configBaseUrl.value.trim(),
    model: configModel.value.trim(),
    ocrModel: configOcrModel.value.trim(),
  };
}

function setConfigLoading(isLoading) {
  testConfigBtn.disabled = isLoading;
  saveConfigBtn.disabled = isLoading;
  testConfigBtn.textContent = isLoading ? "测试中..." : "测试连接";
  saveConfigBtn.textContent = isLoading ? "保存中..." : "保存设置";
}

function showConfigModal() {
  configModal.hidden = false;
  configMessage.textContent = "";
  configMessage.className = "config-message";
  configApiKey.focus();
}

function hideConfigModal() {
  configModal.hidden = true;
}

async function loadConfigStatus() {
  const data = await fetchJson("/api/config");
  configBaseUrl.value = data.baseURL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  configModel.value = data.model || "qwen-plus";
  configOcrModel.value = data.ocrModel || "qwen-vl-ocr-latest";

  if (!data.configured) {
    showConfigModal();
  }
}

async function testConfig() {
  setConfigLoading(true);
  configMessage.textContent = "正在测试连接...";
  configMessage.className = "config-message";

  try {
    await fetchJson("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getConfigPayload()),
    });
    configMessage.textContent = "连接成功，可以保存。";
    configMessage.className = "config-message success";
  } catch (error) {
    configMessage.textContent = error.message;
    configMessage.className = "config-message error";
  } finally {
    setConfigLoading(false);
  }
}

async function saveConfig() {
  setConfigLoading(true);
  configMessage.textContent = "正在保存配置...";
  configMessage.className = "config-message";

  try {
    await fetchJson("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getConfigPayload()),
    });
    configApiKey.value = "";
    hideConfigModal();
    await checkBackendConnection();
    showToast("API 设置已保存", "success");
  } catch (error) {
    configMessage.textContent = error.message;
    configMessage.className = "config-message error";
  } finally {
    setConfigLoading(false);
  }
}

function getFileKey(file) {
  return [file.name, file.size, file.lastModified].join("__");
}

function renderFiles() {
  fileCount.textContent = String(selectedFiles.length);
  totalSize.textContent = formatSize(getTotalSize());
  clearFilesBtn.disabled = selectedFiles.length === 0;
  fileLimitWarning.textContent = getLimitMessage();

  if (!selectedFiles.length) {
    fileList.innerHTML = '<p class="empty-text">还没有选择文件。</p>';
    return;
  }

  fileList.innerHTML = selectedFiles
    .map(
      (file, index) => `
        <div class="file-item" data-index="${index}">
          <div class="file-main">
            <span class="file-name">${escapeHtml(file.name)}</span>
            <span class="file-meta">${getFileKind(file.name)} · ${formatSize(file.size)}</span>
          </div>
          <button class="remove-file-button" type="button" data-index="${index}" aria-label="移除 ${escapeHtml(file.name)}">移除</button>
        </div>
      `,
    )
    .join("");
}

function resetGeneratedContent() {
  currentResult = "";
  currentDownloadName = "清洗结果.md";
  resultText.textContent = "清洗后的 Markdown 会显示在这里。";
  processingInfo.textContent = "等待生成";
}

function addFiles(files) {
  const existingKeys = new Set(selectedFiles.map(getFileKey));
  const incoming = Array.from(files);
  let addedCount = 0;

  incoming.forEach((file) => {
    const key = getFileKey(file);

    if (!existingKeys.has(key)) {
      selectedFiles.push(file);
      existingKeys.add(key);
      addedCount += 1;
    }
  });

  resetGeneratedContent();
  renderFiles();

  if (addedCount > 0) {
    showToast(`已添加 ${addedCount} 个文件`, "success");
  } else if (incoming.length > 0) {
    showToast("这些文件已经在列表里了。");
  }
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  fileInput.value = "";
  resetGeneratedContent();
  renderFiles();
}

function clearFiles() {
  selectedFiles = [];
  fileInput.value = "";
  resetGeneratedContent();
  renderFiles();
  showToast("已清空文件列表");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "请求失败，请查看本地服务日志。");
  }

  return data;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHistory(history = []) {
  if (!history.length) {
    historyList.innerHTML = '<p class="empty-text">还没有处理记录。</p>';
    return;
  }

  historyList.innerHTML = history
    .map((item) => {
      const modeText = item.processing?.mode === "chunked" ? `自动分段 ${item.processing.chunkCount} 段` : "直接处理";
      const statusText = item.failedCount ? `成功 ${item.successCount} / 失败 ${item.failedCount}` : `成功 ${item.successCount}`;

      return `
        <div class="history-item">
          <div class="history-main">
            <span class="history-title">${escapeHtml(item.title || item.outputName || "清洗结果")}</span>
            <span class="history-meta">${formatDateTime(item.createdAt)} · ${item.fileCount} 个文件 · ${formatSize(item.totalSize || 0)}</span>
          </div>
          <span class="history-status">${modeText} · ${statusText}</span>
        </div>
      `;
    })
    .join("");
}

async function loadHistory() {
  try {
    const data = await fetchJson("/api/history");
    renderHistory(data.history || []);
  } catch (_error) {
    renderHistory([]);
  }
}

function renderFailedFiles(failedFiles = []) {
  if (!failedFiles.length) return "";

  return [
    "",
    "## 未处理文件",
    "",
    ...failedFiles.map((file) => `- ${file.name}：${file.error}`),
  ].join("\n");
}

function setResult(markdown) {
  currentResult = markdown || "";
  resultText.textContent = currentResult || "清洗后的 Markdown 会显示在这里。";
}

function formatProcessingInfo(processing) {
  if (!processing) return "处理完成";

  const lengthText = `约 ${processing.inputLength.toLocaleString("zh-CN")} 字`;

  if (processing.mode === "chunked") {
    return `自动分段：${lengthText}，${processing.chunkCount} 段`;
  }

  return `直接处理：${lengthText}`;
}

async function generateMarkdown() {
  if (!selectedFiles.length) {
    showToast("请先上传文件。", "error");
    return;
  }

  const limitMessage = getLimitMessage();
  if (limitMessage) {
    showToast(limitMessage, "error");
    return;
  }

  const formData = new FormData();
  selectedFiles.forEach((file) => formData.append("files", file));
  formData.append("instruction", instructionText.value);
  formData.append("mode", selectedMode);

  setLoading(true);
  setResult("");
  processingInfo.textContent = "处理中";

  try {
    const data = await fetchJson("/api/generate", {
      method: "POST",
      body: formData,
    });

    const failedText = renderFailedFiles(data.failedFiles);
    setResult([data.result || "", failedText].filter(Boolean).join("\n"));
    currentDownloadName = data.downloadName || data.outputName || "清洗结果.md";
    processingInfo.textContent = formatProcessingInfo(data.processing);
    renderHistory(data.history || []);

    const failedCount = data.failedFiles?.length || 0;
    showToast(failedCount ? `生成完成，${failedCount} 个文件未处理` : `生成完成，使用模型：${data.model}`, failedCount ? "" : "success");
  } catch (error) {
    processingInfo.textContent = "生成失败";
    showToast(error.message, "error");
  } finally {
    setLoading(false);
  }
}

async function copyResult() {
  if (!currentResult.trim()) {
    showToast("还没有可复制的清洗结果。", "error");
    return;
  }

  await navigator.clipboard.writeText(currentResult);
  showToast("已复制到剪贴板", "success");
}

function downloadMarkdown() {
  if (!currentResult.trim()) {
    showToast("还没有可下载的清洗结果。", "error");
    return;
  }

  const blob = new Blob([currentResult], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = currentDownloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Markdown 文档已开始下载", "success");
}

fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

fileList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-file-button");

  if (!button) return;
  removeFile(Number(button.dataset.index));
});

clearFilesBtn.addEventListener("click", clearFiles);

quickActions.forEach((button) => {
  button.addEventListener("click", () => {
    quickActions.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    selectedMode = button.dataset.mode || "standard";
    instructionText.value = button.dataset.prompt;
    instructionText.focus();
  });
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");
  addFiles(event.dataTransfer.files);
});

generateBtn.addEventListener("click", generateMarkdown);
copyBtn.addEventListener("click", copyResult);
downloadBtn.addEventListener("click", downloadMarkdown);
refreshConnectionBtn.addEventListener("click", checkBackendConnection);
openSettingsBtn.addEventListener("click", showConfigModal);
checkUpdateBtn.addEventListener("click", checkForUpdate);
testConfigBtn.addEventListener("click", testConfig);
saveConfigBtn.addEventListener("click", saveConfig);

instructionText.value = "请将资料清洗为结构清晰的 Markdown，保留原意，去除明显重复、乱码和不必要空行，修正明显错别字。";
renderFiles();
loadConfigStatus().catch(() => showConfigModal());
checkBackendConnection();
loadHistory();
window.setInterval(resetUpdateButton, 30 * 60 * 1000);
