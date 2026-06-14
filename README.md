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
