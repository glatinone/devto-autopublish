/**
 * content-engine — Personal Content Automation Worker
 *
 * Features:
 *   - Daily cron: generate article (series → ideas → trending)
 *   - Telegram idea inbox, URL scraping, commands
 *   - /series [topic]: plan & auto-generate multi-part series
 *   - /linkedin [url]: auto-post published article to LinkedIn
 *   - /suggest: data-driven topic suggestions from your top articles
 *   - /generate, /ideas, /clear, /trending, /prompt, /digest, /status
 *
 * Secrets: OPENAI_API_KEY, GITHUB_TOKEN, GITHUB_REPO,
 *          TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DEVTO_USERNAME,
 *          LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_ID
 * KV: IDEAS_KV
 */

const NICHE_TAGS = ["cloudflare", "webdev", "devops", "javascript", "github"];

// ─── Entry Points ──────────────────────────────────────────────────────────

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPipeline(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/trigger") {
      ctx.waitUntil(runPipeline(env));
      return new Response("✅ Pipeline triggered. Check Telegram.", { status: 200 });
    }
    if (url.pathname === "/telegram" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (body) ctx.waitUntil(handleTelegram(body, env));
      return new Response("OK", { status: 200 });
    }
    return new Response("Content Engine running.\nEndpoints: /trigger · /telegram (POST)", { status: 200 });
  },
};

// ─── Main Pipeline ─────────────────────────────────────────────────────────

async function runPipeline(env, forceTopic = null) {
  console.log("🚀 Pipeline started");

  // Priority: active series → saved ideas → trending
  const activeSeries = await getActiveSeries(env);
  const ideas        = forceTopic ? [forceTopic] : await getIdeas(env);
  const trending     = await getTrendingTopics();
  console.log(`📈 ${trending.length} trending articles fetched`);

  let article;
  let context = "";

  if (!forceTopic && activeSeries) {
    const next = activeSeries.articles[activeSeries.currentIndex];
    console.log(`📚 Generating series article ${activeSeries.currentIndex + 1}/${activeSeries.articles.length}: "${next.title}"`);
    article = await generateSeriesArticle(next, activeSeries, trending, ideas, env);
    context = `_Series: *${activeSeries.title}* — Part ${activeSeries.currentIndex + 1}/${activeSeries.articles.length}_`;

    // Advance index or complete series
    activeSeries.currentIndex++;
    if (activeSeries.currentIndex >= activeSeries.articles.length) {
      await env.IDEAS_KV.delete("series:active");
      context += `\n\n🎉 *Series selesai!*`;
    } else {
      await env.IDEAS_KV.put("series:active", JSON.stringify(activeSeries));
    }
  } else {
    article = await generateArticle(trending, ideas, env);
    context = ideas.length > 0
      ? `_Wrote from your ${ideas.length} saved idea(s). Inbox cleared._`
      : `_Generated from trending topics._`;
    if (!forceTopic && ideas.length > 0) await clearIdeas(env);
  }

  console.log(`✍️  Generated: "${article.title}"`);
  await commitToMain(article, env);
  console.log("✅ Committed to main");

  await sendTelegram(
    `📝 *New draft is live on dev.to!*\n\n` +
    `*Title:* ${article.title}\n` +
    `*Tags:* \`${article.tags}\`\n\n` +
    `👉 [Review & Publish](https://dev.to/dashboard)\n\n` +
    context,
    env
  );

  console.log("✅ Pipeline finished");
}

// ─── Telegram Handler ──────────────────────────────────────────────────────

