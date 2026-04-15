#!/usr/bin/env node
/**
 * SkillBook Auto-Fetch
 * 
 * 从 GitHub 数据源 + SkillsMP API 批量抓取 Skills
 * 可由 GitHub Actions 定时运行，也可本地手动跑
 * 
 * 环境变量：
 *   GITHUB_TOKEN      — GitHub Personal Access Token（5000次/小时）
 *   SKILLSMP_API_KEY   — SkillsMP API Key（500次/天）
 *   ANTHROPIC_API_KEY   — Anthropic API Key（海报生成用，可选）
 *   LLM_PROVIDER       — anthropic | openrouter（默认 anthropic）
 * 
 * 用法：
 *   node scripts/auto-fetch.js
 *   node scripts/auto-fetch.js --skip-skillsmp    # 只抓 GitHub
 *   node scripts/auto-fetch.js --only-skillsmp     # 只抓 SkillsMP
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──
const DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'skills.json');
const GH_TOKEN = process.env.GITHUB_TOKEN || '';
const SMP_KEY = process.env.SKILLSMP_API_KEY || '';
const SKIP_SMP = process.argv.includes('--skip-skillsmp');
const ONLY_SMP = process.argv.includes('--only-skillsmp');

// GitHub sources — same as index.html
const SOURCES = [
  { owner:'anthropics', repo:'skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'ComposioHQ', repo:'awesome-claude-skills', branch:'master', path:'', mode:'skills-dir', enabled:true },
  { owner:'mattpocock', repo:'skills', branch:'main', path:'', mode:'skills-dir', enabled:true },
  { owner:'obra', repo:'superpowers', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'sanjay3290', repo:'ai-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'VoltAgent', repo:'awesome-agent-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'travisvn', repo:'awesome-claude-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'NeoLabHQ', repo:'context-engineering-kit', branch:'master', path:'', mode:'deep-scan', enabled:true },
];

// SkillsMP categories to fetch — focused on non-developer content
const SMP_QUERIES = [
  // 非开发者高优先
  { q: 'writing content blog', label: '写作内容' },
  { q: 'marketing SEO social media', label: '营销推广' },
  { q: 'email automation gmail outlook', label: '邮件效率' },
  { q: 'document PDF Word Excel', label: '文档处理' },
  { q: 'presentation slides pitch', label: '演示文稿' },
  { q: 'research analysis report', label: '调研分析' },
  { q: 'translation language', label: '翻译语言' },
  { q: 'resume career interview', label: '求职简历' },
  { q: 'design image poster visual', label: '设计创作' },
  { q: 'video audio podcast', label: '音视频' },
  { q: 'calendar scheduling meeting', label: '日程管理' },
  { q: 'notion obsidian notes', label: '笔记工具' },
  { q: 'customer support CRM', label: '客户管理' },
  { q: 'finance invoice accounting', label: '财务管理' },
  { q: 'ecommerce shopify product', label: '电商运营' },
  // 开发者高星
  { q: 'code review testing', label: '代码质量', sortBy: 'stars' },
  { q: 'git github automation', label: 'Git自动化', sortBy: 'stars' },
  { q: 'API development', label: 'API开发', sortBy: 'stars' },
];

// ── Category inference (same as index.html) ──
const CAT_RULES = [
  [/doc|pdf|pptx|xlsx|spreadsheet|file|invoice|resume|organiz|epub/i, '办公提效'],
  [/writ|content|article|brainstorm|edit|meeting|grill|communi|twitter|notebook/i, '写作创作'],
  [/brand|marketing|ads|lead|domain|growth|competitive|comms|internal/i, '营销增长'],
  [/design|image|canvas|gif|theme|video|visual|media|imagen/i, '设计媒体'],
  [/code|dev|git|test|build|api|mcp|architect|artifact|soft|skill|prompt|playwright|tdd|webapp|aws/i, '开发工具'],
  [/data|csv|research|database|sql|analy|postgres|deep/i, '数据分析'],
  [/auto|slack|gmail|notion|connect|workflow|shopify|stripe|hubspot|jira|zoom|discord|telegram/i, '自动化'],
  [/secur|forensic|threat|sigma|delet|metadata/i, '安全系统'],
];

function inferCat(name, desc) {
  const text = `${name} ${desc}`;
  for (const [re, cat] of CAT_RULES) if (re.test(text)) return cat;
  return '其他';
}

// ── HTTP helper ──
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const reqHeaders = {
      'User-Agent': 'SkillBook-AutoFetch/1.0',
      ...headers,
    };
    https.get({ hostname: opts.hostname, path: opts.pathname + opts.search, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          reject(new Error('RATE_LIMIT'));
        } else if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const data = {};
  for (const line of m[1].split('\n')) {
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const k = line.slice(0, ci).trim();
    const v = line.slice(ci + 1).trim().replace(/^["']|["']$/g, '');
    if (k && v) data[k] = v;
  }
  return data;
}

// ── Load existing data ──
function loadExisting() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: '2.1.0', last_updated: '', total: 0, skills: [] };
  }
}

// ── GitHub Fetch ──
async function fetchGitHubSources() {
  const ghHeaders = GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {};
  const allSkills = [];
  const existing = loadExisting();
  const existingMap = new Map(existing.skills.map(s => [`${s.author}-${s.slug}`, s]));

  console.log(`\n📦 GitHub 抓取（${SOURCES.length} 个源）`);

  for (const src of SOURCES) {
    if (!src.enabled) continue;
    const { owner, repo, branch, path: srcPath, mode } = src;
    console.log(`\n  → ${owner}/${repo}`);

    let stars = 0;
    try {
      const repoData = await httpGet(`https://api.github.com/repos/${owner}/${repo}`, ghHeaders);
      stars = repoData.stargazers_count || 0;
      console.log(`    ⭐ ${stars} stars`);
    } catch (e) {
      console.log(`    ⚠ 无法获取 star: ${e.message}`);
    }

    const contentPath = srcPath || '';
    const apiUrl = contentPath
      ? `https://api.github.com/repos/${owner}/${repo}/contents/${contentPath}?ref=${branch}`
      : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;

    let items;
    try {
      items = await httpGet(apiUrl, ghHeaders);
      if (!Array.isArray(items)) throw new Error(items.message || 'Not array');
    } catch (e) {
      console.log(`    ✗ 获取目录失败: ${e.message}`);
      continue;
    }

    const dirs = items.filter(i => i.type === 'dir');
    let found = 0;

    if (mode === 'deep-scan') {
      for (const d of dirs) {
        const sub = await fetchDirSkills(owner, repo, branch,
          `${contentPath ? contentPath + '/' : ''}${d.name}`, ghHeaders, stars, existingMap);
        allSkills.push(...sub);
        found += sub.length;
        await sleep(100);
      }
    } else {
      for (const d of dirs) {
        const dirPath = contentPath ? `${contentPath}/${d.name}` : d.name;
        try {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dirPath}/SKILL.md`;
          const md = await httpGet(rawUrl, {});
          if (typeof md !== 'string') continue;
          const fm = parseFrontmatter(md);
          const name = fm.name || d.name;
          const description = fm.description || '';
          const body = md.replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 500);
          const key = `${owner}-${d.name}`;
          const prev = existingMap.get(key);

          allSkills.push({
            id: key,
            slug: d.name,
            name,
            description,
            content: body,
            cat: inferCat(name, description + ' ' + body),
            author: owner,
            stars,
            url: `https://github.com/${owner}/${repo}/tree/${branch}/${dirPath}`,
            // Preserve existing poster data
            poster: prev?.poster || null,
            title_zh: prev?.title_zh || null,
            desc_zh: prev?.desc_zh || null,
            tags: prev?.tags || [],
            audience: prev?.audience || null,
          });
          found++;
        } catch {}
        await sleep(100);
      }
    }

    console.log(`    ✓ ${found} 个 Skills`);
  }

  return allSkills;
}

async function fetchDirSkills(owner, repo, branch, dirPath, headers, stars, existingMap) {
  const results = [];
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dirPath}/SKILL.md`;
    const md = await httpGet(rawUrl, {});
    if (typeof md === 'string') {
      const fm = parseFrontmatter(md);
      const slug = dirPath.split('/').pop();
      const name = fm.name || slug;
      const description = fm.description || '';
      const body = md.replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 500);
      const key = `${owner}-${slug}`;
      const prev = existingMap.get(key);

      results.push({
        id: key, slug, name, description, content: body,
        cat: inferCat(name, description + ' ' + body),
        author: owner, stars,
        url: `https://github.com/${owner}/${repo}/tree/${branch}/${dirPath}`,
        poster: prev?.poster || null,
        title_zh: prev?.title_zh || null,
        desc_zh: prev?.desc_zh || null,
        tags: prev?.tags || [],
        audience: prev?.audience || null,
      });
      return results;
    }
  } catch {}

  try {
    const items = await httpGet(
      `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${branch}`, headers);
    if (Array.isArray(items)) {
      for (const sd of items.filter(i => i.type === 'dir')) {
        const sub = await fetchDirSkills(owner, repo, branch, `${dirPath}/${sd.name}`, headers, stars, existingMap);
        results.push(...sub);
        await sleep(100);
      }
    }
  } catch {}
  return results;
}

// ── SkillsMP Fetch ──
async function fetchSkillsMP() {
  console.log(`\n🔌 SkillsMP 批量抓取（${SMP_QUERIES.length} 个分类）`);
  const existing = loadExisting();
  const existingMap = new Map(existing.skills.map(s => [`${s.author}-${s.slug}`, s]));
  const allResults = [];
  const seenIds = new Set();

  const headers = {};
  if (SMP_KEY) {
    headers['Authorization'] = `Bearer ${SMP_KEY}`;
    console.log('  🔑 使用 API Key（500次/天）');
  } else {
    console.log('  ⚠ 匿名模式（50次/天）— 建议设置 SKILLSMP_API_KEY');
  }

  const delay = SMP_KEY ? 2500 : 7000; // Rate limit safe intervals

  for (const query of SMP_QUERIES) {
    const sortBy = query.sortBy || 'stars';
    const url = `https://skillsmp.com/api/v1/skills/search?q=${encodeURIComponent(query.q)}&limit=50&sortBy=${sortBy}`;

    try {
      console.log(`  🔍 ${query.label}: "${query.q}"`);
      const data = await httpGet(url, headers);
      let skills = [];
      if (data.success && data.data && data.data.skills) skills = data.data.skills;
      else if (data.data && Array.isArray(data.data)) skills = data.data;
      else if (data.skills && Array.isArray(data.skills)) skills = data.skills;

      let added = 0;
      for (const raw of skills) {
        const id = `smp-${raw.id || raw.name || ''}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const slug = raw.name || raw.slug || 'unknown';
        const key = `${raw.author || 'unknown'}-${slug}`;
        const prev = existingMap.get(key);

        allResults.push({
          id,
          slug,
          name: raw.name || slug,
          author: raw.author || 'unknown',
          description: raw.description || '',
          content: raw.content || raw.description || '',
          url: raw.githubUrl || raw.url || '#',
          stars: raw.stars || 0,
          cat: inferCat(raw.name || '', raw.description || ''),
          _source: 'skillsmp',
          poster: prev?.poster || null,
          title_zh: prev?.title_zh || null,
          desc_zh: prev?.desc_zh || null,
          tags: prev?.tags || [],
          audience: prev?.audience || null,
        });
        added++;
      }
      console.log(`    ✓ ${added} 个新 Skills（共 ${skills.length} 结果）`);
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        console.log(`    ⚠ 速率限制！等待 60 秒...`);
        await sleep(60000);
      } else {
        console.log(`    ✗ ${e.message}`);
      }
    }

    await sleep(delay);
  }

  return allResults;
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════');
  console.log('  SkillBook Auto-Fetch');
  console.log('═══════════════════════════════════');
  console.log(`  时间: ${new Date().toISOString()}`);
  console.log(`  GitHub Token: ${GH_TOKEN ? '✓' : '✗'}`);
  console.log(`  SkillsMP Key: ${SMP_KEY ? '✓' : '✗'}`);

  const existing = loadExisting();
  console.log(`  现有数据: ${existing.skills.length} 个 Skills`);

  let ghSkills = [];
  let smpSkills = [];

  // Step 1: GitHub fetch
  if (!ONLY_SMP) {
    ghSkills = await fetchGitHubSources();
    console.log(`\n  GitHub 总计: ${ghSkills.length} 个`);
  }

  // Step 2: SkillsMP fetch
  if (!SKIP_SMP) {
    smpSkills = await fetchSkillsMP();
    console.log(`\n  SkillsMP 总计: ${smpSkills.length} 个`);
  }

  // Step 3: Merge & deduplicate
  const all = [...ghSkills, ...smpSkills];
  const seen = new Map();
  for (const s of all) {
    const key = `${s.author}-${s.slug}`.toLowerCase();
    if (!seen.has(key) || (s.poster && !seen.get(key).poster)) {
      seen.set(key, s);
    }
  }
  // Also merge in existing skills that weren't re-fetched
  for (const s of existing.skills) {
    const key = `${s.author}-${s.slug}`.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, s);
    }
  }

  const deduped = [...seen.values()];

  // Step 4: Save
  const newData = {
    version: '2.1.0',
    last_updated: new Date().toISOString().split('T')[0],
    total: deduped.length,
    skills: deduped,
  };

  // Ensure directory exists
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2));

  const noPoster = deduped.filter(s => !s.poster).length;
  console.log('\n═══════════════════════════════════');
  console.log(`  ✓ 保存完毕: ${deduped.length} 个 Skills`);
  console.log(`    有海报: ${deduped.length - noPoster}`);
  console.log(`    缺海报: ${noPoster}`);
  console.log(`    文件: ${DATA_PATH}`);
  console.log('═══════════════════════════════════');

  return noPoster;
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
