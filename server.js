const fs = require("fs/promises");
const https = require("https");
const path = require("path");
const express = require("express");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const AdmZip = require("adm-zip");
const OpenAI = require("openai");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { createCanvas } = require("canvas");
const packageInfo = require("./package.json");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_DATA_DIR = process.env.APP_DATA_DIR || __dirname;
const INPUT_DIR = path.join(APP_DATA_DIR, "input");
const UPLOAD_DIR = path.join(APP_DATA_DIR, "uploads");
const OUTPUT_DIR = path.join(APP_DATA_DIR, "output");
const LOG_DIR = path.join(APP_DATA_DIR, "logs");
const CONFIG_DIR = path.join(APP_DATA_DIR, "config");
const HISTORY_FILE = path.join(LOG_DIR, "history.json");
const CONFIG_FILE = path.join(CONFIG_DIR, "settings.json");
const DIRECT_CLEAN_LIMIT = Number(process.env.DIRECT_CLEAN_LIMIT || 12000);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 8000);
const PDF_OCR_MAX_PAGES = Number(process.env.PDF_OCR_MAX_PAGES || 30);
const PDF_OCR_SCALE = Number(process.env.PDF_OCR_SCALE || 2);
const UPDATE_REPO = process.env.UPDATE_REPO || "Zoeoetheroad/qwen-chinese-cleaner";
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".pptx", ".png", ".jpg", ".jpeg", ".webp"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 12,
  },
});

app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

function isPlaceholder(value = "") {
  return !value || value.includes("请填入") || value.includes("your") || value.includes("YOUR");
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

async function writeConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
}

async function getSettings() {
  const config = await readConfig();
  const envApiKey = process.env.API_KEY || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "";
  const apiKey = isPlaceholder(envApiKey) ? config.apiKey : envApiKey || config.apiKey;

  return {
    apiKey,
    baseURL: process.env.API_BASE_URL || process.env.OPENAI_BASE_URL || process.env.QWEN_BASE_URL || config.baseURL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.TEXT_MODEL || process.env.QWEN_MODEL || config.model || "qwen-plus",
    ocrModel: process.env.OCR_MODEL || process.env.QWEN_OCR_MODEL || config.ocrModel || "qwen-vl-ocr-latest",
  };
}

async function createOpenAIClient(settings) {
  const resolved = settings || (await getSettings());

  if (!resolved.apiKey) {
    const error = new Error("请先配置 API Key。");
    error.status = 400;
    throw error;
  }

  return new OpenAI({
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
  });
}