async function handleTelegram(body, env) {
  const msg = body?.message;
  if (!msg?.text) return;
  const text   = msg.text.trim();
  const chatId = String(msg.chat.id);
  if (chatId !== String(env.TELEGRAM_CHAT_ID)) return;

  // /series — plan & manage article series
  if (text.startsWith("/series")) {
    await handleSeries(text, env);
    return;
  }

  // /suggest — data-driven topic suggestions
  if (text === "/suggest") {
    await sendTelegram("🔍 Analysing your article performance...", env);
    await suggestTopics(env);
    return;
  }

  // /linkedin [url] — post article to LinkedIn
  if (text.startsWith("/linkedin")) {
    const articleUrl = text.replace("/linkedin", "").trim();
    if (!articleUrl) {
      await sendTelegram(
        `📤 *Post ke LinkedIn*\n\nUsage:\n/linkedin https://dev.to/kamu/judul-artikel\n\n_Jalankan setelah artikel dipublish di dev.to._`,
        env
      );
      return;
    }
    await sendTelegram("📤 Posting ke LinkedIn...", env);
    await postToLinkedIn(articleUrl, env);
    return;
  }

  // /generate [topic]
  if (text.startsWith("/generate")) {
    const topic = text.replace("/generate", "").trim();
    await sendTelegram(
      topic
        ? `⚡ Generating: *${topic}*\n_~30 seconds..._`
        : `⚡ Generating dari ideas + trending...\n_~30 seconds..._`,
      env
    );
    await runPipeline(env, topic || null);
    return;
  }

  // /ideas
  if (text === "/ideas") {
    const ideas = await getIdeas(env);
    if (ideas.length === 0) {
      await sendTelegram("📭 Inbox kosong. Kirim pesan apapun untuk simpan ide!", env);
    } else {
      const list = ideas.map((idea, i) => `${i + 1}. ${idea.slice(0, 100)}${idea.length > 100 ? "…" : ""}`).join("\n\n");
      await sendTelegram(`💡 *Ideas (${ideas.length}):*\n\n${list}`, env);
    }
    return;
  }

  // /clear
  if (text.startsWith("/clear")) {
    const arg   = text.replace("/clear", "").trim();
    const ideas = await getIdeas(env);
    if (!arg) {
      if (ideas.length === 0) { await sendTelegram("📭 Inbox sudah kosong.", env); return; }
      const list = ideas.map((idea, i) => `${i + 1}. ${idea.slice(0, 80)}${idea.length > 80 ? "…" : ""}`).join("\n");
      await sendTelegram(`🗑️ *Mau hapus yang mana?*\n\n${list}\n\n/clear all · /clear 2 · /clear 1 3 5`, env);
      return;
    }
    if (arg === "all") {
      await clearIdeas(env);
      await sendTelegram(`🗑️ ${ideas.length} ide dihapus semua.`, env);
      return;
    }
    const nums      = arg.split(/\s+/).map(n => parseInt(n)).filter(n => !isNaN(n) && n >= 1 && n <= ideas.length);
    const toDelete  = new Set(nums.map(n => n - 1));
    const remaining = ideas.filter((_, i) => !toDelete.has(i));
    await env.IDEAS_KV.put("ideas", JSON.stringify(remaining));
    await sendTelegram(`🗑️ ${nums.length} ide dihapus. Sisa: *${remaining.length}*`, env);
    return;
  }

  // /trending
  if (text === "/trending") {
    await sendTelegram("📈 Fetching trending...", env);
    const trending = await getTrendingTopics();
    const list = trending.map((t, i) => `${i + 1}. *${t.title}*\n   [${t.tag}] ❤️ ${t.reactions} · 💬 ${t.comments}`).join("\n\n");
    await sendTelegram(`📈 *Trending sekarang:*\n\n${list}`, env);
    return;
  }

  // /prompt
  if (text === "/prompt") {
    await sendTelegram(
      `🧠 *Formula artikel AI:*\n\n` +
      `*TITLE:* Specific + curiosity gap\n` +
      `• "I [X] for [time] — here's what I found"\n` +
      `• "The [X] nobody tells you about [topic]"\n` +
      `• "Stop [X]. Do [Y] instead."\n\n` +
      `*STRUCTURE:*\n` +
      `1. Hook — scene nyata, bukan intro generic\n` +
      `2. Setup — konteks & stakes\n` +
      `3. Challenge — kode buggy yang relatable\n` +
      `4. Breakthrough — solusi + kode bersih\n` +
      `5. Deeper Insight — prinsip lebih besar\n` +
      `6. What I'd Do Differently\n` +
      `7. Closing Question — drive comments\n\n` +
      `*INPUT PRIORITY:*\n` +
      `Series → Ideas kamu → Trending`,
      env
    );
    return;
  }

  // /digest
  if (text === "/digest") {
    await sendTelegram("📊 Fetching stats...", env);
    await sendWeeklyDigest(env);
    return;
  }

  // /status
  if (text === "/status") {
    const ideas        = await getIdeas(env);
    const activeSeries = await getActiveSeries(env);
    const seriesInfo   = activeSeries
      ? `📚 Active series: *${activeSeries.title}*\n   Part ${activeSeries.currentIndex + 1}/${activeSeries.articles.length} next\n`
      : `📚 No active series\n`;
    await sendTelegram(
      `🟢 *Content Engine*\n\n` +
      `${seriesInfo}` +
      `💡 Ideas in inbox: *${ideas.length}*\n` +
      `🕐 Cron: Weekdays 09:00 WIB\n\n` +
      `*Commands:*\n` +
      `/series [topik] — plan series\n` +
      `/suggest — rekomendasi topik berdasarkan data\n` +
      `/linkedin [url] — post ke LinkedIn\n` +
      `/generate [topik] — generate sekarang\n` +
      `/ideas · /clear · /trending · /prompt · /digest`,
      env
    );
    return;
  }

  // URL → scrape + extract insights
  if (looksLikeURL(text)) {
    await sendTelegram(`🔍 Scraping...\n_${text.slice(0, 60)}_`, env);
    try {
      const insight = await scrapeAndExtract(text, env);
      await saveIdea(`[URL: ${text}]\n${insight}`, env);
      const ideas = await getIdeas(env);
      await sendTelegram(
        `🔗 *Insights tersimpan!* (${ideas.length} total)\n\n${insight.slice(0, 600)}${insight.length > 600 ? "…" : ""}\n\n_/generate untuk pakai ini._`,
        env
      );
    } catch (err) {
      await sendTelegram(`❌ Gagal scrape: ${err.message}`, env);
    }
    return;
  }

  // Plain text → save as idea
  await saveIdea(text, env);
  const ideas = await getIdeas(env);
  await sendTelegram(
    `💡 *Ide tersimpan!* (${ideas.length} total)\n\n` +
    `_"${text.slice(0, 120)}${text.length > 120 ? "…" : ""}"_\n\n` +
    `/generate untuk bikin artikel sekarang.`,
    env
  );
}

