#!/usr/bin/env node
/**
 * SkillBook Auto-Fetch v2.3
 * 
 * 从 GitHub 数据源 + SkillsMP API + skills.sh Trending + Awesome Lists 自动抓取 Skills
 * 可由 GitHub Actions 定时运行，也可本地手动跑
 * 
 * v2.3 新增：
 *   - skills.sh Trending API：每日自动抓取最近24小时热门 skill
 *   - 自动从 awesome 列表 README 发现新的 skill 仓库
 *   - 新增多个数据源（VoltAgent、travisvn、sickn33、BehiSecc 等）
 *   - 去重逻辑优化，避免同名 skill 重复计数
 * 
 * 环境变量：
 *   GITHUB_TOKEN       — GitHub Personal Access Token（5000次/小时）
 *   SKILLSMP_API_KEY   — SkillsMP API Key（500次/天）
 *   LLM_PROVIDER       — anthropic | openrouter（默认 anthropic）
 * 
 * 用法：
 *   node scripts/auto-fetch.js
 *   node scripts/auto-fetch.js --skip-skillsmp
 *   node scripts/auto-fetch.js --skip-discover     # 跳过自动发现
 *   node scripts/auto-fetch.js --skip-trending      # 跳过 skills.sh trending
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ──
const DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'skills.json');
const GH_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const SMP_KEY = (process.env.SKILLSMP_API_KEY || '').trim();
const SKIP_SMP = process.argv.includes('--skip-skillsmp');
const ONLY_SMP = process.argv.includes('--only-skillsmp');
const SKIP_DISCOVER = process.argv.includes('--skip-discover');
const SKIP_TRENDING = process.argv.includes('--skip-trending');

// ── Static GitHub sources ──
const SOURCES = [
  // ═══ Official & Major ═══
  { owner:'anthropics', repo:'skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'ComposioHQ', repo:'awesome-claude-skills', branch:'master', path:'', mode:'skills-dir', enabled:true },
  { owner:'mattpocock', repo:'skills', branch:'main', path:'', mode:'skills-dir', enabled:true },
  { owner:'obra', repo:'superpowers', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'sanjay3290', repo:'ai-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'NeoLabHQ', repo:'context-engineering-kit', branch:'master', path:'', mode:'deep-scan', enabled:true },

  // ═══ 大型聚合仓库（v2.2 启用）═══
  { owner:'VoltAgent', repo:'awesome-agent-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'travisvn', repo:'awesome-claude-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:true },
  { owner:'sickn33', repo:'antigravity-awesome-skills', branch:'main', path:'skills', mode:'deep-scan', enabled:true },
  { owner:'BehiSecc', repo:'awesome-claude-skills', branch:'main', path:'', mode:'skills-dir', enabled:true },

  // ═══ 可选（手动启用）═══
  { owner:'google-labs-code', repo:'agent-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:false },
  { owner:'duckdb', repo:'agent-skills', branch:'main', path:'skills', mode:'skills-dir', enabled:false },
];

// ── Awesome lists to auto-discover new repos from ──
const AWESOME_LISTS = [
  { owner:'ComposioHQ', repo:'awesome-claude-skills', branch:'master', file:'README.md' },
  { owner:'VoltAgent', repo:'awesome-agent-skills', branch:'main', file:'README.md' },
  { owner:'travisvn', repo:'awesome-claude-skills', branch:'main', file:'README.md' },
  { owner:'BehiSecc', repo:'awesome-claude-skills', branch:'main', file:'README.md' },
];

// SkillsMP categories to fetch
const SMP_QUERIES = [
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
  { q: 'code review testing', label: '代码质量', sortBy: 'stars' },
  { q: 'git github automation', label: 'Git自动化', sortBy: 'stars' },
  { q: 'API development', label: 'API开发', sortBy: 'stars' },
];

// ── Category inference ──
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
      'User-Agent': 'SkillBook-AutoFetch/2.2',
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
    return { version: '2.3.0', last_updated: '', total: 0, skills: [] };
  }
}

// ══════════════════════════════════════════════════════
//  NEW: Auto-discover repos from awesome list READMEs
// ══════════════════════════════════════════════════════

async function discoverNewSources() {
  console.log(`\n🔍 自动发现新数据源（${AWESOME_LISTS.length} 个 Awesome 列表）`);
  const ghHeaders = GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {};

  // Build set of already-known repos
  const knownRepos = new Set(SOURCES.map(s => `${s.owner}/${s.repo}`.toLowerCase()));
  const discovered = [];

  // Repos to skip (meta/non-skill repos, or known to not have SKILL.md structure)
  const SKIP_REPOS = new Set([
    'anthropics/courses',
    'anthropics/anthropic-cookbook',
    'anthropics/anthropic-sdk-python',
    'anthropics/anthropic-sdk-typescript',
    'modelcontextprotocol/servers',
    'punkpeye/awesome-mcp-servers',
    'hesreallyhim/awesome-claude-code',
    'rohitg00/awesome-claude-code-toolkit',
  ]);

  for (const list of AWESOME_LISTS) {
    const url = `https://raw.githubusercontent.com/${list.owner}/${list.repo}/${list.branch}/${list.file}`;
    try {
      console.log(`  📄 ${list.owner}/${list.repo}/${list.file}`);
      const readme = await httpGet(url, ghHeaders);
      if (typeof readme !== 'string') continue;

      // Extract GitHub repo links from README
      // Patterns: github.com/owner/repo, github.com/owner/repo/tree/branch/path
      const repoPattern = /github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\/tree\/([a-zA-Z0-9_.-]+)(?:\/([^\s)#"',]+))?)?(?:[\s)#"',]|$)/g;
      let match;
      const seen = new Set();

      while ((match = repoPattern.exec(readme)) !== null) {
        const owner = match[1];
        const repo = match[2].replace(/\.git$/, '');
        const branch = match[3] || null;
        const subpath = match[4] || null;
        const key = `${owner}/${repo}`.toLowerCase();

        // Skip if already known, already seen in this run, or in skip list
        if (knownRepos.has(key) || seen.has(key) || SKIP_REPOS.has(key)) continue;
        // Skip if it's one of the awesome lists themselves
        if (AWESOME_LISTS.some(l => `${l.owner}/${l.repo}`.toLowerCase() === key)) continue;
        // Skip obvious non-skill repos
        if (repo.includes('awesome-') || repo.includes('cookbook') || repo.includes('sdk')) continue;
        seen.add(key);

        discovered.push({
          owner,
          repo,
          branch: branch || 'main',
          path: subpath || '',
          mode: 'skills-dir',
          enabled: true,
          _discovered: true,
          _from: `${list.owner}/${list.repo}`,
        });
      }

      console.log(`    → 发现 ${seen.size} 个新仓库链接`);
    } catch (e) {
      console.log(`    ✗ ${e.message}`);
    }
    await sleep(200);
  }

  // Validate discovered repos: check if they actually have SKILL.md files
  console.log(`\n  🔎 验证 ${discovered.length} 个候选仓库...`);
  const validated = [];
  let checked = 0;

  for (const src of discovered) {
    if (checked >= 30) {
      console.log(`    ⚠ 已检查 30 个，跳过剩余 ${discovered.length - checked} 个`);
      break;
    }
    checked++;

    try {
      // First try: check if repo has a skills/ directory or SKILL.md in root
      const contentPath = src.path || 'skills';
      const apiUrl = `https://api.github.com/repos/${src.owner}/${src.repo}/contents/${contentPath}?ref=${src.branch}`;
      const items = await httpGet(apiUrl, ghHeaders);

      if (Array.isArray(items)) {
        const dirs = items.filter(i => i.type === 'dir');
        if (dirs.length > 0) {
          // Check if first dir has SKILL.md
          const testDir = dirs[0].name;
          const testPath = contentPath ? `${contentPath}/${testDir}` : testDir;
          try {
            const rawUrl = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/${testPath}/SKILL.md`;
            const md = await httpGet(rawUrl, {});
            if (typeof md === 'string' && md.length > 10) {
              src.path = contentPath;
              validated.push(src);
              console.log(`    ✓ ${src.owner}/${src.repo} (${dirs.length} dirs in /${contentPath})`);
            }
          } catch {}
        }
      }
    } catch {
      // Try root-level SKILL.md check
      try {
        const rootUrl = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/SKILL.md`;
        const md = await httpGet(rootUrl, {});
        if (typeof md === 'string' && md.length > 10) {
          src.path = '';
          src.mode = 'single-skill';
          validated.push(src);
          console.log(`    ✓ ${src.owner}/${src.repo} (单个 SKILL.md)`);
        }
      } catch {}
    }
    await sleep(150);
  }

  console.log(`\n  ✓ 验证通过: ${validated.length} 个新数据源`);
  return validated;
}

// ── GitHub Fetch ──
async function fetchGitHubSources(extraSources = []) {
  const ghHeaders = GH_TOKEN ? { Authorization: `Bearer ${GH_TOKEN}` } : {};
  const allSkills = [];
  const existing = loadExisting();
  const existingMap = new Map(existing.skills.map(s => [`${s.author}-${s.slug}`, s]));

  const activeSources = [
    ...SOURCES.filter(s => s.enabled),
    ...extraSources,
  ];

  console.log(`\n📦 GitHub 抓取（${activeSources.length} 个源）`);

  for (const src of activeSources) {
    const { owner, repo, branch, path: srcPath, mode } = src;
    const tag = src._discovered ? ' [新发现]' : '';
    console.log(`\n  → ${owner}/${repo}${tag}`);

    let stars = 0;
    try {
      const repoData = await httpGet(`https://api.github.com/repos/${owner}/${repo}`, ghHeaders);
      stars = repoData.stargazers_count || 0;
      console.log(`    ⭐ ${stars} stars`);
    } catch (e) {
      console.log(`    ⚠ 无法获取 star: ${e.message}`);
    }

    // Handle single-skill repos (just a SKILL.md at root or given path)
    if (mode === 'single-skill') {
      try {
        const mdPath = srcPath ? `${srcPath}/SKILL.md` : 'SKILL.md';
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${mdPath}`;
        const md = await httpGet(rawUrl, {});
        if (typeof md === 'string') {
          const fm = parseFrontmatter(md);
          const slug = repo;
          const name = fm.name || repo;
          const description = fm.description || '';
          const body = md.replace(/^---[\s\S]*?---\s*/, '').trim().slice(0, 500);
          const key = `${owner}-${slug}`;
          const prev = existingMap.get(key);
          allSkills.push({
            id: key, slug, name, description, content: body,
            cat: inferCat(name, description + ' ' + body),
            author: owner, stars,
            url: `https://github.com/${owner}/${repo}`,
            poster: prev?.poster || null,
            title_zh: prev?.title_zh || null,
            desc_zh: prev?.desc_zh || null,
            tags: prev?.tags || [],
            audience: prev?.audience || null,
          });
          console.log(`    ✓ ${slug}`);
        }
      } catch (e) {
        console.log(`    ✗ ${e.message}`);
      }
      continue;
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

  const delay = SMP_KEY ? 2500 : 7000;

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