app.get("/api/health", async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({
      ok: true,
      configured: Boolean(settings.apiKey),
      model: settings.model,
      ocrModel: settings.ocrModel,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/config", async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({
      configured: Boolean(settings.apiKey),
      baseURL: settings.baseURL,
      model: settings.model,
      ocrModel: settings.ocrModel,
      hasApiKey: Boolean(settings.apiKey),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/config/test", async (req, res, next) => {
  try {
    const settings = await normalizeConfigPayload(req.body || {}, { allowStoredApiKey: true });
    const client = await createOpenAIClient(settings);
    await client.models.list();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/config", async (req, res, next) => {
  try {
    const settings = await normalizeConfigPayload(req.body || {}, { allowStoredApiKey: true });
    const client = await createOpenAIClient(settings);
    await client.models.list();
    await writeConfig(settings);
    res.json({
      ok: true,
      configured: true,
      baseURL: settings.baseURL,
      model: settings.model,
      ocrModel: settings.ocrModel,
    });
  } catch (error) {
    next(error);
  }
});

async function normalizeConfigPayload(payload, options = {}) {
  const savedConfig = options.allowStoredApiKey ? await readConfig() : {};
  const settings = {
    apiKey: String(payload.apiKey || "").trim() || String(savedConfig.apiKey || "").trim(),
    baseURL: String(payload.baseURL || "https://dashscope.aliyuncs.com/compatible-mode/v1").trim(),
    model: String(payload.model || "qwen-plus").trim(),
    ocrModel: String(payload.ocrModel || "qwen-vl-ocr-latest").trim(),
  };

  if (!settings.apiKey) {
    const error = new Error("请填写 API Key。");
    error.status = 400;
    throw error;
  }

  if (!settings.baseURL) {
    const error = new Error("请填写 OpenAI 兼容地址。");
    error.status = 400;
    throw error;
  }

  return settings;
}

async function ensureDirs() {
  await fs.mkdir(INPUT_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `${packageInfo.name}/${packageInfo.version}`,
        },
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode === 404) {
            resolve(null);
            return;
          }

          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`GitHub 更新检查失败：HTTP ${response.statusCode || "未知"}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (_error) {
            reject(new Error("GitHub 更新信息解析失败。"));
          }
        });
      },
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error("GitHub 更新检查超时。"));
    });
    request.on("error", reject);
  });
}

function parseVersion(value = "") {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map((part) => Number(part));
}

function isVersionNewer(latestVersion, currentVersion) {
  const latest = parseVersion(latestVersion);
  const current = parseVersion(currentVersion);

  if (!latest || !current) return false;

  for (let index = 0; index < 3; index += 1) {
    if (latest[index] > current[index]) return true;
    if (latest[index] < current[index]) return false;
  }

  return false;
}

function pickDmgAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return (
    assets.find((asset) => /arm64\.dmg$/i.test(asset.name || "")) ||
    assets.find((asset) => /\.dmg$/i.test(asset.name || "")) ||
    null
  );
}

async function readInputFiles() {
  await ensureDirs();
  const entries = await fs.readdir(INPUT_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));

  const sections = [];

  for (const file of files) {
    const fullPath = path.join(INPUT_DIR, file.name);
    const content = await fs.readFile(fullPath, "utf8");
    sections.push({
      name: file.name,
      content,
    });
  }

  return sections;
}

function getFileExtension(fileName) {
  return path.extname(fileName).toLowerCase();
}

function normalizeUploadedName(name) {
  if (!/[ÃÂäåæçèé]/.test(name)) return name;
  return Buffer.from(name, "latin1").toString("utf8");
}

function getKindByExtension(extension) {
  if (extension === ".txt" || extension === ".md") return "文本";
  if (extension === ".pdf") return "PDF";
  if (extension === ".pptx") return "PPTX";
  if (IMAGE_EXTENSIONS.has(extension)) return "图片 OCR";
  return "不支持";
}

function getOcrPrompt(mode) {
  if (mode === "fancy-ppt") {
    return [
      "请识别图片中的中文和英文文字，并只提取真正有信息价值的内容。",
      "不要描述版式、颜色、位置、图标、背景、箭头方向、左右上下区域、页面布局或视觉元素。",
      "只保留标题、观点、数据、结论、流程、产品信息和可用于理解内容的文字。",
      "按阅读顺序输出为 Markdown。只输出识别结果，不要解释。",
    ].join("");
  }

  return "请识别图片中的中文和英文文字，按阅读顺序输出为 Markdown。只输出识别结果，不要解释。";
}

function getEffectiveInstruction(instruction, mode) {
  const base = getDefaultInstruction(instruction);

  if (mode !== "fancy-ppt") {
    return base;
  }

  return [
    base,
    "",
    "额外要求：这批资料可能来自花哨 PPT 或 OCR 结果。请忽略版式、位置、颜色、图标、背景、箭头方向、左右上下区域等视觉描述。不要描述页面布局，只保留真正有信息价值的标题、观点、数据、结论、流程、产品信息和正文内容。",
  ].join("\n");
}

function escapeMarkdownText(text) {
  return text.replace(/\r\n/g, "\n").trim();
}

function xmlDecode(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractTextFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return escapeMarkdownText(content);
}

async function extractPdf(filePath, originalName, mode) {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  const text = escapeMarkdownText(data.text || "");

  if (text) {
    return text;
  }

  return extractPdfWithOcr(buffer, originalName, mode);
}

async function extractPptx(filePath) {
  const zip = new AdmZip(filePath);
  const slideEntries = zip
    .getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));

  const slides = [];

  for (const [index, entry] of slideEntries.entries()) {
    const xml = entry.getData().toString("utf8");
    const textItems = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map((match) => xmlDecode(match[1]).trim())
      .filter(Boolean);

    if (textItems.length > 0) {
      slides.push(`## 第 ${index + 1} 页\n\n${textItems.join("\n\n")}`);
    }
  }

  const text = slides.join("\n\n");

  if (!text.trim()) {
    throw new Error("这个 PPTX 没有提取到文字，可能主要是图片或特殊对象。");
  }

  return text;
}

async function extractImageWithOcr(filePath, originalName, mode) {
  const extension = getFileExtension(originalName).replace(".", "");
  const mimeType = extension === "jpg" ? "jpeg" : extension;
  const buffer = await fs.readFile(filePath);
  return extractBufferWithOcr(buffer, `image/${mimeType}`, mode);
}