// ─── Series Planner ────────────────────────────────────────────────────────

async function handleSeries(text, env) {
  const arg = text.replace("/series", "").trim();

  // /series status
  if (arg === "status") {
    const active = await getActiveSeries(env);
    if (!active) {
      await sendTelegram("📚 Tidak ada series aktif.\n\nKetik /series [topik] untuk mulai.", env);
      return;
    }
    const list = active.articles
      .map((a, i) => {
        const icon = i < active.currentIndex ? "✅" : i === active.currentIndex ? "▶️" : "⏳";
        return `${icon} Part ${i + 1}: *${a.title}*`;
      })
      .join("\n");
    await sendTelegram(
      `📚 *Series: ${active.title}*\n\n${list}\n\n` +
      `_Artikel berikutnya akan di-generate oleh cron besok pagi._\n` +
      `/series cancel — batalkan series`,
      env
    );
    return;
  }

  // /series cancel
  if (arg === "cancel") {
    await env.IDEAS_KV.delete("series:active");
    await env.IDEAS_KV.delete("series:pending");
    await sendTelegram("🗑️ Series dibatalkan.", env);
    return;
  }

  // /series confirm
  if (arg === "confirm") {
    const pending = await env.IDEAS_KV.get("series:pending");
    if (!pending) {
      await sendTelegram("⚠️ Tidak ada series yang menunggu konfirmasi.\n\nKetik /series [topik] untuk buat baru.", env);
      return;
    }
    const series = JSON.parse(pending);
    await env.IDEAS_KV.put("series:active", JSON.stringify(series));
    await env.IDEAS_KV.delete("series:pending");
    await sendTelegram(
      `✅ *Series aktif!*\n\n*${series.title}*\n\n` +
      `Artikel pertama akan di-generate hari ini / besok pagi jam 09:00.\n` +
      `Ketik /series status kapanpun untuk lihat progress.`,
      env
    );
    return;
  }

  // /series [topic] → plan new series
  if (!arg) {
    await sendTelegram(
      `📚 *Series Planner*\n\nUsage:\n/series cloudflare workers dari nol\n/series deploy automation dengan github actions\n\nAI akan rancang 5 judul artikel yang nyambung, kamu approve, lalu 1 artikel per hari otomatis.`,
      env
    );
    return;
  }

  await sendTelegram(`📚 Merancang series: *${arg}*\n_~20 seconds..._`, env);

  const plan = await planSeries(arg, env);
  await env.IDEAS_KV.put("series:pending", JSON.stringify(plan));

  const list = plan.articles.map((a, i) => `${i + 1}. *${a.title}*\n   _${a.description}_`).join("\n\n");

  await sendTelegram(
    `📚 *Rencana Series: ${plan.title}*\n\n${list}\n\n` +
    `─────────────────\n` +
    `✅ /series confirm — mulai series ini\n` +
    `❌ /series cancel — tolak & hapus`,
    env
  );
}