// ══════════════════════════════════════════════════════
//  skills.sh Trending API
//  https://skills.sh/api/skills/trending/{number}
//  返回最近 24 小时热门 skill
// ══════════════════════════════════════════════════════

async function fetchSkillsShTrending() {
  console.log(`\n🔥 skills.sh Trending 抓取`);
  const existing = loadExisting();
  const existingMap = new Map(existing.skills.map(s => [`${s.author}-${s.slug}`, s]));
  const allResults = [];
  const seenIds = new Set();

  // Fetch top 200 trending skills (adjust number as needed)
  const TRENDING_COUNT = 200;
  const url = `https://skills.sh/api/skills/trending/${TRENDING_COUNT}`;

  try {
    console.log(`  📈 获取 Top ${TRENDING_COUNT} trending skills...`);
    const data = await httpGet(url, {});

    // Handle different possible response formats
    let skills = [];
    if (Array.isArray(data)) {
      skills = data;
    } else if (data.skills && Array.isArray(data.skills)) {
      skills = data.skills;
    } else if (data.data && Array.isArray(data.data)) {
      skills = data.data;
    }

    console.log(`    → 获取到 ${skills.length} 个 trending skills`);

    for (const raw of skills) {
      // Extract owner/repo from source URL or fields
      const source = raw.source || raw.github_url || raw.url || '';
      const sourceMatch = source.match(/github\.com\/([^/]+)\/([^/]+)/);
      const owner = raw.author || raw.owner || (sourceMatch ? sourceMatch[1] : 'unknown');
      const repo = sourceMatch ? sourceMatch[2] : '';

      const slug = raw.name || raw.slug || raw.id || 'unknown';
      const id = `sh-${owner}-${slug}`.replace(/[^a-zA-Z0-9_-]/g, '-');

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const key = `${owner}-${slug}`;
      const prev = existingMap.get(key.toLowerCase());

      allResults.push({
        id,
        slug,
        name: raw.name || slug,
        author: owner,
        description: raw.description || '',
        content: raw.content || raw.description || '',
        url: raw.url || source || `https://skills.sh/${raw.source_type || 'github'}/${raw.id || slug}`,
        stars: raw.stars || raw.installs || 0,
        cat: inferCat(raw.name || '', raw.description || ''),
        _source: 'skills.sh',
        poster: prev?.poster || null,
        title_zh: prev?.title_zh || null,
        desc_zh: prev?.desc_zh || null,
        tags: prev?.tags || [],
        audience: prev?.audience || null,
      });
    }

    console.log(`    ✓ ${allResults.length} 个新 Skills（去重后）`);
  } catch (e) {
    console.log(`    ✗ skills.sh 获取失败: ${e.message}`);
    // 如果 trending/200 失败，尝试小一点的数字
    if (e.message !== 'RATE_LIMIT') {
      try {
        console.log(`    ↻ 尝试 Top 50...`);
        const fallbackData = await httpGet(`https://skills.sh/api/skills/trending/50`, {});
        const fallbackSkills = Array.isArray(fallbackData) ? fallbackData 
          : (fallbackData.skills || fallbackData.data || []);
        console.log(`    → 获取到 ${fallbackSkills.length} 个`);

        for (const raw of fallbackSkills) {
          const source = raw.source || raw.github_url || raw.url || '';
          const sourceMatch = source.match(/github\.com\/([^/]+)\/([^/]+)/);
          const owner = raw.author || raw.owner || (sourceMatch ? sourceMatch[1] : 'unknown');
          const slug = raw.name || raw.slug || raw.id || 'unknown';
          const id = `sh-${owner}-${slug}`.replace(/[^a-zA-Z0-9_-]/g, '-');
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          const key = `${owner}-${slug}`;
          const prev = existingMap.get(key.toLowerCase());
          allResults.push({
            id, slug, name: raw.name || slug, author: owner,
            description: raw.description || '',
            content: raw.content || raw.description || '',
            url: raw.url || source || `https://skills.sh/${raw.source_type || 'github'}/${raw.id || slug}`,
            stars: raw.stars || raw.installs || 0,
            cat: inferCat(raw.name || '', raw.description || ''),
            _source: 'skills.sh',
            poster: prev?.poster || null, title_zh: prev?.title_zh || null,
            desc_zh: prev?.desc_zh || null, tags: prev?.tags || [], audience: prev?.audience || null,
          });
        }
        console.log(`    ✓ ${allResults.length} 个（fallback）`);
      } catch (e2) {
        console.log(`    ✗ fallback 也失败: ${e2.message}`);
      }
    }
  }

  return allResults;
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════');
  console.log('  SkillBook Auto-Fetch v2.3');
  console.log('═══════════════════════════════════');
  console.log(`  时间: ${new Date().toISOString()}`);
  console.log(`  GitHub Token: ${GH_TOKEN ? '✓' : '✗'}`);
  console.log(`  SkillsMP Key: ${SMP_KEY ? '✓' : '✗'}`);
  console.log(`  自动发现: ${SKIP_DISCOVER ? '跳过' : '✓'}`);
  console.log(`  skills.sh: ${SKIP_TRENDING ? '跳过' : '✓'}`);

  const existing = loadExisting();
  console.log(`  现有数据: ${existing.skills.length} 个 Skills`);

  // Step 0: Auto-discover new sources from awesome lists
  let discoveredSources = [];
  if (!ONLY_SMP && !SKIP_DISCOVER) {
    try {
      discoveredSources = await discoverNewSources();
    } catch (e) {
      console.log(`  ⚠ 自动发现失败: ${e.message}`);
    }
  }

  let ghSkills = [];
  let smpSkills = [];
  let trendingSkills = [];

  // Step 1: GitHub fetch (static sources + discovered sources)
  if (!ONLY_SMP) {
    ghSkills = await fetchGitHubSources(discoveredSources);
    console.log(`\n  GitHub 总计: ${ghSkills.length} 个`);
  }

  // Step 2: SkillsMP fetch
  if (!SKIP_SMP) {
    smpSkills = await fetchSkillsMP();
    console.log(`\n  SkillsMP 总计: ${smpSkills.length} 个`);
  }

  // Step 3: skills.sh Trending fetch
  if (!SKIP_TRENDING) {
    trendingSkills = await fetchSkillsShTrending();
    console.log(`\n  skills.sh 总计: ${trendingSkills.length} 个`);
  }

  // Step 4: Merge & deduplicate — PRESERVE existing poster data
  const all = [...ghSkills, ...smpSkills, ...trendingSkills];
  
  const existingByKey = new Map();
  const existingBySlug = new Map();
  for (const s of existing.skills) {
    existingByKey.set(`${s.author}-${s.slug}`.toLowerCase(), s);
    if (!existingBySlug.has(s.slug.toLowerCase())) {
      existingBySlug.set(s.slug.toLowerCase(), s);
    }
  }

  for (const s of all) {
    if (!s.poster) {
      const prev = existingByKey.get(`${s.author}-${s.slug}`.toLowerCase()) 
                || existingBySlug.get(s.slug.toLowerCase());
      if (prev) {
        s.poster = prev.poster || null;
        s.title_zh = prev.title_zh || null;
        s.desc_zh = prev.desc_zh || null;
        s.tags = prev.tags || [];
        s.audience = prev.audience || null;
      }
    }
  }

  // Deduplicate: prefer entries with posters, then by slug name
  const seen = new Map();
  for (const s of all) {
    const key = `${s.author}-${s.slug}`.toLowerCase();
    if (!seen.has(key) || (s.poster && !seen.get(key).poster)) {
      seen.set(key, s);
    }
  }

  // Also deduplicate by slug alone (cross-author duplicates)
  // Keep the one with more stars or with a poster
  const bySlug = new Map();
  for (const [, s] of seen) {
    const slugKey = s.slug.toLowerCase();
    const existing = bySlug.get(slugKey);
    if (!existing) {
      bySlug.set(slugKey, s);
    } else {
      // Keep the one with poster, or more stars
      if (s.poster && !existing.poster) {
        bySlug.set(slugKey, s);
      } else if (s.stars > existing.stars && !existing.poster) {
        bySlug.set(slugKey, s);
      }
    }
  }

  // Keep existing skills that weren't re-fetched
  for (const s of existing.skills) {
    const slugKey = s.slug.toLowerCase();
    if (!bySlug.has(slugKey)) {
      bySlug.set(slugKey, s);
    }
  }

  const deduped = [...bySlug.values()];

  // Step 5: Save
  const newData = {
    version: '2.3.0',
    last_updated: new Date().toISOString().split('T')[0],
    total: deduped.length,
    skills: deduped,
  };

  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(DATA_PATH, JSON.stringify(newData, null, 2));

  const noPoster = deduped.filter(s => !s.poster).length;
  const newSkills = deduped.length - existing.skills.length;
  console.log('\n═══════════════════════════════════');
  console.log(`  ✓ 保存完毕: ${deduped.length} 个 Skills`);
  console.log(`    新增: ${newSkills > 0 ? '+' + newSkills : newSkills}`);
  console.log(`    有海报: ${deduped.length - noPoster}`);
  console.log(`    缺海报: ${noPoster}`);
  console.log(`    自动发现源: ${discoveredSources.length}`);
  console.log(`    文件: ${DATA_PATH}`);
  console.log('═══════════════════════════════════');

  return noPoster;
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