async function extractBufferWithOcr(buffer, mimeType, mode) {
  const settings = await getSettings();
  const client = await createOpenAIClient(settings);
  const model = settings.ocrModel;
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: getOcrPrompt(mode),
          },
          {
            type: "image_url",
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
    temperature: 0,
  });

  const text = response.choices?.[0]?.message?.content?.trim() || "";

  if (!text) {
    throw new Error("图片 OCR 没有识别到文字。");
  }

  return text;
}

function createPdfCanvasFactory() {
  return {
    create(width, height) {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };
}

async function extractPdfWithOcr(buffer, originalName, mode) {
  let document;

  try {
    document = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;
  } catch (_error) {
    throw new Error(`无法读取扫描 PDF「${originalName}」。请确认文件未损坏或未加密。`);
  }

  if (document.numPages > PDF_OCR_MAX_PAGES) {
    throw new Error(`扫描 PDF「${originalName}」共 ${document.numPages} 页，自动 OCR 最多支持 ${PDF_OCR_MAX_PAGES} 页。请拆分后重试。`);
  }

  const canvasFactory = createPdfCanvasFactory();
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: PDF_OCR_SCALE });
    const canvasAndContext = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));

    try {
      await page.render({
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory,
      }).promise;
      const image = canvasAndContext.canvas.toBuffer("image/png");
      const text = await extractBufferWithOcr(image, "image/png", mode);
      pages.push(`## 第 ${pageNumber} 页\n\n${text}`);
    } finally {
      canvasFactory.destroy(canvasAndContext);
      page.cleanup();
    }
  }

  await document.destroy();
  return pages.join("\n\n");
}

async function extractUploadedFile(file, options = {}) {
  const fileName = normalizeUploadedName(file.originalname);
  const extension = getFileExtension(fileName);

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`暂不支持 ${extension || "未知"} 格式。`);
  }

  if (extension === ".txt" || extension === ".md") {
    return extractTextFile(file.path);
  }

  if (extension === ".pdf") {
    return extractPdf(file.path, fileName, options.mode);
  }

  if (extension === ".pptx") {
    return extractPptx(file.path);
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return extractImageWithOcr(file.path, fileName, options.mode);
  }

  throw new Error(`暂不支持 ${extension} 格式。`);
}

function getDefaultInstruction(instruction) {
  return instruction.trim() || "请清洗并整理以下中文资料，保证 Markdown 格式，保留原意，去除明显重复、乱码和不必要空行。";
}

function splitIntoChunks(text, maxChars = CHUNK_SIZE) {
  const chunks = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";

  function pushCurrent() {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  }

  for (const paragraph of paragraphs) {
    const normalized = paragraph.trim();
    if (!normalized) continue;

    if (normalized.length > maxChars) {
      pushCurrent();
      for (let index = 0; index < normalized.length; index += maxChars) {
        chunks.push(normalized.slice(index, index + maxChars).trim());
      }
      continue;
    }

    const next = current ? `${current}\n\n${normalized}` : normalized;

    if (next.length > maxChars) {
      pushCurrent();
      current = normalized;
    } else {
      current = next;
    }
  }

  pushCurrent();
  return chunks;
}

async function createChatCompletion(messages, temperature = 0.2) {
  const settings = await getSettings();
  const client = await createOpenAIClient(settings);
  const model = settings.model;

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature,
  });

  return {
    result: response.choices?.[0]?.message?.content?.trim() || "",
    model,
  };
}

async function cleanDirect(instruction, content, mode) {
  return createChatCompletion([
    {
      role: "system",
      content:
        "你是资料清洗助手。请严格根据用户任务说明清洗资料。输出必须是 Markdown，不能输出解释、寒暄、代码块包裹或与清洗结果无关的内容。保持原意，保留重要事实、名称、数字和结构。",
    },
    {
      role: "user",
      content: [
        "任务说明：",
        getEffectiveInstruction(instruction, mode),
        "",
        "待清洗资料：",
        content,
      ].join("\n"),
    },
  ]);
}

async function cleanChunk(instruction, chunk, index, total, mode) {
  return createChatCompletion([
    {
      role: "system",
      content:
        "你是资料清洗助手。你正在处理一份长资料中的单个分段。请只处理当前分段，不要假设你看过其他分段。输出必须是 Markdown，不能输出解释、寒暄或代码块包裹。",
    },
    {
      role: "user",
      content: [
        "整体任务说明：",
        getEffectiveInstruction(instruction, mode),
        "",
        `当前分段：第 ${index + 1} 段 / 共 ${total} 段`,
        "",
        "处理要求：",
        "请根据整体任务说明处理本段。保留本段中的重要事实、名称、数字、结论和结构；去除明显重复、乱码和无意义内容。",
        "",
        "当前分段内容：",
        chunk,
      ].join("\n"),
    },
  ]);
}

