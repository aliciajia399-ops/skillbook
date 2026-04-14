/**
 * generate-posters.js
 * 
 * 读取 skills.json，用 Claude API 为每个 Skill 生成中文海报文案
 * 
 * 用法：
 *   ANTHROPIC_API_KEY=sk-ant-xxx node scripts/generate-posters.js
 * 
 * 注意：如果你不想用 API，也可以手动编辑 skills.json 填入 poster 字段
 */

async function callClaude(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('⚠️  No ANTHROPIC_API_KEY set.');
    console.log('   You can either:');
    console.log('   1. Set the env var and re-run this script');
    console.log('   2. Manually edit public/data/skills.json to add poster/title_zh/desc_zh fields');
    console.log('   3. Copy skills.json content into a Claude chat and ask it to translate');
    process.exit(0);
  }

  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.join(process.cwd(), 'public', 'data', 'skills.json');

  if (!fs.existsSync(filePath)) {
    console.log('❌ public/data/skills.json not found. Run "npm run fetch" first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const pending = data.skills.filter(s => !s.poster);

  if (pending.length === 0) {
    console.log('✅ All skills already have posters!');
    return;
  }

  console.log(`🎨 Generating posters for ${pending.length} skills...\n`);

  // Process in batches of 8
  for (let i = 0; i < pending.length; i += 8) {
    const batch = pending.slice(i, i + 8);
    const entries = batch.map(s =>
      `- slug: ${s.slug}\n  name: ${s.name}\n  desc: ${s.description?.slice(0, 150) || 'N/A'}`
    ).join('\n');

    console.log(`   Batch ${Math.floor(i/8)+1}/${Math.ceil(pending.length/8)} (${batch.map(s=>s.slug).join(', ')})`);

    try {
      const raw = await callClaude(
        `You generate Chinese poster text for a Xiaohongshu-style card about Claude AI Skills.

For each skill below, output a JSON array of objects with:
- "slug": exact slug from input
- "title_zh": short Chinese title (3-8 chars)
- "poster": 2-5 short Chinese lines joined by \\n. Wrap 1-2 key phrases in <hl></hl>. Punchy, magazine-headline style.
- "desc_zh": 1-2 sentence Chinese description (natural, useful, non-technical)
- "tags": array of 2-3 Chinese keywords

Good poster examples:
"用 Claude\\n帮你写\\n<hl>Word 文档</hl>"
"在发布前\\n让 AI\\n<hl>质疑</hl>你的\\n每一个<hl>假设</hl>"
"邮件太多？\\nClaude 帮你\\n<hl>读</hl> <hl>回</hl> <hl>发</hl>"

Skills:
${entries}

Respond ONLY with a valid JSON array. No markdown, no extra text.`,
        apiKey
      );

      const clean = raw.replace(/```json|```/g, '').trim();
      const results = JSON.parse(clean);

      for (const r of results) {
        const skill = data.skills.find(s => s.slug === r.slug);
        if (skill) {
          skill.poster = r.poster;
          skill.title_zh = r.title_zh;
          skill.desc_zh = r.desc_zh;
          skill.tags = r.tags || [];
        }
      }

      console.log(`   ✓ ${results.length} posters generated`);
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  // Save
  data.last_updated = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`\n✅ Done! Updated ${filePath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
