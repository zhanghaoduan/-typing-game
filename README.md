# 英语打字闯关 English Typing Adventure

七年级下册英语打字练习游戏 / Grade 7 Semester 2 English Typing Game

## 📁 项目结构 Project Structure

```
typing-game/
├── index.html          # 主页面 Main HTML
├── css/
│   └── style.css       # 样式文件 Stylesheet
├── js/
│   ├── app.js          # 应用主逻辑 Main app logic
│   ├── game.js         # 游戏引擎 Game engine
│   ├── audio.js        # 语音和音效 Speech & sound effects
│   └── storage.js      # 本地存储 localStorage management
├── data/
│   └── modules.json    # 词汇数据 Vocabulary data (editable!)
├── assets/
│   └── sounds/         # (Reserved for future audio files)
└── README.md           # 本文件 This file
```

## 🚀 如何运行 How to Run

### 方法一：直接用浏览器打开（推荐）
### Method 1: Open directly in browser (Recommended)

由于使用了 `fetch()` 加载 JSON 数据，需要通过 HTTP 服务器运行。

**最简单的方式 - 使用 Python：**
```bash
cd typing-game
python -m http.server 8000
```
然后在浏览器打开 http://localhost:8000

**或使用 Node.js：**
```bash
npx serve typing-game
```

**或使用 VS Code Live Server 插件：**
右键 index.html → "Open with Live Server"

### 方法二：使用 VS Code
直接安装 "Live Server" 扩展，右键 index.html 启动。

## 🎮 游戏功能 Features

### 游戏模式 Game Modes
1. **闯关模式 Level Mode** - 10个递进关卡
2. **模块练习 Module Practice** - 按主题选择练习
3. **单词模式 Word Mode** - 输入单词
4. **短语模式 Phrase Mode** - 输入短语
5. **句子模式 Sentence Mode** - 输入句子
6. **听力模式 Listening Mode** - 听音输入
7. **混合模式 Mixed Mode** - 随机混合

### 关卡系统 Level System
- 10个关卡，从易到难
- 每关有时间限制和生命值
- 通关获得1-3星
- 前一关通过才能解锁下一关

### 奖励系统 Reward System
- ⭐ 星星：每关最多3星
- 🪙 金币：正确答案和速度奖励
- 🏅 成就徽章：10种不同成就
- 🔥 连续签到奖励
- 🎉 过关庆祝动画

### 其他功能 Other Features
- 📊 本地排行榜
- 📝 错题本（自动记录错误答案）
- 🎨 3种主题切换（默认/太空/冒险）
- 🔊 语音朗读（Web Speech API）
- 💾 自动保存进度

## 📝 教师自定义指南 Teacher Customization Guide

### 修改词汇内容 Edit Vocabulary

打开 `data/modules.json`，按照以下格式添加或修改：

```json
{
  "id": "m11",
  "name": "Your Topic",
  "nameCN": "你的主题",
  "icon": "🌈",
  "words": [
    { "en": "english_word", "cn": "中文意思", "difficulty": 1 }
  ],
  "phrases": [
    { "en": "english phrase", "cn": "中文意思", "difficulty": 1 }
  ],
  "sentences": [
    { "en": "Full sentence here.", "cn": "完整句子翻译。", "difficulty": 2 }
  ]
}
```

**难度级别 Difficulty Levels:**
- 1 = 简单 Easy
- 2 = 中等 Medium
- 3 = 困难 Hard

### 修改关卡设置 Edit Level Settings

在 `js/game.js` 中找到 `LEVELS` 数组，可以修改：
- `itemCount` - 每关题目数量
- `timeLimit` - 时间限制（秒）
- `passScore` - 及格分数比例
- `lives` - 生命数
- `difficulty` - 难度级别

### 修改主题颜色 Edit Theme Colors

在 `css/style.css` 顶部的 `:root` 中修改 CSS 变量。

## 🌐 部署到 GitHub Pages

1. 在 GitHub 创建新仓库
2. 将项目文件推送到仓库：
```bash
cd typing-game
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/你的用户名/typing-game.git
git push -u origin main
```
3. 进入仓库 Settings → Pages
4. Source 选择 "Deploy from a branch"
5. Branch 选择 "main" → "/ (root)"
6. 保存后等待几分钟即可访问

## 🔊 浏览器语音兼容性 Speech Synthesis Compatibility

Web Speech API 语音合成兼容性：

| 浏览器 Browser | 支持 Support | 备注 Notes |
|---|---|---|
| Chrome 33+ | ✅ 完全支持 | 推荐使用 Recommended |
| Edge 14+ | ✅ 完全支持 | 语音质量好 Good quality |
| Firefox 49+ | ✅ 支持 | 部分语音有限 Limited voices |
| Safari 7+ | ✅ 支持 | macOS/iOS |
| Opera 21+ | ✅ 支持 | 基于Chromium |

**注意事项 Notes:**
- 首次使用时浏览器可能需要用户交互才能播放语音
- 不同浏览器可用的英语语音（口音）不同
- Chrome 通常有最多的语音选择
- 如果语音不可用，游戏仍可正常使用（仅听力模式受影响）