async function mergeChunkGroup(instruction, chunkResults, label, mode) {
  return createChatCompletion([
    {
      role: "system",
      content:
        "你是中文资料整合助手。请把多个 Markdown 分段结果合并为一份结构统一的 Markdown。只输出最终 Markdown，不要输出解释、寒暄或代码块包裹。",
    },
    {
      role: "user",
      content: [
        "原始任务说明：",
        getEffectiveInstruction(instruction, mode),
        "",
        label,
        "",
        "整合要求：",
        "请去重、合并同类项、统一标题层级和表达风格。保留重要事实、名称、数字、结论和结构，不要编造原文没有的信息。",
        "",
        "分段结果：",
        chunkResults.join("\n\n---\n\n"),
      ].join("\n"),
    },
  ]);
}

async function mergeChunkResults(instruction, chunkResults, mode) {
  const joined = chunkResults.join("\n\n---\n\n");

  if (joined.length <= DIRECT_CLEAN_LIMIT) {
    return mergeChunkGroup(instruction, chunkResults, "以下是全部分段处理结果。", mode);
  }

  const groups = splitIntoChunks(joined, DIRECT_CLEAN_LIMIT);
  const groupResults = [];

  for (const [index, group] of groups.entries()) {
    const { result } = await mergeChunkGroup(
      instruction,
      [group],
      `以下是分段结果的第 ${index + 1} 组合并材料 / 共 ${groups.length} 组。`,
      mode,
    );
    groupResults.push(result);
  }

  return mergeChunkGroup(instruction, groupResults, "以下是各组合并后的结果，请再次统一整理为最终文档。", mode);
}

async function cleanMarkdown(instruction, content, options = {}) {
  const mode = options.mode || "standard";

  if (content.length <= DIRECT_CLEAN_LIMIT) {
    const cleaned = await cleanDirect(instruction, content, mode);
    return {
      ...cleaned,
      processing: {
        mode: "direct",
        inputLength: content.length,
        directLimit: DIRECT_CLEAN_LIMIT,
        chunkSize: CHUNK_SIZE,
        chunkCount: 1,
      },
    };
  }

  const chunks = splitIntoChunks(content, CHUNK_SIZE);
  const partialResults = [];
  const settings = await getSettings();
  let model = settings.model;

  for (const [index, chunk] of chunks.entries()) {
    const cleaned = await cleanChunk(instruction, chunk, index, chunks.length, mode);
    model = cleaned.model;
    partialResults.push(cleaned.result);
  }

  const merged = await mergeChunkResults(instruction, partialResults, mode);

  return {
    result: merged.result,
    model: merged.model || model,
    processing: {
      mode: "chunked",
      inputLength: content.length,
      directLimit: DIRECT_CLEAN_LIMIT,
      chunkSize: CHUNK_SIZE,
      chunkCount: chunks.length,
    },
  };
}

async function removeUploadedFiles(files) {
  await Promise.all(
    files.map((file) =>
      fs.unlink(file.path).catch(() => {
        // Temporary upload cleanup should not hide the real request result.
      }),
    ),
  );
}

