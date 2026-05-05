/**
 * content-engine — Personal Content Automation Worker
 *
 * Features:
 *   - Daily cron: scan trending → generate article from your ideas → push to dev.to draft
 *   - Telegram bot: send ideas, stories, learnings anytime → stored in KV
 *   - /generate [topic]: instant article generation on demand
 *   - /ideas: see everything you've saved
 *   - /clear: clear idea inbox
 *   - /status: pipeline health check
 *   - Weekly Sunday digest: your article performance stats
 *
 * Secrets (wrangler secret put):
 *   OPENAI_API_KEY, GITHUB_TOKEN, GITHUB_REPO,
 *   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DEVTO_USERNAME
 *
 * KV Bindings:
 *   IDEAS_KV
 */

const NICHE_TAGS = ["cloudflare", "webdev", "devops", "javascript", "github"];

// ─── Entry Points ──────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    // Sunday 08:00 UTC → weekly digest
    if (cron === "0 1 * * SUN") {
      ctx.waitUntil(sendWeeklyDigest(env));
    } else {
      // Weekdays → generate article
      ctx.waitUntil(runPipeline(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Manual trigger for testing
    if (url.pathname === "/trigger") {
      ctx.waitUntil(runPipeline(env));
      return new Response("✅ Pipeline triggered. Check Telegram.", { status: 200 });
    }

    // Telegram webhook
    if (url.pathname === "/telegram" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (body) ctx.waitUntil(handleTelegram(body, env));
      return new Response("OK", { status: 200 });
    }

    return new Response(
      "Content Engine running.\nEndpoints: /trigger · /telegram (POST)",
      { status: 200 }
    );
  },
};

// ─── Main Pipeline ─────────────────────────────────────────────────────────

async function runPipeline(env, forceTopic = null) {
  console.log("🚀 Pipeline started");

  // Load saved ideas from Telegram inbox
  const ideas = forceTopic ? [forceTopic] : await getIdeas(env);

  const trending = await getTrendingTopics();
  console.log(`📈 ${trending.length} trending articles fetched`);

  const article = await generateArticle(trending, ideas, env);
  console.log(`✍️  Generated: "${article.title}"`);

  const fileUrl = await commitToMain(article, env);
  console.log(`✅ Committed: ${fileUrl}`);

  // Clear ideas only after successful generation
  if (!forceTopic && ideas.length > 0) await clearIdeas(env);

  await sendTelegram(
    `📝 *New draft is live on dev.to!*\n\n` +
    `*Title:* ${article.title}\n` +
    `*Tags:* \`${article.tags}\`\n\n` +
    `👉 [Review & Publish → dev.to Dashboard](https://dev.to/dashboard)\n\n` +
    (ideas.length > 0
      ? `_Wrote from your ${ideas.length} saved idea(s). Inbox cleared._`
      : `_Generated from trending topics._`),
    env
  );

  console.log("✅ Pipeline finished");
}

// ─── Telegram Handler ──────────────────────────────────────────────────────

async function handleTelegram(body, env) {
  const msg = body?.message;
  if (!msg?.text) return;

  const text = msg.text.trim();
  const chatId = String(msg.chat.id);

  // Only respond to the configured chat
  if (chatId !== String(env.TELEGRAM_CHAT_ID)) return;

  // ── Commands ────────────────────────────────────────────────────────────

  // /generate [topic] — generate article right now
  if (text.startsWith("/generate")) {
    const topic = text.replace("/generate", "").trim();
    await sendTelegram(
      topic
        ? `⚡ Generating article about: *${topic}*\n_Give me ~30 seconds..._`
        : `⚡ Generating article from your saved ideas + trending topics...\n_Give me ~30 seconds..._`,
      env
    );
    await runPipeline(env, topic || null);
    return;
  }

  // /ideas — list saved ideas
  if (text === "/ideas") {
    const ideas = await getIdeas(env);
    if (ideas.length === 0) {
      await sendTelegram("📭 Idea inbox is empty.\n\nKirim pesan apa saja untuk menyimpan ide!", env);
    } else {
      const list = ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n");
      await sendTelegram(`💡 *Saved ideas (${ideas.length}):*\n\n${list}`, env);
    }
    return;
  }

  // /clear — clear idea inbox
  if (text === "/clear") {
    await clearIdeas(env);
    await sendTelegram("🗑️ Idea inbox cleared.", env);
    return;
  }

  // /digest — manual weekly digest
  if (text === "/digest") {
    await sendTelegram("📊 Fetching your article stats...", env);
    await sendWeeklyDigest(env);
    return;
  }

  // /status — health check
  if (text === "/status") {
    const ideas = await getIdeas(env);
    await sendTelegram(
      `🟢 *Content Engine Status*\n\n` +
      `💡 Ideas in inbox: *${ideas.length}*\n` +
      `🕐 Next run: Weekdays 09:00 WIB\n` +
      `📋 Commands:\n` +
      `/generate [topik] — generate sekarang\n` +
      `/ideas — lihat ide tersimpan\n` +
      `/clear — hapus semua ide\n` +
      `/digest — stats artikel kamu\n\n` +
      `_Kirim pesan biasa untuk simpan ide._`,
      env
    );
    return;
  }

  // ── Plain message → save as idea ────────────────────────────────────────
  await saveIdea(text, env);
  const ideas = await getIdeas(env);
  await sendTelegram(
    `💡 *Ide tersimpan!* (${ideas.length} total)\n\n` +
    `_"${text.slice(0, 120)}${text.length > 120 ? "..." : ""}"_\n\n` +
    `Kirim lebih banyak ide, atau /generate untuk langsung bikin artikel sekarang.`,
    env
  );
}

// ─── Step 1: Trending Topics ───────────────────────────────────────────────

async function getTrendingTopics() {
  const results = [];
  for (const tag of NICHE_TAGS.slice(0, 3)) {
    const res = await fetch(
      `https://dev.to/api/articles?tag=${tag}&top=7&per_page=4`,
      { headers: { "User-Agent": "content-engine/1.0" } }
    );
    if (!res.ok) continue;
    const articles = await res.json();
    results.push(...articles.map((a) => ({
      title: a.title,
      tag,
      reactions: a.positive_reactions_count,
      comments: a.comments_count,
    })));
  }
  return results
    .sort((a, b) => (b.reactions + b.comments * 3) - (a.reactions + a.comments * 3))
    .slice(0, 8);
}

// ─── Step 2: Generate Article (Enhanced Prompt) ────────────────────────────

async function generateArticle(trending, ideas, env) {
  const trendingContext = trending
    .map((t) => `- "${t.title}" [${t.tag}] — ${t.reactions} reactions, ${t.comments} comments`)
    .join("\n");

  const ideasContext = ideas.length > 0
    ? `\nTHE WRITER'S OWN EXPERIENCES & IDEAS (use these as the soul of the article):\n${ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n")}`
    : "";

  const prompt = `You are ghostwriting for a developer from Batam, Indonesia who writes on dev.to.

Their voice: honest, direct, first-person. They share real mistakes, real wins, real frustration. They don't write tutorials for the sake of tutorials — they write because something surprised them, broke them, or changed how they think.
${ideasContext}

TRENDING IN THEIR NICHE RIGHT NOW (for SEO angle and timing):
${trendingContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ARTICLE FORMULA — Study these patterns from top dev.to articles with 500+ reactions:

TITLE PATTERNS (pick the best fit):
• "I [specific action] for [time/number] — here's what I [found/broke/learned]"
• "The [X] that nobody tells you about [topic]"
• "Stop [doing X]. [Do Y] instead — here's the proof"
• "Why I [controversial choice] and [surprising outcome]"
• "I thought I understood [topic]. Then [thing] happened."

STRUCTURE (non-negotiable):
1. OPENING HOOK (2-3 sentences, NO "In this article")
   → Start mid-scene: a specific moment, error message, late night, realization
   → Make the reader feel "I've been here too"

2. THE SETUP (1 paragraph)
   → What were you trying to do? What was the stakes?
   → Keep it tight, keep it real

3. WHERE IT WENT WRONG / THE CHALLENGE (1-2 sections with ## heading)
   → Show the problem with actual code — messy, buggy, real
   → Include the exact error or pain point
   → Reader should nod along

4. THE BREAKTHROUGH / SOLUTION (1-2 sections with ## heading)
   → Reveal the fix or insight
   → Show clean code side-by-side
   → Explain the WHY, not just the what

5. WHAT THIS ACTUALLY MEANS (1 section)
   → Zoom out: what's the deeper principle?
   → This is where you become a thought leader, not just a tutorial writer

6. WHAT I'D DO DIFFERENTLY (bullet points)
   → Concrete, time-saving, actionable
   → "If I had to do this again, I would..."

7. CLOSING QUESTION (1 sentence)
   → Open-ended, invites debate or experience-sharing
   → NOT "What do you think?" — be specific

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES:
✅ Minimum 1000 words in the body
✅ At least 2 real, runnable code blocks with language tags
✅ Every section has at least 2 paragraphs
✅ Numbers, specifics, real error messages make it credible
✅ Tags: exactly 4 from: ${NICHE_TAGS.join(", ")}
✅ Description: max 140 chars, punchy, curiosity-gap

❌ Never start with "In this article"
❌ Never use "Conclusion" as a heading
❌ No vague advice like "just use best practices"
❌ No imaginary examples — ground it in real scenarios

Respond with ONLY valid JSON:
{
  "title": "...",
  "description": "...",
  "tags": "tag1, tag2, tag3, tag4",
  "body": "...(complete markdown article, no frontmatter, minimum 1000 words)"
}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content.trim());
  return parsed;
}

// ─── Step 3: Commit directly to main ──────────────────────────────────────

async function commitToMain(article, env) {
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;

  const date = new Date().toISOString().slice(0, 10);
  const slug = article.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50);

  const filePath = `articles/${date}-${slug}.md`;
  const fileContent =
    `---\ntitle: "${article.title.replace(/"/g, '\\"')}"\npublished: false\ntags: ${article.tags}\ndescription: "${article.description.replace(/"/g, '\\"')}"\n# devto_id: (filled after first publish)\n---\n\n` +
    article.body;

  const encoded = btoa(unescape(encodeURIComponent(fileContent)));

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "content-engine/1.0",
  };

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filePath}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: `draft: ${article.title}`,
        content: encoded,
        branch: "main",
      }),
    }
  );

  if (!res.ok) throw new Error(`GitHub commit failed: ${await res.text()}`);
  const result = await res.json();
  return result.content.html_url;
}