async function planSeries(topic, env) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content:
          `You are planning a dev.to article series for a developer from Indonesia.\n\n` +
          `Topic: "${topic}"\n\n` +
          `Plan a series of exactly 5 articles that:\n` +
          `- Build on each other logically (beginner → advanced)\n` +
          `- Each stands alone (readable without the others)\n` +
          `- Titles follow top dev.to patterns (specific, curiosity-driven)\n` +
          `- Each covers a distinct sub-topic\n\n` +
          `Respond ONLY as JSON:\n` +
          `{\n` +
          `  "title": "Series name (short, punchy)",\n` +
          `  "topic": "${topic}",\n` +
          `  "articles": [\n` +
          `    { "title": "...", "description": "...(what this part covers, 1 sentence)", "focus": "...(key technical concept)" },\n` +
          `    ...\n` +
          `  ]\n` +
          `}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  const plan = JSON.parse(data.choices[0].message.content);
  plan.currentIndex = 0;
  plan.createdAt    = new Date().toISOString().slice(0, 10);
  return plan;
}

async function generateSeriesArticle(seriesArticle, series, trending, ideas, env) {
  const trendingContext = trending
    .map(t => `- "${t.title}" [${t.tag}] — ${t.reactions} reactions`)
    .join("\n");

  const prevParts = series.articles
    .slice(0, series.currentIndex)
    .map((a, i) => `Part ${i + 1}: ${a.title}`)
    .join("\n");

  const ideasContext = ideas.length > 0
    ? `\nWriter's personal ideas/experiences to weave in:\n${ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n")}`
    : "";

  const prompt =
    `You are ghostwriting Part ${series.currentIndex + 1} of a dev.to series for a developer from Batam, Indonesia.\n\n` +
    `SERIES: "${series.title}"\n` +
    `THIS PART: "${seriesArticle.title}"\n` +
    `FOCUS: ${seriesArticle.focus}\n\n` +
    (prevParts ? `PREVIOUS PARTS (briefly reference to maintain continuity):\n${prevParts}\n\n` : "") +
    ideasContext + "\n\n" +
    `TRENDING CONTEXT:\n${trendingContext}\n\n` +
    `RULES:\n` +
    `- Minimum 900 words\n` +
    `- Include the series name in the article naturally\n` +
    `- At least 2 runnable code blocks\n` +
    `- First-person, honest voice, real examples\n` +
    `- End with a teaser for next part (if not the last)\n` +
    `- Tags: exactly 4 from: ${NICHE_TAGS.join(", ")}\n\n` +
    `Respond ONLY as JSON:\n` +
    `{ "title": "...", "description": "...(max 140 chars)", "tags": "t1, t2, t3, t4", "body": "...(full article)" }`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 8192, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  parsed.series = series.title; // add series name for frontmatter
  return parsed;
}

async function getActiveSeries(env) {
  const raw = await env.IDEAS_KV.get("series:active");
  return raw ? JSON.parse(raw) : null;
}

// ─── LinkedIn Auto-post ────────────────────────────────────────────────────