function extractTitleFromMarkdown(markdown) {
  const titleLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+[^#]/.test(line));

  if (!titleLine) return "";

  return titleLine
    .replace(/^#\s+/, "")
    .replace(/[*_`~]/g, "")
    .trim();
}

function stripFileExtension(fileName) {
  return fileName.replace(/\.[^.]+$/, "");
}

function sanitizeFileName(name) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  return cleaned || "清洗结果";
}

function formatLocalTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function createOutputName(markdown, sourceFiles = []) {
  const title = extractTitleFromMarkdown(markdown) || stripFileExtension(sourceFiles[0]?.name || "") || "清洗结果";
  const safeTitle = sanitizeFileName(title);
  const timestamp = formatLocalTimestamp();

  return {
    title: safeTitle,
    fileName: `${safeTitle}-${timestamp}.md`,
  };
}

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_FILE, "utf8");
    const history = JSON.parse(raw);
    return Array.isArray(history) ? history : [];
  } catch (_error) {
    return [];
  }
}

async function writeHistory(history) {
  await ensureDirs();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history.slice(0, 10), null, 2), "utf8");
}

async function appendHistory(entry) {
  const history = await readHistory();
  await writeHistory([entry, ...history].slice(0, 10));
}

app.get("/api/materials", async (_req, res, next) => {
  try {
    const files = await readInputFiles();
    const combined = files
      .map((file) => `# ${file.name}\n\n${file.content.trim()}`)
      .join("\n\n---\n\n");

    res.json({
      files,
      combined,
      supportedExtensions: Array.from(SUPPORTED_EXTENSIONS),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (_req, res, next) => {
  try {
    res.json({ history: await readHistory() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/update-check", async (_req, res, next) => {
  try {
    const release = await requestJson(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);

    if (!release) {
      res.json({
        ok: true,
        hasRelease: false,
        hasUpdate: false,
        currentVersion: packageInfo.version,
        repo: UPDATE_REPO,
      });
      return;
    }

    const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    const asset = pickDmgAsset(release);

    res.json({
      ok: true,
      hasRelease: true,
      hasUpdate: isVersionNewer(latestVersion, packageInfo.version),
      currentVersion: packageInfo.version,
      latestVersion,
      releaseName: release.name || release.tag_name || latestVersion,
      releaseUrl: release.html_url,
      downloadUrl: asset?.browser_download_url || release.html_url,
      publishedAt: release.published_at,
      repo: UPDATE_REPO,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/clean", async (req, res, next) => {
  try {
    const { instruction = "", content = "" } = req.body || {};

    if (!content.trim()) {
      return res.status(400).json({ error: "input/ 文件夹里还没有可清洗的 .txt 或 .md 内容。" });
    }

    const { result, model, processing } = await cleanMarkdown(instruction, content);
    res.json({ result, model, processing });
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", upload.array("files"), async (req, res, next) => {
  const files = req.files || [];

  try {
    if (files.length === 0) {
      return res.status(400).json({ error: "请先上传至少一个文件。" });
    }

    const extractedFiles = [];
    const failedFiles = [];
    const mode = req.body.mode || "standard";

    for (const file of files) {
      const fileName = normalizeUploadedName(file.originalname);
      const extension = getFileExtension(fileName);
      const kind = getKindByExtension(extension);

      try {
        const text = await extractUploadedFile(file, { mode });
        extractedFiles.push({
          name: fileName,
          kind,
          size: file.size,
          text,
        });
      } catch (error) {
        failedFiles.push({
          name: fileName,
          kind,
          size: file.size,
          error: error.message,
        });
      }
    }

    const combined = extractedFiles
      .map((file) => `# ${file.name}\n\n${file.text}`)
      .join("\n\n---\n\n");

    if (!combined.trim()) {
      const errorDetails = failedFiles
        .map((file) => `${file.name}：${file.error}`)
        .join("；");
      return res.status(400).json({
        error: errorDetails ? `没有从上传文件中提取到可清洗内容。${errorDetails}` : "没有从上传文件中提取到可清洗内容。",
        files: extractedFiles,
        failedFiles,
      });
    }

    const { result, model, processing } = await cleanMarkdown(req.body.instruction || "", combined, { mode });
    const output = createOutputName(result, extractedFiles);
    const outputName = output.fileName;
    await fs.writeFile(path.join(OUTPUT_DIR, outputName), result, "utf8");

    const historyEntry = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      mode,
      title: output.title,
      outputName,
      model,
      ocrModel: (await getSettings()).ocrModel,
      fileCount: files.length,
      successCount: extractedFiles.length,
      failedCount: failedFiles.length,
      totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
      files: [...extractedFiles, ...failedFiles].map((file) => ({
        name: file.name,
        kind: file.kind,
        size: file.size || 0,
      })),
      processing,
    };
    await appendHistory(historyEntry);

    res.json({
      result,
      model,
      processing,
      outputName,
      downloadName: outputName,
      title: output.title,
      extractedPreview: combined,
      files: extractedFiles.map((file) => ({
        name: file.name,
        kind: file.kind,
        size: file.size || 0,
        length: file.text.length,
      })),
      failedFiles,
      history: await readHistory(),
    });
  } catch (error) {
    next(error);
  } finally {
    await removeUploadedFiles(files);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || error.statusCode || 500;
  const message = error.message || "服务发生未知错误。";
  res.status(status).json({ error: message });
});

async function startServer(options = {}) {
  await ensureDirs();
  const port = options.port ?? PORT;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      console.log(`本地服务已启动：http://localhost:${resolvedPort}`);
      console.log(`上传目录：${UPLOAD_DIR}`);
      console.log(`输出目录：${OUTPUT_DIR}`);
      resolve({ app, server, port: resolvedPort });
    });

    server.on("error", reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
};