// ─── Weekly Digest ─────────────────────────────────────────────────────────

async function sendWeeklyDigest(env) {
  const username = env.DEVTO_USERNAME;
  if (!username) {
    await sendTelegram("⚠️ DEVTO_USERNAME secret not set — skipping digest.", env);
    return;
  }

  const res = await fetch(
    `https://dev.to/api/articles?username=${username}&per_page=20`,
    { headers: { "User-Agent": "content-engine/1.0" } }
  );

  if (!res.ok) {
    await sendTelegram(`❌ Could not fetch dev.to stats: ${res.status}`, env);
    return;
  }

  const articles = await res.json();
  if (articles.length === 0) {
    await sendTelegram("📊 No articles found yet on dev.to.", env);
    return;
  }

  const sorted = [...articles].sort(
    (a, b) => (b.positive_reactions_count + b.comments_count * 3) -
              (a.positive_reactions_count + a.comments_count * 3)
  );

  const totalViews = articles.reduce((s, a) => s + (a.page_views_count || 0), 0);
  const totalReactions = articles.reduce((s, a) => s + a.positive_reactions_count, 0);
  const top3 = sorted.slice(0, 3);

  const topList = top3
    .map((a, i) => `${["🥇", "🥈", "🥉"][i]} *${a.title}*\n   ❤️ ${a.positive_reactions_count} · 💬 ${a.comments_count} · 👁 ${a.page_views_count || 0}`)
    .join("\n\n");

  await sendTelegram(
    `📊 *Weekly Digest*\n\n` +
    `📝 Articles published: *${articles.length}*\n` +
    `👁 Total views: *${totalViews.toLocaleString()}*\n` +
    `❤️ Total reactions: *${totalReactions}*\n\n` +
    `🏆 *Top Articles:*\n\n${topList}\n\n` +
    `👉 [dev.to Dashboard](https://dev.to/dashboard)`,
    env
  );
}

// ─── KV Helpers ────────────────────────────────────────────────────────────

async function getIdeas(env) {
  const raw = await env.IDEAS_KV.get("ideas");
  return raw ? JSON.parse(raw) : [];
}

async function saveIdea(text, env) {
  const ideas = await getIdeas(env);
  ideas.push(text);
  await env.IDEAS_KV.put("ideas", JSON.stringify(ideas));
}

async function clearIdeas(env) {
  await env.IDEAS_KV.put("ideas", JSON.stringify([]));
}

// ─── Telegram Helper ───────────────────────────────────────────────────────

async function sendTelegram(text, env) {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    }
  );
  if (!res.ok) console.warn("Telegram failed:", await res.text());
}
