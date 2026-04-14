/**
 * fetch-skills.js
 * 
 * 从 GitHub 抓取所有 Skill 数据，输出到 public/data/skills.json
 * 
 * 用法：
 *   node scripts/fetch-skills.js
 *   GITHUB_TOKEN=ghp_xxx node scripts/fetch-skills.js   (避免限流)
 */

const REPOS = [
  { owner: 'ComposioHQ', repo: 'awesome-claude-skills', branch: 'master' },
  { owner: 'mattpocock', repo: 'skills', branch: 'main' },
];

const CAT_RULES = [
  [/doc|pdf|pptx|xlsx|spreadsheet|file|invoice|resume|organiz|epub/i, '办公提效'],
  [/writ|content|article|brainstorm|edit|meeting|grill|communi|twitter|notebook/i, '写作创作'],
  [/brand|marketing|ads|lead|domain|growth|competitive|comms|internal/i, '营销增长'],
  [/design|image|canvas|gif|theme|video|visual|media|imagen|slack-gif/i, '设计媒体'],
  [/code|dev|git|test|build|api|mcp|architect|artifact|soft|skill|prompt|playwright|tdd|webapp|aws|changelog|ios|jules|lang|move|d3|ffuf|finish|sub.?agent/i, '开发工具'],
  [/data|csv|research|database|sql|analy|postgres|deep/i, '数据分析'],
  [/auto|slack|gmail|notion|connect|workflow|shopify|stripe|hubspot|jira|zoom|discord|telegram|whatsapp|outlook|github-auto|google/i, '自动化'],
  [/secur|forensic|threat|sigma|delet|metadata/i, '安全系统'],
];

function inferCat(name, desc) {
  const text = `${name} ${desc}`;
  for (const [re, cat] of CAT_RULES) {
    if (re.test(text)) return cat;
  }
  return '其他';
}

const headers = {};
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.text();
}

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

async function main() {
  console.log('SkillBook: Fetching skills from GitHub...\n');
  const allSkills = [];

  for (const { owner, repo, branch } of REPOS) {
    console.log(`📦 ${owner}/${repo}`);

    let stars = 0;
    try {
      const repoData = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}`);
      stars = repoData.stargazers_count || 0;
      console.log(`   ⭐ ${stars} stars`);
    } catch {}

    let items;
    try {
      items = await fetchJSON(`https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`);
    } catch (e) {
      console.log(`   ❌ Failed: ${e.message}`);
      continue;
    }

    const dirs = items.filter(i => i.type === 'dir');
    console.log(`   📁 ${dirs.length} directories`);

    let found = 0;
    for (const d of dirs) {
      // Check if dir has SKILL.md
      try {
        const contents = await fetchJSON(
          `https://api.github.com/repos/${owner}/${repo}/contents/${d.name}?ref=${branch}`
        );
        if (!contents.some(f => f.name === 'SKILL.md')) continue;
      } catch { continue; }

      // Fetch SKILL.md
      const md = await fetchText(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${d.name}/SKILL.md`
      );
      if (!md) continue;

      const fm = parseFrontmatter(md);
      const name = fm.name || d.name;
      const description = fm.description || '';
      const cat = inferCat(name, description);

      allSkills.push({
        id: `${owner}-${d.name}`,
        slug: d.name,
        name,
        description,
        cat,
        author: owner,
        stars,
        url: `https://github.com/${owner}/${repo}/tree/${branch}/${d.name}`,
        // These will be filled by generate-posters.js
        poster: null,
        title_zh: null,
        desc_zh: null,
        tags: [],
      });

      found++;
      process.stdout.write(`   ✓ ${d.name}\n`);

      // Rate limit courtesy
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`   → Found ${found} skills\n`);
  }

  // Write output
  const output = {
    version: '1.0.0',
    last_updated: new Date().toISOString().split('T')[0],
    total: allSkills.length,
    skills: allSkills,
  };

  const fs = await import('fs');
  const path = await import('path');
  const outPath = path.join(process.cwd(), 'public', 'data', 'skills.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`✅ Done! ${allSkills.length} skills saved to public/data/skills.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