async function postToLinkedIn(articleUrl, env) {
  if (!env.LINKEDIN_ACCESS_TOKEN || !env.LINKEDIN_PERSON_ID) {
    await sendTelegram(
      `⚠️ *LinkedIn belum dikonfigurasi.*\n\n` +
      `Perlu set 2 secrets:\n` +
      `\`npx wrangler secret put LINKEDIN_ACCESS_TOKEN\`\n` +
      `\`npx wrangler secret put LINKEDIN_PERSON_ID\`\n\n` +
      `Cara dapat token:\n` +
      `1. Buat app di developers.linkedin.com\n` +
      `2. OAuth dengan scope \`w_member_social\`\n` +
      `3. PERSON_ID: GET https://api.linkedin.com/v2/me`,
      env
    );
    return;
  }

  // Fetch article info from dev.to API
  let articleInfo = { title: articleUrl, description: "", url: articleUrl, tags: [] };
  try {
    // Try to get article from dev.to API using the slug
    const slug = articleUrl.split("/").pop();
    const username = env.DEVTO_USERNAME;
    if (username && slug) {
      const apiRes = await fetch(`https://dev.to/api/articles/${username}/${slug}`, {
        headers: { "User-Agent": "content-engine/1.0" },
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        articleInfo = {
          title      : data.title,
          description: data.description || "",
          url        : data.url,
          tags       : data.tag_list || [],
        };
      }
    }
  } catch (_) {}

  const hashtags = articleInfo.tags.length > 0
    ? "\n\n" + articleInfo.tags.map(t => `#${t.replace(/[^a-zA-Z0-9]/g, "")}`).join(" ")
    : "";

  const postText =
    `✍️ Just published on dev.to:\n\n` +
    `${articleInfo.title}\n\n` +
    `${articleInfo.description ? articleInfo.description + "\n\n" : ""}` +
    `👉 ${articleInfo.url}` +
    hashtags;

  const body = {
    author           : `urn:li:person:${env.LINKEDIN_PERSON_ID}`,
    lifecycleState   : "PUBLISHED",
    specificContent  : {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary    : { text: postText },
        shareMediaCategory : "ARTICLE",
        media              : [{
          status     : "READY",
          description: { text: articleInfo.description || articleInfo.title },
          originalUrl: articleInfo.url,
          title      : { text: articleInfo.title },
        }],
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method : "POST",
    headers: {
      "Content-Type" : "application/json",
      "Authorization": `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401) {
      await sendTelegram(`❌ LinkedIn token expired.\n\nRefresh token kamu dan update secret:\n\`npx wrangler secret put LINKEDIN_ACCESS_TOKEN\``, env);
    } else {
      await sendTelegram(`❌ LinkedIn post gagal (${res.status}): ${err.slice(0, 200)}`, env);
    }
    return;
  }

  await sendTelegram(
    `✅ *Posted ke LinkedIn!*\n\n` +
    `*${articleInfo.title}*\n\n` +
    `_Artikel kamu sekarang live di dev.to + LinkedIn._`,
    env
  );
}

// ─── /suggest — Data-driven Topic Suggestions ──────────────────────────────

async function suggestTopics(env) {
  const username = env.DEVTO_USERNAME;
  if (!username) {
    await sendTelegram("⚠️ Set secret DEVTO_USERNAME dulu.", env);
    return;
  }

  const res = await fetch(
    `https://dev.to/api/articles?username=${username}&per_page=30`,
    { headers: { "User-Agent": "content-engine/1.0" } }
  );

  if (!res.ok) {
    await sendTelegram(`❌ Gagal fetch articles: ${res.status}`, env);
    return;
  }

  const articles = await res.json();
  if (articles.length === 0) {
    await sendTelegram("📭 Belum ada artikel published. Publish dulu beberapa artikel, lalu /suggest akan lebih akurat.", env);
    return;
  }

  // Build performance data for AI
  const sorted = [...articles].sort(
    (a, b) => (b.positive_reactions_count + b.comments_count * 5 + (b.page_views_count || 0) * 0.1)
            - (a.positive_reactions_count + a.comments_count * 5 + (a.page_views_count || 0) * 0.1)
  );

  const topArticles = sorted.slice(0, 5)
    .map(a => `- "${a.title}" → ❤️${a.positive_reactions_count} 💬${a.comments_count} 👁${a.page_views_count || 0} [${a.tag_list?.join(", ")}]`)
    .join("\n");

  const allTitles = articles.map(a => `"${a.title}"`).join(", ");
  const trending  = await getTrendingTopics();
  const trendCtx  = trending.slice(0, 5).map(t => `- "${t.title}" [${t.tag}] ❤️${t.reactions}`).join("\n");

  const prompt =
    `You are a content strategist for a developer in Indonesia who writes on dev.to.\n\n` +
    `TOP PERFORMING ARTICLES:\n${topArticles}\n\n` +
    `ALL PUBLISHED TITLES (to avoid duplicates):\n${allTitles}\n\n` +
    `CURRENTLY TRENDING IN THEIR NICHE:\n${trendCtx}\n\n` +
    `Based on this data:\n` +
    `1. What topics/formats clearly resonate with their audience?\n` +
    `2. What gaps exist (trending topics they haven't covered)?\n` +
    `3. Suggest 5 specific article titles they should write next\n\n` +
    `For each suggestion explain in 1 sentence WHY it will perform well.\n\n` +
    `Respond ONLY as JSON:\n` +
    `{\n` +
    `  "patterns": "...(2-3 sentences about what works for this writer)",\n` +
    `  "suggestions": [\n` +
    `    { "title": "...", "why": "...(1 sentence)" },\n` +
    `    ...\n` +
    `  ]\n` +
    `}`;

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method : "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 1500, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });

  if (!aiRes.ok) { await sendTelegram(`❌ OpenAI error: ${aiRes.status}`, env); return; }

  const aiData    = await aiRes.json();
  const result    = JSON.parse(aiData.choices[0].message.content);
  const suggList  = result.suggestions
    .map((s, i) => `${i + 1}. *${s.title}*\n   _${s.why}_`)
    .join("\n\n");

  await sendTelegram(
    `📈 *Data-driven Topic Suggestions*\n\n` +
    `*Pattern yang works buat kamu:*\n${result.patterns}\n\n` +
    `─────────────────\n` +
    `*5 Artikel yang harus kamu tulis selanjutnya:*\n\n` +
    `${suggList}\n\n` +
    `_/generate [judul] untuk langsung generate salah satunya._`,
    env
  );
}

// ─── Trending Topics ───────────────────────────────────────────────────────

async function getTrendingTopics() {
  const results = [];
  for (const tag of NICHE_TAGS.slice(0, 3)) {
    const res = await fetch(
      `https://dev.to/api/articles?tag=${tag}&top=7&per_page=4`,
      { headers: { "User-Agent": "content-engine/1.0" } }
    );
    if (!res.ok) continue;
    const articles = await res.json();
    results.push(...articles.map(a => ({ title: a.title, tag, reactions: a.positive_reactions_count, comments: a.comments_count })));
  }
  return results.sort((a, b) => (b.reactions + b.comments * 3) - (a.reactions + a.comments * 3)).slice(0, 8);
}

// ─── Generate Article ──────────────────────────────────────────────────────

async function generateArticle(trending, ideas, env) {
  const trendingContext = trending.map(t => `- "${t.title}" [${t.tag}] — ${t.reactions} reactions, ${t.comments} comments`).join("\n");
  const ideasContext    = ideas.length > 0
    ? `\nWRITER'S OWN EXPERIENCES & IDEAS (use as the soul of the article):\n${ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n")}`
    : "";

  const prompt =
    `You are ghostwriting for a developer from Batam, Indonesia on dev.to.\n` +
    `Voice: honest, first-person, shares real mistakes & wins.\n` +
    ideasContext + "\n\n" +
    `TRENDING:\n${trendingContext}\n\n` +
    `━━━ FORMULA (top dev.to writers, 500+ reactions) ━━━\n` +
    `TITLE: "I [X] for [time] — here's what I found" | "The [X] nobody tells you" | "Stop [X]. Do [Y]." | "I thought I understood [X]. Then [Y] happened."\n\n` +
    `STRUCTURE:\n` +
    `1. HOOK (2-3 sentences, no "In this article") — start mid-scene\n` +
    `2. SETUP — context & stakes\n` +
    `3. CHALLENGE (## heading) — buggy/messy code, real error\n` +
    `4. BREAKTHROUGH (## heading) — fix + clean code + WHY\n` +
    `5. DEEPER INSIGHT — the bigger principle\n` +
    `6. WHAT I'D DO DIFFERENTLY — actionable bullets\n` +
    `7. CLOSING QUESTION — specific, invites debate\n\n` +
    `RULES: min 1000 words · 2+ code blocks · no "Conclusion" heading · no vague advice · tags: 4 from [${NICHE_TAGS.join(", ")}]\n\n` +
    `JSON only: { "title":"...", "description":"...(max 140 chars)", "tags":"t1,t2,t3,t4", "body":"...(full article)" }`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method : "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 8192, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  return JSON.parse((await res.json()).choices[0].message.content.trim());
}

// ─── Commit to Main ────────────────────────────────────────────────────────

async function commitToMain(article, env) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = article.title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
  const filePath = `articles/${date}-${slug}.md`;

  const frontmatter =
    `---\n` +
    `title: "${article.title.replace(/"/g, '\\"')}"\n` +
    `published: false\n` +
    `tags: ${article.tags}\n` +
    `description: "${(article.description || "").replace(/"/g, '\\"')}"\n` +
    (article.series ? `series: "${article.series.replace(/"/g, '\\"')}"\n` : "") +
    `# devto_id: (filled after first publish)\n` +
    `---\n\n`;

  const encoded = btoa(unescape(encodeURIComponent(frontmatter + article.body)));
  const headers = {
    "Authorization"          : `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type"           : "application/json",
    "Accept"                 : "application/vnd.github+json",
    "X-GitHub-Api-Version"   : "2022-11-28",
    "User-Agent"             : "content-engine/1.0",
  };

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${filePath}`, {
    method: "PUT",
    headers,
    body  : JSON.stringify({ message: `draft: ${article.title}`, content: encoded, branch: "main" }),
  });
  if (!res.ok) throw new Error(`GitHub commit failed: ${await res.text()}`);
}

