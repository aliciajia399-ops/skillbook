#!/usr/bin/env node
/**
 * SkillBook Auto-Poster
 * 
 * 为没有海报的 Skills 自动生成中文海报文案
 * 支持断点续传：中途中断后重新运行只处理剩余的
 * 
 * 环境变量：
 *   ANTHROPIC_API_KEY  — Anthropic API Key
 *   OPENROUTER_KEY     — 或者用 OpenRouter Key
 *   LLM_PROVIDER       — anthropic | openrouter（默认 anthropic）
 *   BATCH_SIZE         — 每批处理数量（默认 8）
 *   BATCH_DELAY        — 批次间隔毫秒（默认 1500）
 * 
 * 用法：
 *   node scripts/auto-poster.js              # 只补没有海报的
 *   node scripts/auto-poster.js --force-all   # 全部重新生成
 *   node scripts/auto-poster.js --max 50      # 最多处理 50 个
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'skills.json');
const PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_KEY || '';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '8');
const BATCH_DELAY = parseInt(process.env.BATCH_DELAY || '1500');
const FORCE_ALL = process.argv.includes('--force-all');
const MAX_IDX = process.argv.indexOf('--max');
const MAX_COUNT = MAX_IDX >= 0 ? parseInt(process.argv[MAX_IDX + 1] || '999') : 999;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── LLM Call ──
function callLLM(prompt) {
  return new Promise((resolve, reject) => {
    let hostname, reqPath, headers, body;

    if (PROVIDER === 'anthropic') {
      hostname = 'api.anthropic.com';
      reqPath = '/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
    } else {
      hostname = 'openrouter.ai';
      reqPath = '/api/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://github.com/aliciajia399-ops/skillbook',
        'X-Title': 'SkillBook',
      };
      body = JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
    }

    const req = https.request({
      hostname, path: reqPath, method: 'POST', headers: {
        ...headers, 'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`API ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (PROVIDER === 'anthropic') {
            resolve(parsed.content?.[0]?.text || '');
          } else {
            resolve(parsed.choices?.[0]?.message?.content || '');
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── The Prompt (利他 version) ──
function buildPrompt(entries) {
  return `你是小红书爆款文案专家，现在要为 AI 工具写「推荐卡片」。你的目标读者不是开发者，而是普通职场人、学生、自媒体创作者。

核心原则：像给朋友安利好物一样写——"我发现了一个超好用的东西，你一定要试试"。

每个 Skill 有 slug、name、英文描述（desc）和正文摘要（content）。请仔细读懂它到底能做什么，然后用「利他」的角度生成内容。

输出 JSON 数组，每个对象：
- "slug": 原样返回
- "audience": "所有人" | "创作者" | "职场人" | "开发者" — 判断这个工具最适合谁
- "title_zh": 中文短标题（4-10字）—— 必须让人一看就知道「用了它我能得到什么好处」
  ✗ 不要写：Gmail助手、PDF全能助手、Word 助手、代码审查工具
  ✓ 要写：50封邮件5分钟清完、PDF合同秒翻中文、年终总结一键生成、代码上线前自动体检
  标题要有具体场景或具体好处，不能是泛泛的「XX助手」「XX专家」「XX工具」

- "poster": 2-4 行中文海报文案，用 \\n 连接
  · 第一行：用一个具体场景或痛点开头（让读者觉得「说的就是我」）
  · 中间行：这个工具怎么解决问题（要有画面感）
  · 用 <hl></hl> 高亮最抓眼球的 1-2 个词
  · 绝对不要出现：API、SDK、CLI、框架、组件、服务器、部署、编译、重构 这类术语
  · 如果这个工具确实是开发者专用的，可以用开发者能共情的场景

- "desc_zh": 1-2 句「给朋友发微信推荐这个工具时你会怎么说」—— 口语、具体、有好处

- "tags": 2-3 个标签，用普通人能搜到的词

对比示例（差 vs 好）：

slug: gmail
  差：标题「Gmail助手」海报「Claude 帮你 | 管理 | Gmail」
  好：标题「50封邮件5分钟清完」海报「周一打开邮箱\\n<hl>99+</hl> 未读\\nClaude 帮你分类回复\\n重要的一封不漏」

slug: docx
  差：标题「Word 助手」海报「用 Claude | 帮你写 | Word 文档」
  好：标题「年终总结一键生成」海报「领导突然要<hl>述职报告</hl>\\n把你今年干的事\\n丢给 Claude\\n排版好的 Word <hl>直接交</hl>」

Skills:
${entries}

仅返回合法 JSON 数组，不要 markdown 或其他文字。`;
}

// ── Main ──
async function main() {
  if (!API_KEY) {
    console.error('❌ 请设置 ANTHROPIC_API_KEY 或 OPENROUTER_KEY 环境变量');
    process.exit(1);
  }

  console.log('═══════════════════════════════════');
  console.log('  SkillBook Auto-Poster');
  console.log('═══════════════════════════════════');
  console.log(`  Provider: ${PROVIDER}`);
  console.log(`  Batch: ${BATCH_SIZE} / delay ${BATCH_DELAY}ms`);
  console.log(`  Mode: ${FORCE_ALL ? '全部重新生成' : '仅补缺'}`);

  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch (e) {
    console.error(`❌ 无法读取 ${DATA_PATH}: ${e.message}`);
    process.exit(1);
  }

  const skills = data.skills || [];
  const pending = FORCE_ALL ? [...skills] : skills.filter(s => !s.poster);
  const toProcess = pending.slice(0, MAX_COUNT);

  console.log(`  总计: ${skills.length} 个 Skills`);
  console.log(`  待处理: ${toProcess.length} 个`);

  if (!toProcess.length) {
    console.log('  ✓ 全部已有海报，无需生成');
    return;
  }

  let done = 0;
  let failed = 0;
  const totalBatches = Math.ceil(toProcess.length / BATCH_SIZE);

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    const entries = batch.map(s =>
      `- slug: ${s.slug}\n  name: ${s.name}\n  desc: ${(s.description || '').slice(0, 200) || 'N/A'}\n  content: ${(s.content || '').slice(0, 300) || 'N/A'}`
    ).join('\n');

    console.log(`\n  Batch ${batchNum}/${totalBatches} (${batch.map(s => s.slug).join(', ')})`);

    try {
      const raw = await callLLM(buildPrompt(entries));
      const results = JSON.parse(raw.replace(/```json|```/g, '').trim());

      for (const r of results) {
        const skill = skills.find(s => s.slug === r.slug);
        if (skill) {
          skill.poster = r.poster;
          skill.title_zh = r.title_zh;
          skill.desc_zh = r.desc_zh;
          skill.tags = r.tags || [];
          skill.audience = r.audience || '';
          done++;
        }
      }
      console.log(`    ✓ ${results.length} 个完成`);

      // Save after each batch (checkpoint)
      data.skills = skills;
      data.last_updated = new Date().toISOString().split('T')[0];
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

    } catch (e) {
      console.log(`    ✗ ${e.message}`);
      failed++;

      // If rate limited, wait longer
      if (e.message.includes('429') || e.message.includes('rate')) {
        console.log('    ⏳ Rate limited, waiting 30s...');
        await sleep(30000);
      }
    }

    await sleep(BATCH_DELAY);
  }

  console.log('\n═══════════════════════════════════');
  console.log(`  ✓ 完成: ${done} 个海报生成`);
  console.log(`  ✗ 失败: ${failed} 批`);
  console.log(`  剩余无海报: ${skills.filter(s => !s.poster).length}`);
  console.log('═══════════════════════════════════');
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
