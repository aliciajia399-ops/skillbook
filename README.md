# SkillBook 📕

用小红书的方式发现 Claude Skills。

## 快速开始

```bash
# 1. 安装
npm install

# 2. 从 GitHub 抓取真实 Skill 数据
npm run fetch

# 3. (可选) 用 Claude API 生成中文海报文案
ANTHROPIC_API_KEY=sk-ant-xxx npm run generate

# 4. 本地预览
npm run dev
```

打开 http://localhost:5173 即可看到效果。

## 部署到 GitHub Pages

1. Fork 这个仓库
2. 在 Settings → Pages 中选择 GitHub Actions 作为 Source
3. (可选) 在 Settings → Secrets 中添加 `ANTHROPIC_API_KEY` 以启用自动生成中文海报
4. 推送代码，GitHub Actions 会自动构建并部署

## 不想用 API？

完全没问题。`npm run fetch` 抓取数据后，直接编辑 `public/data/skills.json`：

```json
{
  "slug": "grill-me",
  "poster": "在发布前\\n让 AI\\n<hl>质疑</hl>你的\\n每一个<hl>假设</hl>",
  "title_zh": "观点质疑器",
  "desc_zh": "对你的方案提出尖锐问题，帮你发现盲点。"
}
```

或者，把 `skills.json` 的内容粘贴到 Claude 对话里，让它帮你翻译——用的就是你的 Pro/Max 额度。

## 项目结构

```
skillbook/
├── index.html              ← 小红书风格的前端页面
├── public/data/skills.json  ← Skill 数据 (由脚本自动生成)
├── scripts/
│   ├── fetch-skills.js      ← 从 GitHub 抓取 SKILL.md
│   └── generate-posters.js  ← 用 Claude API 生成中文文案
├── .github/workflows/
│   └── deploy.yml           ← 自动同步 + 部署
└── package.json
```

## License

MIT
