# 📕 SkillBook

> 用小红书的方式发现 Claude Skills

一个面向非开发者的 Claude Skills 浏览器。每个 Skill 用文字海报卡片展示，支持分类筛选、搜索、在线数据更新和 Claude API 海报生成。

## ✨ 特性

- 🎨 **小红书风格瀑布流** — 文字海报卡片，视觉优先
- 🔍 **搜索 & 分类** — 按关键词搜索，8 大分类快速筛选
- 🔄 **在线数据更新** — 直接在浏览器中从 GitHub 抓取最新 Skill 数据
- 🤖 **AI 海报生成** — 输入 Anthropic API Key，自动生成中文海报文案
- 💾 **数据导入导出** — JSON 格式，支持备份和分享
- 📱 **响应式设计** — 支持桌面、平板、手机

## 📁 项目结构

```
skillbook/
├── index.html              # 主页面（含所有逻辑）
├── public/
│   └── data/
│       └── skills.json     # 预置数据
├── scripts/
│   ├── fetch-skills.js     # CLI: 从 GitHub 抓取数据
│   └── generate-posters.js # CLI: 用 Claude API 生成海报
├── vite.config.js          # Vite 构建配置
├── vercel.json             # Vercel 部署配置
├── netlify.toml            # Netlify 部署配置
└── package.json
```

## 🚀 快速开始

### 本地开发

```bash
git clone https://github.com/aliciajia399-ops/skillbook.git
cd skillbook
npm install
npm run dev
```

### 在线使用（无需本地环境）

部署后直接在浏览器中操作：

1. 点击右上角 ⚙ 打开设置面板
2. 点击「抓取 Skill 列表」从 GitHub 获取数据
3. （可选）输入 Anthropic API Key，点击「生成海报文案」

## 🌐 部署

### Vercel（推荐）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/aliciajia399-ops/skillbook)

或手动：

1. Fork 本仓库
2. 在 [vercel.com](https://vercel.com) 导入项目
3. 自动检测 Vite 框架，一键部署

### Netlify

1. Fork 本仓库
2. 在 [netlify.com](https://app.netlify.com) 导入项目
3. 构建命令和输出目录已在 `netlify.toml` 中配置

### GitHub Pages

```bash
npm run build
# 将 dist/ 目录部署到 gh-pages 分支
```

## 🔧 CLI 工具（可选）

如果你更喜欢命令行方式更新数据：

```bash
# 从 GitHub 抓取 Skill 列表
npm run fetch

# 用 Claude API 生成海报（需要 API Key）
ANTHROPIC_API_KEY=sk-ant-xxx npm run generate
```

## 📊 数据来源

- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)
- [mattpocock/skills](https://github.com/mattpocock/skills)

## 📄 License

MIT