## 📐 技术说明 Technical Notes

- 纯前端实现，无需后端服务器
- 使用 localStorage 保存所有进度
- 音效使用 Web Audio API 程序化生成（无需音频文件）
- 语音使用 Web Speech API SpeechSynthesis
- 支持桌面浏览器，推荐 Chrome/Edge
- 代码模块化，易于扩展

## 📋 版本记录 Changelog

### v1.0.0
- 初始版本
- 10个关卡，10个词汇模块
- 完整奖励和成就系统
- 语音朗读支持
- 3种主题
- 错题本和排行榜

## 🤖 可选 AI 句子识图

- 句子题图片现在支持可选的 AI 识图补全通道。
- 普通图片 OCR 现已支持优先走 Azure **Document Intelligence Layout**，未配置时自动回退到浏览器 Tesseract OCR。
- 服务端环境变量（任选一组命名）：
  - `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` + `AZURE_DOCUMENT_INTELLIGENCE_API_KEY`
  - `DOCUMENT_INTELLIGENCE_ENDPOINT` + `DOCUMENT_INTELLIGENCE_API_KEY`
  - `FORM_RECOGNIZER_ENDPOINT` + `FORM_RECOGNIZER_KEY`
  - 可选：`DOCUMENT_INTELLIGENCE_API_VERSION`（默认 `2024-11-30`）、`DOCUMENT_INTELLIGENCE_MODEL`（默认 `prebuilt-layout`）
- 识别统计区域会显示每张图片的 OCR 来源和平均准确率（按识别词置信度汇总）。
- 如果服务端配置了以下任一组环境变量，前端在识别“句子”类图片时会优先调用 AI 提取完整句子：
  - `DASHSCOPE_API_KEY`，可选 `DASHSCOPE_VISION_MODEL`、`DASHSCOPE_BASE_URL`
  - `GEMINI_API_KEY`，可选 `GEMINI_VISION_MODEL`
  - `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_DEPLOYMENT`，可选 `AZURE_OPENAI_API_VERSION`
  - `OPENAI_API_KEY`，可选 `OPENAI_VISION_MODEL`
  - `GITHUB_TOKEN` + `GITHUB_MODELS_MODEL`
  - `OCR_VISION_API_KEY` + `OCR_VISION_MODEL`，可选 `OCR_VISION_BASE_URL`
- 未配置时会自动回退到原有 OCR 逻辑。

## 🧠 DeepSeek 智能分类（单词 / 词组 / 句子）

- OCR 完成后，可选地调用 DeepSeek 对识别到的所有条目重新分类，按图片原始序号顺序整理到「单词 / 词组 / 句子」三类中。
- 服务端环境变量：
  - `DEEPSEEK_API_KEY`（必填，启用此功能）
  - `DEEPSEEK_MODEL`（可选，默认 `deepseek-chat`）
  - `DEEPSEEK_BASE_URL`（可选，默认 `https://api.deepseek.com/chat/completions`）
- 未配置时前端会跳过分类步骤，沿用原有 OCR/AI 解析结果，不影响其他功能。

## 🎓 管理员智能录入（PDF / Word / Excel 等材料）

管理面板新增「🎓 智能录入 Smart Import」标签，仅管理员可见，用于上传老师提供的各类材料并智能生成练习单元。

- 支持的文件类型：`.pdf`、`.docx`、`.xls` / `.xlsx`、`.csv`、`.txt`（旧版 `.doc` 请另存为 `.docx`）。
- 上传后服务端会自动提取文字，并智能拆分为「单词 / 词组 / 句子」三类，同时给出中文释义；可在保存前校对编辑。
- 文件名会作为提示，自动识别出版社、年级、册别、单元号。例如 `2025春七下新外研版英语单词中译英Unit1.pdf` → 外研版 / 七年级下 / 下册 / Unit 1。
- 保存即生成可反复练习的单元，可勾选「设为公开」让所有学生在作业本中练习。

### 依赖与配置

- 服务端依赖：`pdf-parse`、`mammoth`、`xlsx`（已加入 `server/package.json`，部署时运行 `npm install` 即可）。
- 智能拆分优先调用大模型（按以下顺序复用环境变量）：
  - `DEEPSEEK_API_KEY`（可选 `DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL`）
  - `OPENAI_API_KEY`（可选 `OPENAI_MODEL`、`OPENAI_BASE_URL`）
  - `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_DEPLOYMENT`
  - `DASHSCOPE_API_KEY` / `GITHUB_TOKEN` + `GITHUB_MODELS_MODEL` / `OCR_VISION_API_KEY` + `OCR_VISION_MODEL`
- 未配置任何模型时，会自动回退到本地规则解析（按行拆分、识别英文/中文并按结构分类），功能仍可用。
- 纯图片扫描的 PDF（无可选中文字）无法提取文字，请使用「📚 我的作业本」的图片 OCR 功能。
