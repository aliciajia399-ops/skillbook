<p align="center">
  <a href="https://skillbook.fun">
    <img src="https://img.shields.io/badge/🔴_LIVE-skillbook.fun-ff2442?style=for-the-badge" alt="Live Demo">
  </a>
</p>

<h1 align="center">📕 SkillBook</h1>

<p align="center">
  <strong>用刷小红书的方式，发现 1700+ Agent Skills</strong><br>
  <em>A new way to browse GitHub — discover Agent Skills like scrolling Xiaohongshu.</em>
</p>

<p align="center">
  <a href="https://skillbook.fun">🌐 在线体验</a> ·
  <a href="#-30-秒上手">⚡ 30 秒上手</a> ·
  <a href="#-为什么需要-skillbook">🎯 为什么需要它</a> ·
  <a href="#-参与贡献">🤝 参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/skills-1700+-ff2442" alt="Skills">
  <img src="https://img.shields.io/badge/posters-中文海报-fbbf24" alt="Posters">
  <img src="https://img.shields.io/github/last-commit/aliciajia399-ops/skillbook" alt="Last Commit">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

## 这是什么？

**Agent Skills** 是 2025 年底开始兴起的一个开放标准 —— 一种让 AI 学会新技能的格式。

它不只是 Claude 的东西。Claude Code、Cursor、Gemini CLI、Codex、GitHub Copilot、Obsidian…… 越来越多的工具都在支持同一套 Skills 格式。GitHub 上已经有几千个 Skill，覆盖写文档、做 PPT、处理数据、自动发邮件、管理项目等各种场景。

问题是：**这些 Skill 散落在几十个仓库里，全是英文，全是 SKILL.md 文件，普通人根本找不到，也看不懂。**

SkillBook 做的事情很简单：把它们变成你能看懂的中文海报卡片，让你像刷小红书一样滑着发现。

<br>

## 🎯 为什么需要 SkillBook？

Skill 是给 AI 用的，不是给你读的。但问题是——**这些 Skill 散落在 GitHub 的几十个仓库里，不管是你还是 AI，都没办法一次性全部看到。**

AI 可以自动加载已经安装的 Skill，但它不会自己去 GitHub 搜索"最近又出了什么新 Skill"。你当然也可以自己翻，但现状是这样的：

> 一个一个点进仓库、读英文 README、打开 SKILL.md、看一堆配置说明，<br>
> 才能判断「这个东西跟我有没有关系」。<br>
> 大部分人在第一步就放弃了。

SkillBook 做的就是**把散落各处的 Skill 聚合到一个地方**，然后翻译成你能看懂的中文：

- 1700+ 个 Skill，每个都有中文海报 —— 一眼看懂它能干嘛
- 按「办公提效」「写作创作」「设计媒体」「自动化」等分类浏览
- 搜中文也行，搜英文也行
- 每天自动从 GitHub + skills.sh 抓取最新的

**你不需要知道什么是 SKILL.md，滑一滑就能发现「原来 AI 还能帮我做这个」。**

<br>

## ⚡ 30 秒上手

不需要安装任何东西。打开浏览器：

**👉 [skillbook.fun](https://skillbook.fun)**

- 往下滑 → 浏览 1700+ 技能卡片
- 顶部搜索框 → 输入你想做的事（中文英文都行）
- 点击分类标签 → 按场景筛选
- 点任意卡片 → 看详情和 GitHub 原始链接
- AI 推荐 → 描述你的需求，帮你从 1700+ 里匹配

看到感兴趣的 Skill？点进详情页，复制 GitHub 链接，直接丢给你的 AI Agent 安装就能用。

<br>

## 🏗 技术架构

> *以下内容面向开发者和贡献者。*

```
skillbook/
├── index.html                 # 单文件应用（HTML + CSS + JS）
├── public/data/skills.json    # 1700+ Skills 数据（每日自动更新）
├── scripts/
│   ├── auto-fetch.js          # 自动抓取：GitHub + SkillsMP + skills.sh
│   └── auto-poster.js         # AI 生成中文海报文案
└── .github/workflows/
    └── auto-update.yml        # GitHub Actions 每日定时任务
```

### 数据从哪来？

每天自动从多个渠道抓取、去重、生成中文海报：

```
GitHub 仓库（10+ 源）──┐
skills.sh Trending ────┼──→ auto-fetch.js ──→ auto-poster.js ──→ skills.json
SkillsMP 840K+ ────────┘         │                  │
Awesome Lists 自动发现 ───────────┘            AI 生成中文海报
                                                     │
                                          GitHub Pages 自动部署
                                                     │
                                               skillbook.fun
```

### 数据来源

| 来源 | 说明 |
|---|---|
| [anthropics/skills](https://github.com/anthropics/skills) | Anthropic 官方 |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 1000+ 社区聚合 |
| [sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | 1400+ 可安装库 |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 社区精选 |
| [skills.sh](https://skills.sh) | 每日热门 Trending |
| [SkillsMP](https://skillsmp.com) | 840K+ 搜索引擎 |
| + 自动发现 | 从 Awesome Lists 解析新仓库 |

### 本地开发

```bash
git clone https://github.com/aliciajia399-ops/skillbook.git
cd skillbook
npm install
npm run dev
```

<br>

## 🤝 参与贡献

SkillBook 是一个人启动的项目，欢迎任何形式的参与：

- **⭐ Star** — 最简单的支持
- **🐛 Issues** — Bug 或功能建议
- **📡 添加数据源** — 知道新的 Skills 仓库？PR 加到 `auto-fetch.js` 的 SOURCES
- **🌍 翻译** — 英文 / 日文 / 韩文版本

<br>

## 📄 License

[MIT](LICENSE)

---

<p align="center">
  <strong>📕 <a href="https://skillbook.fun">skillbook.fun</a></strong><br>
  <sub>A new way to browse GitHub. Built for everyone, not just developers.</sub>
</p>
