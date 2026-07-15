# 资料清洗工具

这是一个本地桌面工具，用 OpenAI 兼容 API 把多种资料清洗成 Markdown。

## 使用方式

### 桌面版

1. 打开 `dist/资料清洗工具-0.2.3-arm64.dmg`。
2. 把 App 拖到“应用程序”。
3. 第一次打开时填写 API Key、OpenAI 兼容地址、文本模型和 OCR 模型。
4. 之后可通过右上角“设置”随时更换模型或 API Key；不填写 API Key 保存时会继续使用本机已保存的 Key。
5. 右上角“检查更新”会读取 GitHub Releases，发现新版后打开下载页，由用户手动下载新版 DMG。

这是未签名内测包。如果 macOS 提示无法打开，可以在“系统设置 → 隐私与安全性”里允许打开，或右键 App 后选择“打开”。

### 本地开发版

1. 复制 `.env.example` 为 `.env`，填写 `API_KEY`。
2. 双击 `启动资料清洗工具.command`。
3. 浏览器打开后，上传文件。
4. 输入本次任务说明。
5. 点击“生成 Markdown”，复制清洗结果。

## 支持格式

- `.txt` / `.md`：直接读取文本。
- `.pdf`：优先提取可复制文字；扫描件会逐页转图片并调用 OCR。
- `.pptx`：提取幻灯片里的文本。
- `.png` / `.jpg` / `.jpeg` / `.webp`：调用 OCR 模型识别图片文字。

当前版本暂不支持老版 `.ppt`。扫描 PDF 自动 OCR 最多处理 30 页，超过时请拆分文件后重试。

## 当前推荐配置

```env
API_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
TEXT_MODEL=qwen-plus
OCR_MODEL=qwen-vl-ocr-latest
DIRECT_CLEAN_LIMIT=12000
CHUNK_SIZE=8000
```

`qwen-plus` 负责最终资料清洗，`qwen-vl-ocr-latest` 负责图片和扫描 PDF 的 OCR。

当提取出的文字超过 `DIRECT_CLEAN_LIMIT` 时，工具会自动按 `CHUNK_SIZE` 分段处理，再把分段结果合并成最终 Markdown。分段由本地代码完成，不会额外引入模型。

## 说明

- API Key 只放在本地 `.env` 文件里，前端页面不会直接接触 API Key。
- 桌面版不会打包你的 `.env`。用户自己的 API 配置会保存在本机应用数据目录。
- 应用只做更新提醒，不做静默安装。新版通过 GitHub Releases 下载 DMG 后手动替换。
- 上传文件会临时保存在 `uploads/`，请求结束后自动清理。
- 清洗结果会保存到 `output/`，网页上也会直接展示 Markdown。
- “花哨 PPT”模式会同时影响图片 OCR 和最终清洗，尽量去掉版式、位置、颜色、箭头等视觉描述。
- 最近 10 次处理记录会保存在 `logs/history.json`，只记录文件、模型、处理方式、输出文件名等元信息，不保存完整结果。
- 输出文件名会优先从最终 Markdown 的一级标题提取；没有标题时使用第一个上传文件名。

## 更新记录

### v0.2.2

- 清洗结果新增“预览 / 源码”双视图。
- 一键复制会根据当前视图复制预览内容或 Markdown 源码。

### v0.2.3

- 应用展示名改为“资料清洗工具”。
- 设置和文档改为 OpenAI 兼容 API 表述，不再限定某个模型平台。
- 保持一套 API 配置，文本整理和 OCR 共用同一个 API Key。

## 发布新版

1. 修改 `package.json` 里的 `version`。
2. 运行 `npm install` 确保依赖完整。
3. 运行 `npm run release:mac` 生成 DMG。
4. 在 GitHub Releases 创建 `v版本号`，上传 `dist/资料清洗工具-版本号-arm64.dmg`。
5. 用户点击应用内“检查更新”即可看到新版。