// ─── Weekly Digest ─────────────────────────────────────────────────────────

async function sendWeeklyDigest(env) {
  const username = env.DEVTO_USERNAME;
  if (!username) { await sendTelegram("⚠️ Set DEVTO_USERNAME secret.", env); return; }
  const res = await fetch(`https://dev.to/api/articles?username=${username}&per_page=20`, { headers: { "User-Agent": "content-engine/1.0" } });
  if (!res.ok) { await sendTelegram(`❌ Gagal fetch stats: ${res.status}`, env); return; }
  const articles = await res.json();
  if (articles.length === 0) { await sendTelegram("📭 Belum ada artikel.", env); return; }

  const sorted      = [...articles].sort((a, b) => (b.positive_reactions_count + b.comments_count * 3) - (a.positive_reactions_count + a.comments_count * 3));
  const totalViews  = articles.reduce((s, a) => s + (a.page_views_count || 0), 0);
  const totalReact  = articles.reduce((s, a) => s + a.positive_reactions_count, 0);
  const topList     = sorted.slice(0, 3).map((a, i) =>
    `${["🥇","🥈","🥉"][i]} *${a.title}*\n   ❤️${a.positive_reactions_count} 💬${a.comments_count} 👁${a.page_views_count || 0}`
  ).join("\n\n");

  await sendTelegram(
    `📊 *Weekly Digest*\n\n📝 ${articles.length} articles · 👁 ${totalViews.toLocaleString()} views · ❤️ ${totalReact} reactions\n\n🏆 *Top:*\n\n${topList}\n\n👉 [Dashboard](https://dev.to/dashboard)`,
    env
  );
}

// ─── URL Scraping ──────────────────────────────────────────────────────────

function looksLikeURL(text) {
  return /^https?:\/\/\S+$/.test(text.trim());
}

async function scrapeAndExtract(url, env) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; content-engine/1.0)", Accept: "text/html" }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html  = await res.text();
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000);
  if (clean.length < 100) throw new Error("Halaman tidak bisa dibaca");

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method : "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body   : JSON.stringify({
      model: "gpt-4o-mini", max_tokens: 600,
      messages: [{ role: "user", content: `Extract 3-5 specific, surprising insights from this article. Focus on practical lessons, controversial takes, or things most developers don't know. Bullet points starting with •.\n\nURL: ${url}\n\nContent:\n${clean}` }],
    }),
  });
  if (!aiRes.ok) throw new Error(`OpenAI error: ${aiRes.status}`);
  return (await aiRes.json()).choices[0].message.content.trim();
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
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "Markdown", disable_web_page_preview: true }),
  });
  if (!res.ok) console.warn("Telegram failed:", await res.text());
}
