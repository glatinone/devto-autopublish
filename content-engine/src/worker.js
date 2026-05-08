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
  try {
    // Priority: active series → saved ideas → trending
    const activeSeries = await getActiveSeries(env);
    const ideas        = forceTopic ? [forceTopic] : await getIdeas(env);
    const trending     = await getTrendingTopics();
    console.log(`📈 ${trending.length} trending articles fetched`);

    let article;
    let context = "";

    if (!forceTopic && activeSeries) {
      const next = activeSeries.articles[activeSeries.currentIndex];
      console.log(`📚 Series article ${activeSeries.currentIndex + 1}/${activeSeries.articles.length}: "${next.title}"`);
      article = await generateSeriesArticle(next, activeSeries, trending, ideas, env);
      context = `_Series: *${activeSeries.title}* — Part ${activeSeries.currentIndex + 1}/${activeSeries.articles.length}_`;

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
    await offerHookSelection(article, context, env);
    console.log("✅ Pipeline finished — waiting for /hook selection");

  } catch (err) {
    console.error("❌ Pipeline error:", err.message, err.stack);
    await sendTelegram(
      `❌ *Pipeline gagal*\n\n` +
      `\`${err.message?.slice(0, 300) || "Unknown error"}\`\n\n` +
      `_Ideas kamu masih aman di inbox. Coba /generate lagi._`,
      env
    ).catch(() => {});
  }
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

  // /linkedin — approval-based LinkedIn posting
  if (text.startsWith("/linkedin")) {
    await handleLinkedIn(text, env);
    return;
  }

  // /hook [1|2|3] — pick hook variant and commit pending draft
  if (text.startsWith("/hook")) {
    await handleHookSelection(text, env);
    return;
  }

  // /revise [devto_url] — AI-improve a published article based on comments
  if (text.startsWith("/revise")) {
    const url = text.replace("/revise", "").trim();
    if (!url) {
      await sendTelegram(
        `✏️ *Revise Artikel*\n\nUsage:\n/revise https://dev.to/username/judul-artikel\n\n_AI akan baca artikel + komentar kamu, lalu generate versi revisi yang lebih baik._`,
        env
      );
      return;
    }
    await sendTelegram(`✏️ Fetching artikel + komentar...\n_${url.slice(0, 60)}_`, env);
    await reviseArticle(url, env);
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
    const pendingDraft = await env.IDEAS_KV.get("draft:pending");
    const seriesInfo   = activeSeries
      ? `📚 Active series: *${activeSeries.title}*\n   Part ${activeSeries.currentIndex + 1}/${activeSeries.articles.length} next\n`
      : `📚 No active series\n`;
    const draftInfo = pendingDraft
      ? `\n⏳ *Draft menunggu hook:* ketik /hook untuk lihat opsi\n`
      : "";
    await sendTelegram(
      `🟢 *Content Engine*\n\n` +
      `${seriesInfo}` +
      `💡 Ideas in inbox: *${ideas.length}*\n` +
      `🕐 Cron: Weekdays 09:00 WIB` +
      draftInfo + `\n\n` +
      `*Commands:*\n` +
      `/series [topik] — plan series\n` +
      `/suggest — rekomendasi topik berdasarkan data\n` +
      `/linkedin [url] — post ke LinkedIn\n` +
      `/revise [url] — improve artikel berdasarkan komentar\n` +
      `/hook — lihat opsi hook untuk draft pending\n` +
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
          `You are planning a dev.to article series for a developer from Batam, Indonesia.\n\n` +
          `Topic: "${topic}"\n\n` +
          `Plan exactly 5 articles that:\n` +
          `- Build logically (practical start, real problems in the middle, advanced insight at the end)\n` +
          `- Each stands alone (readable without the others)\n` +
          `- Each covers a distinct sub-topic with a specific outcome\n\n` +
          `TITLE RULES (important):\n` +
          `- Format for each article: "Series Name, Part N: [Specific outcome or turning point]"\n` +
          `- No em dashes (—) in any title. Use periods or colons.\n` +
          `- No "Introduction to" / "Getting Started with" / "A Comprehensive Guide"\n` +
          `- Include a specific result, number, or tension in each title\n` +
          `- Example good title: "Cloudflare Workers, Part 2: Why My Deploy Broke at 2 AM (And How I Fixed It)"\n\n` +
          `Respond ONLY as JSON:\n` +
          `{\n` +
          `  "title": "Series name (short, 2-4 words)",\n` +
          `  "topic": "${topic}",\n` +
          `  "articles": [\n` +
          `    { "title": "...", "description": "...(what this part covers, 1 sentence, plain language)", "focus": "...(key technical concept)" },\n` +
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

  const isLastPart = series.currentIndex + 1 >= series.articles.length;
  const prompt =
    `You are ghostwriting Part ${series.currentIndex + 1} of ${series.articles.length} of a dev.to article series for a developer from Batam, Indonesia.\n\n` +
    `SERIES: "${series.title}"\n` +
    `THIS PART: "${seriesArticle.title}"\n` +
    `FOCUS: ${seriesArticle.focus}\n\n` +
    (prevParts ? `PREVIOUS PARTS (reference naturally for continuity, don't recap them heavily):\n${prevParts}\n\n` : "") +
    ideasContext + "\n\n" +
    `TRENDING CONTEXT:\n${trendingContext}\n\n` +
    `━━━ TITLE FORMULA ━━━\n` +
    `Format: "Series Name, Part N: [Specific outcome or turning point]"\n` +
    `Use a colon after the part number. No em dashes.\n\n` +
    `━━━ BANNED (AI tells - never use) ━━━\n` +
    `- Em dashes (—) anywhere. Use commas, colons, periods, or parentheses.\n` +
    `- "Let's dive in" / "In this article" / "In this part we will" / "Without further ado"\n` +
    `- "crucial" / "robust" / "seamless" / "leverage" / "game-changer"\n` +
    `- Three-item adjective stacks ("fast, reliable, scalable")\n` +
    `- "It's not just X, it's Y" constructions\n` +
    `- Generic positive endings\n` +
    `- Bullet-point body. Write prose.\n\n` +
    `━━━ STYLE ━━━\n` +
    `- First person. Use contractions (I'll, don't, wasn't).\n` +
    `- Vary sentence length. Short punchy ones mixed with longer ones.\n` +
    `- Specific numbers over vague claims.\n` +
    `- Start with a mid-scene hook. No "Welcome back to part N of..."\n` +
    (isLastPart
      ? `- This is the LAST part. End with a strong conclusion and a real debate question.\n`
      : `- End with a natural teaser for Part ${series.currentIndex + 2} (one sentence, not a cliffhanger cliche).\n`) +
    `\nRULES: minimum 900 words · 2+ real working code blocks · tags: exactly 4 from [${NICHE_TAGS.join(", ")}]\n\n` +
    `━━━ SELF-CHECK BEFORE OUTPUT ━━━\n` +
    `Fix before returning: em dashes (—) → commas/periods/colons · signposting phrases → delete · missing contractions → add\n\n` +
    `JSON only: { "title": "...", "description": "...(max 140 chars)", "tags": "t1, t2, t3, t4", "body": "...(full article in markdown)" }`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: 8192, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
  }
  const raw = await res.json();
  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  let parsed;
  try {
    parsed = JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`JSON parse failed: ${content.slice(0, 200)}`);
  }
  parsed.series = series.title;
  return parsed;
}

async function getActiveSeries(env) {
  const raw = await env.IDEAS_KV.get("series:active");
  return raw ? JSON.parse(raw) : null;
}

// ─── LinkedIn Approval Flow ────────────────────────────────────────────────

async function handleLinkedIn(text, env) {
  const arg = text.replace("/linkedin", "").trim();

  // /linkedin confirm — publish the pending caption
  if (arg === "confirm") {
    const raw = await env.IDEAS_KV.get("linkedin:pending");
    if (!raw) {
      await sendTelegram("⚠️ Tidak ada post LinkedIn yang menunggu. Jalankan /linkedin [url] dulu.", env);
      return;
    }
    const { articleInfo, caption } = JSON.parse(raw);
    await sendTelegram("📤 Posting ke LinkedIn...", env);
    await publishToLinkedIn(articleInfo, caption, env);
    await env.IDEAS_KV.delete("linkedin:pending");
    return;
  }

  // /linkedin cancel — discard pending
  if (arg === "cancel") {
    await env.IDEAS_KV.delete("linkedin:pending");
    await sendTelegram("🗑️ Draft LinkedIn dibatalkan.", env);
    return;
  }

  // /linkedin edit [new caption] — replace caption text
  if (arg.startsWith("edit ")) {
    const raw = await env.IDEAS_KV.get("linkedin:pending");
    if (!raw) {
      await sendTelegram("⚠️ Tidak ada post LinkedIn yang menunggu. Jalankan /linkedin [url] dulu.", env);
      return;
    }
    const pending     = JSON.parse(raw);
    pending.caption   = arg.replace("edit ", "").trim();
    await env.IDEAS_KV.put("linkedin:pending", JSON.stringify(pending), { expirationTtl: 60 * 60 * 48 });
    await sendTelegram(
      `✅ Caption diperbarui!\n\n*Preview:*\n${pending.caption}\n\n` +
      `/linkedin confirm — post sekarang\n/linkedin cancel — batalkan`,
      env
    );
    return;
  }

  // /linkedin (no args) — show pending or usage
  if (!arg) {
    const raw = await env.IDEAS_KV.get("linkedin:pending");
    if (raw) {
      const { articleInfo, caption } = JSON.parse(raw);
      await sendTelegram(
        `📋 *Draft LinkedIn pending:*\n\n${caption}\n\n` +
        `─────────────────\n` +
        `/linkedin confirm — post sekarang\n` +
        `/linkedin edit [teks baru] — ubah caption\n` +
        `/linkedin cancel — batalkan`,
        env
      );
    } else {
      await sendTelegram(
        `📤 *LinkedIn Post*\n\n` +
        `Usage:\n/linkedin https://dev.to/kamu/judul-artikel\n\n` +
        `AI akan generate draft caption dulu, kamu review sebelum posting.\n\n` +
        `Commands:\n` +
        `/linkedin [url] — buat draft\n` +
        `/linkedin confirm — post pending draft\n` +
        `/linkedin edit [teks] — edit caption\n` +
        `/linkedin cancel — batalkan`,
        env
      );
    }
    return;
  }

  // /linkedin [url] — generate caption draft
  if (!env.LINKEDIN_ACCESS_TOKEN || !env.LINKEDIN_PERSON_ID) {
    await sendTelegram(
      `⚠️ *LinkedIn belum dikonfigurasi.*\n\n` +
      `Set 2 secrets:\n` +
      `\`npx wrangler secret put LINKEDIN_ACCESS_TOKEN\`\n` +
      `\`npx wrangler secret put LINKEDIN_PERSON_ID\`\n\n` +
      `Cara dapat token:\n` +
      `1. Buat app di developers.linkedin.com\n` +
      `2. OAuth scope: \`w_member_social\`\n` +
      `3. PERSON\\_ID: GET https://api.linkedin.com/v2/me`,
      env
    );
    return;
  }

  await sendTelegram(`✍️ Generating caption draft...\n_${arg.slice(0, 60)}_`, env);

  // Fetch article info from dev.to
  let articleInfo = { title: arg, description: "", url: arg, tags: [] };
  try {
    const urlParts        = arg.replace(/^https?:\/\/dev\.to\//, "").split("/");
    const articleUsername = urlParts[0];
    const slug            = urlParts[1];
    if (articleUsername && slug) {
      const apiRes = await fetch(`https://dev.to/api/articles/${articleUsername}/${slug}`, {
        headers: { "User-Agent": "content-engine/1.0" },
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        articleInfo = { title: data.title, description: data.description || "", url: data.url, tags: data.tag_list || [], reactions: data.positive_reactions_count };
      }
    }
  } catch (_) {}

  const caption = await generateLinkedInCaption(articleInfo, env);

  // Store pending post
  await env.IDEAS_KV.put(
    "linkedin:pending",
    JSON.stringify({ articleInfo, caption }),
    { expirationTtl: 60 * 60 * 48 }
  );

  await sendTelegram(
    `📋 *Draft caption LinkedIn:*\n\n` +
    `─────────────────\n` +
    `${caption}\n` +
    `─────────────────\n\n` +
    `✅ /linkedin confirm — post sekarang\n` +
    `✏️ /linkedin edit [teks baru] — ubah caption\n` +
    `❌ /linkedin cancel — batalkan`,
    env
  );
}

async function generateLinkedInCaption(articleInfo, env) {
  const hashtags = articleInfo.tags && articleInfo.tags.length > 0
    ? articleInfo.tags.slice(0, 4).map(t => `#${t.replace(/[^a-zA-Z0-9]/g, "")}`).join(" ")
    : "#webdev #javascript #cloudflare";

  const prompt =
    `Write a LinkedIn post caption for a developer sharing their dev.to article.\n\n` +
    `ARTICLE:\n` +
    `Title: "${articleInfo.title}"\n` +
    `Description: "${articleInfo.description}"\n` +
    `URL: ${articleInfo.url}\n\n` +
    `WRITER CONTEXT:\n` +
    `- Developer from Batam, Indonesia. Building in public.\n` +
    `- Writes about Cloudflare Workers, web development, GitHub automation, DevOps.\n` +
    `- Tone: direct, honest, not corporate. Shares real mistakes and wins.\n\n` +
    `CAPTION STRUCTURE:\n` +
    `Line 1-2: A short punchy observation or lesson from the article (not the title). Max 2 sentences.\n` +
    `Line 3 (blank line)\n` +
    `Line 4-6: 2-3 bullet points (using arrows >) of the most concrete takeaways. Specific, not vague.\n` +
    `Line 7 (blank line)\n` +
    `Line 8: "Full article:" + the URL\n` +
    `Line 9 (blank line)\n` +
    `Line 10: hashtags\n\n` +
    `RULES:\n` +
    `- No em dashes (—). Use commas or colons.\n` +
    `- No "I'm excited to share" / "Thrilled to announce" / "Check this out"\n` +
    `- No "game-changer" / "leverage" / "robust"\n` +
    `- First person. Contractions are fine.\n` +
    `- Max 300 characters before the URL line (LinkedIn algorithm preference)\n` +
    `- End with these hashtags: ${hashtags}\n\n` +
    `Return ONLY the caption text. No JSON. No explanation.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    return (await res.json()).choices[0].message.content.trim();
  } catch (_) {
    // Fallback caption
    return `${articleInfo.title}\n\n${articleInfo.description ? articleInfo.description + "\n\n" : ""}Full article: ${articleInfo.url}\n\n${hashtags}`;
  }
}

async function publishToLinkedIn(articleInfo, caption, env) {
  const body = {
    author          : `urn:li:person:${env.LINKEDIN_PERSON_ID}`,
    lifecycleState  : "PUBLISHED",
    specificContent : {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary    : { text: caption },
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
      "Content-Type"              : "application/json",
      "Authorization"             : `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`,
      "X-Restli-Protocol-Version" : "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401) {
      await sendTelegram(`❌ LinkedIn token expired.\n\nUpdate:\n\`npx wrangler secret put LINKEDIN_ACCESS_TOKEN\``, env);
    } else {
      await sendTelegram(`❌ LinkedIn gagal (${res.status}): ${err.slice(0, 200)}`, env);
    }
    return;
  }

  await sendTelegram(
    `✅ *Posted ke LinkedIn!*\n\n*${articleInfo.title}*\n\n_Live di dev.to + LinkedIn._`,
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

// ─── Hook A/B Selection ────────────────────────────────────────────────────

async function offerHookSelection(article, pipelineContext, env) {
  await sendTelegram(`✍️ *"${article.title}"*\n\n_Generating 3 hook variants..._`, env);

  const hooks = await generateHookVariants(article, env);

  // Store the full draft + hooks in KV (expire after 48h)
  await env.IDEAS_KV.put(
    "draft:pending",
    JSON.stringify({ article, hooks, context: pipelineContext }),
    { expirationTtl: 60 * 60 * 48 }
  );

  const hookPreviews = hooks
    .map((h, i) => `*Hook ${i + 1}:*\n${h.slice(0, 220)}${h.length > 220 ? "…" : ""}`)
    .join("\n\n─────────────────\n\n");

  await sendTelegram(
    `🎣 *Pilih opening untuk artikel ini:*\n\n` +
    hookPreviews + `\n\n` +
    `─────────────────\n` +
    `Reply:\n` +
    `/hook 1 · /hook 2 · /hook 3\n\n` +
    `_Draft akan commit ke GitHub setelah kamu pilih._`,
    env
  );
}

async function generateHookVariants(article, env) {
  // Extract everything before the first ## heading as the current hook
  const bodyBeforeFirstSection = article.body.split(/\n## /)[0].trim();

  const prompt =
    `You are writing 3 alternative opening hooks for a dev.to article.\n\n` +
    `ARTICLE TITLE: "${article.title}"\n` +
    `CURRENT OPENING:\n${bodyBeforeFirstSection.slice(0, 600)}\n\n` +
    `Write 3 very different 2-3 sentence hooks using these 3 patterns:\n\n` +
    `HOOK 1 — Specific Moment + Reversal:\n` +
    `Drop mid-scene with a real time/number. Sentence 2 is the emotional peak. Sentence 3 reverses it.\n` +
    `Example: "My deploy finished at 11:47 PM on a Wednesday. I felt like a genius. By Thursday morning, three users had emailed me about a 500 error I'd introduced."\n\n` +
    `HOOK 2 — Near-Failure:\n` +
    `Open at the point of almost giving up. Include the specific bad output or error in quotes if possible. End with dry humor or self-deprecation.\n` +
    `Example: "For two days I almost deleted the whole project. The error message just said: 'Unexpected token.' No line number. No file. Just vibes."\n\n` +
    `HOOK 3 — Caught Something:\n` +
    `Start with what the tool/technique found or revealed. Honest reaction. One sentence on why that matters.\n` +
    `Example: "The profiler showed one function using 94% of CPU. It was a function I'd written three years ago and completely forgotten about. That's the article."\n\n` +
    `RULES for all hooks:\n` +
    `- No em dashes (—). Use commas, periods, or colons.\n` +
    `- No "In this article", "Let's dive in", "Have you ever"\n` +
    `- First person. Specific over generic.\n` +
    `- 2-3 sentences max each.\n\n` +
    `Respond ONLY as JSON: { "hooks": ["hook1 text", "hook2 text", "hook3 text"] }`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 800, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
    const data = JSON.parse((await res.json()).choices[0].message.content);
    return data.hooks;
  } catch (err) {
    console.warn("Hook generation failed, using original body start:", err.message);
    // Fallback: slice 3 similar hooks from the original body
    const orig = article.body.split(/\n## /)[0].trim();
    return [orig, orig, orig];
  }
}

async function handleHookSelection(text, env) {
  const raw = await env.IDEAS_KV.get("draft:pending");
  if (!raw) {
    await sendTelegram("⚠️ Tidak ada draft yang menunggu. Jalankan /generate dulu.", env);
    return;
  }

  const { article, hooks, context } = JSON.parse(raw);
  const arg = text.replace("/hook", "").trim();

  // /hook (no number) → show options again
  if (!arg) {
    const hookPreviews = hooks
      .map((h, i) => `*Hook ${i + 1}:*\n${h.slice(0, 220)}${h.length > 220 ? "…" : ""}`)
      .join("\n\n─────────────────\n\n");
    await sendTelegram(
      `🎣 *Draft: "${article.title}"*\n\n` +
      hookPreviews + `\n\n─────────────────\n` +
      `/hook 1 · /hook 2 · /hook 3`,
      env
    );
    return;
  }

  const choice = parseInt(arg);
  if (isNaN(choice) || choice < 1 || choice > 3) {
    await sendTelegram("⚠️ Ketik /hook 1, /hook 2, atau /hook 3", env);
    return;
  }

  const chosenHook = hooks[choice - 1];

  // Replace the opening of the body (everything before first ## heading) with chosen hook
  const sections  = article.body.split(/(\n## )/);
  const restOfArticle = sections.length > 1
    ? sections.slice(1).join("")         // everything from first ## onward (with separator)
    : article.body;                       // no ## found, keep body as-is

  article.body = sections.length > 1
    ? chosenHook + "\n\n## " + restOfArticle
    : chosenHook + "\n\n" + restOfArticle;

  await sendTelegram(`✅ Hook ${choice} dipilih. Committing ke GitHub...`, env);

  try {
    await commitToMain(article, env);
    await env.IDEAS_KV.delete("draft:pending");
    await sendTelegram(
      `📝 *Draft live di dev.to!*\n\n` +
      `*Title:* ${article.title}\n` +
      `*Tags:* \`${article.tags}\`\n\n` +
      `👉 [Review & Publish](https://dev.to/dashboard)\n\n` +
      context,
      env
    );
  } catch (err) {
    await sendTelegram(`❌ Gagal commit: ${err.message}`, env);
  }
}

// ─── Revise Article ────────────────────────────────────────────────────────

async function reviseArticle(articleUrl, env) {
  const username = env.DEVTO_USERNAME;

  // Parse slug from URL: https://dev.to/username/slug or /username/slug
  const urlParts = articleUrl.replace(/^https?:\/\/dev\.to\//, "").split("/");
  const articleUsername = urlParts[0];
  const slug            = urlParts[1];

  if (!articleUsername || !slug) {
    await sendTelegram("❌ URL tidak valid. Format: https://dev.to/username/article-slug", env);
    return;
  }

  // Fetch article
  const articleRes = await fetch(`https://dev.to/api/articles/${articleUsername}/${slug}`, {
    headers: { "User-Agent": "content-engine/1.0" },
  });
  if (!articleRes.ok) {
    await sendTelegram(`❌ Artikel tidak ditemukan (${articleRes.status}). Cek URL-nya.`, env);
    return;
  }
  const articleData = await articleRes.json();

  // Fetch comments
  const commentsRes = await fetch(`https://dev.to/api/comments?a_id=${articleData.id}&per_page=50`, {
    headers: { "User-Agent": "content-engine/1.0" },
  });
  const commentsData = commentsRes.ok ? await commentsRes.json() : [];

  // Build comment context (top-level only, trim long ones)
  const commentContext = commentsData.length > 0
    ? commentsData
        .filter(c => !c.parent_id) // top-level only
        .slice(0, 10)
        .map(c => `- "${c.body_html.replace(/<[^>]+>/g, " ").trim().slice(0, 200)}"`)
        .join("\n")
    : "No comments yet.";

  await sendTelegram(
    `📊 Artikel: *${articleData.title}*\n` +
    `❤️ ${articleData.positive_reactions_count} reactions · 💬 ${commentsData.length} comments\n\n` +
    `_Generating revisi..._`,
    env
  );

  const prompt =
    `You are revising a dev.to article based on reader feedback and performance data.\n\n` +
    `ARTICLE TITLE: "${articleData.title}"\n` +
    `PERFORMANCE: ${articleData.positive_reactions_count} reactions, ${commentsData.length} comments\n\n` +
    `CURRENT ARTICLE BODY:\n${(articleData.body_markdown || "").slice(0, 5000)}\n\n` +
    `READER COMMENTS:\n${commentContext}\n\n` +
    `YOUR JOB:\n` +
    `1. Identify what readers responded to (what generated comments or questions)\n` +
    `2. Expand those sections with more depth\n` +
    `3. Fix anything that confused readers (based on comments)\n` +
    `4. Improve the hook if it's generic\n` +
    `5. Strengthen the closing question if it's vague\n\n` +
    `━━━ BANNED (AI tells) ━━━\n` +
    `- Em dashes (—) anywhere. Use commas, periods, colons, or parentheses.\n` +
    `- "Let's dive in" / "In this article" / "In conclusion"\n` +
    `- "crucial" / "robust" / "seamless" / "leverage" / "game-changer"\n` +
    `- Generic positive endings\n\n` +
    `RULES:\n` +
    `- Keep the same title unless it's genuinely weak\n` +
    `- Keep all code blocks (you can improve them)\n` +
    `- Minimum 1000 words\n` +
    `- First person. Contractions are fine.\n\n` +
    `Respond ONLY as JSON:\n` +
    `{\n` +
    `  "title": "...(same or improved)",\n` +
    `  "description": "...(max 140 chars)",\n` +
    `  "tags": "t1,t2,t3,t4",\n` +
    `  "body": "...(full revised article in markdown)",\n` +
    `  "changes": "...(2-3 sentences: what you changed and why)"\n` +
    `}`;

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method : "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 8192, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });

  if (!aiRes.ok) {
    await sendTelegram(`❌ OpenAI error: ${aiRes.status}`, env);
    return;
  }

  const revised = JSON.parse((await aiRes.json()).choices[0].message.content);
  revised.body  = await humanizeArticle(revised.body, env);

  // If original article has devto_id tag info, carry it forward
  if (articleData.id) revised.devto_id = articleData.id;

  await commitToMain(revised, env);

  await sendTelegram(
    `✏️ *Revisi selesai!*\n\n` +
    `*Title:* ${revised.title}\n\n` +
    `*Yang diubah:*\n${revised.changes}\n\n` +
    `👉 [Review di Dashboard](https://dev.to/dashboard)\n\n` +
    `_Cek artikel di GitHub, publish kalau sudah OK._`,
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
  const trendingContext = trending.map(t => `- "${t.title}" [${t.tag}] - ${t.reactions} reactions, ${t.comments} comments`).join("\n");
  const ideasContext    = ideas.length > 0
    ? `\nWRITER'S OWN EXPERIENCES & IDEAS (these are the soul of the article - weave them in as real stories):\n${ideas.map((idea, i) => `${i + 1}. ${idea}`).join("\n")}`
    : "";

  const prompt =
    `You are ghostwriting a dev.to article for a developer from Batam, Indonesia.\n` +
    `First person. Honest. Real mistakes. Real wins. Specific numbers over vague claims.\n` +
    ideasContext + "\n\n" +
    `TRENDING RIGHT NOW:\n${trendingContext}\n\n` +
    `━━━ TITLE FORMULA (pick the one that fits best) ━━━\n` +
    `- "I [X] for [N] Days. [Specific thing] Changed on Day [N]." (use period not dash)\n` +
    `- "[Tool] Burned [specific number]. Here's the Habit That Prevents It."\n` +
    `- "Stop [X]. [Specific alternative] Does the Same Thing Faster."\n` +
    `- "I Was Wrong About [X]. Here Is the Moment That Changed It."\n` +
    `- "[Tool] Only Worked When I Stopped [doing obvious thing]."\n` +
    `NO em dashes in titles. Use a period or colon to separate two parts.\n\n` +
    `━━━ STRUCTURE ━━━\n` +
    `HOOK (first 2-3 sentences): Drop mid-scene. Include a specific time, number, or named thing. Reverse the emotional valence in sentence 2 or 3. No "In this article", no "Have you ever".\n` +
    `SETUP: Context and what was at stake. One paragraph.\n` +
    `## [Section heading]: The problem with real error or messy code.\n` +
    `## [Section heading]: The fix. Real working code. Explain the WHY not just the WHAT.\n` +
    `## [Section heading]: The bigger principle behind the fix.\n` +
    `CLOSING (no heading): 1-2 sentences what you'd do differently. Then ONE specific question to drive comments (not "what do you think?" - something with a real stake or debate).\n\n` +
    `━━━ BANNED (these make it look AI-written, never use them) ━━━\n` +
    `- Em dashes (—) anywhere in title or body. Use commas, periods, colons, or parentheses instead.\n` +
    `- "Let's dive in" / "In this article" / "Without further ado" / "In conclusion"\n` +
    `- "it's worth noting" / "it's important to remember" / "needless to say"\n` +
    `- "crucial" / "robust" / "seamless" / "leverage" / "game-changer" / "powerful"\n` +
    `- Three-item adjective stacks: "fast, reliable, and scalable"\n` +
    `- "It's not just X, it's Y" constructions\n` +
    `- Generic positive endings: "exciting times ahead" / "the future looks bright"\n` +
    `- Vague attributions: "many developers" / "experts agree" / "it's widely known"\n` +
    `- Headers followed immediately by a one-line restatement before real content\n\n` +
    `━━━ STYLE ━━━\n` +
    `- Use contractions (I'll, don't, can't, wasn't)\n` +
    `- Vary sentence length. Short punchy ones. Then longer ones that give context and let an idea breathe.\n` +
    `- Occasional parenthetical aside as an aside (like this)\n` +
    `- Self-deprecating humor is fine in one place\n` +
    `- If you mention cost or metrics, use exact numbers ($0.42, 9 days, 47 tests)\n` +
    `- Body is PROSE, not bullet lists. Bullets only for a 2-3 item action list max.\n\n` +
    `RULES: minimum 1000 words · 2+ real working code blocks · tags: exactly 4 from [${NICHE_TAGS.join(", ")}]\n\n` +
    `━━━ SELF-CHECK BEFORE OUTPUT ━━━\n` +
    `Scan your own output before returning. Fix any remaining:\n` +
    `- Em dashes (—) → replace with comma/period/colon\n` +
    `- "Let's dive in" / "In conclusion" / signposting phrases → delete\n` +
    `- "crucial/robust/seamless/leverage/game-changer" → plain language\n` +
    `- Paragraphs of 5+ sentences → split in two\n` +
    `- Missing contractions (I will → I'll, do not → don't)\n\n` +
    `JSON only: { "title":"...", "description":"...(max 140 chars)", "tags":"t1,t2,t3,t4", "body":"...(full article in markdown)" }`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method : "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 8192, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText.slice(0, 200)}`);
  }
  const raw = await res.json();
  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");
  try {
    return JSON.parse(content.trim());
  } catch (e) {
    throw new Error(`JSON parse failed. OpenAI response: ${content.slice(0, 200)}`);
  }
}

// ─── Humanizer Pass ────────────────────────────────────────────────────────

async function humanizeArticle(body, env) {
  const prompt =
    `You are a copy editor. Fix this dev.to article draft to remove all AI writing tells.\n\n` +
    `FIND AND FIX EVERY INSTANCE OF:\n` +
    `1. Em dashes (—) → replace with a comma, period, colon, or parentheses depending on context\n` +
    `2. "Let's dive in" / "In this article" / "In conclusion" / "Without further ado" / "Let me explain" → delete or rewrite the sentence\n` +
    `3. "crucial" / "robust" / "seamless" / "leverage" / "game-changer" / "powerful" / "cutting-edge" → use plain, specific language\n` +
    `4. Three-item adjective stacks ("fast, reliable, and scalable") → cut to one or two\n` +
    `5. "It's not just X, it's Y" / "Not merely X, but Y" → just say what it is\n` +
    `6. "it's worth noting" / "it's important to remember" / "needless to say" → delete these phrases\n` +
    `7. "Many developers" / "experts agree" / "it's widely known" → either cite something real or use "I think"\n` +
    `8. Generic positive endings ("exciting times ahead" / "the future is bright") → replace with a real takeaway or question\n` +
    `9. Symmetric bullet lists where every item has the same rhythm → convert to prose or break the pattern\n` +
    `10. H2 headers followed by a one-line restatement → delete the restatement, go straight to content\n\n` +
    `ALSO:\n` +
    `- Add contractions where they sound natural (I will → I'll, do not → don't, it is → it's)\n` +
    `- Break up any paragraph of 5+ sentences into two. Vary sentence length.\n` +
    `- If any number is vague ("a few", "some", "a couple"), leave it. Only replace if you have a real number from context.\n\n` +
    `DO NOT:\n` +
    `- Change the technical content, code blocks, or any factual claims\n` +
    `- Add new content\n` +
    `- Change headings unless they contain a banned phrase\n` +
    `- Change the structure of the article\n\n` +
    `Return ONLY the corrected article body in markdown. No JSON wrapper. No explanation.\n\n` +
    `ARTICLE:\n${body}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method : "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
      body   : JSON.stringify({ model: "gpt-4o-mini", max_tokens: 8192, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) {
      console.warn("Humanizer pass failed, using original body:", res.status);
      return body; // graceful fallback
    }
    const result = (await res.json()).choices[0].message.content.trim();
    console.log("✅ Humanizer pass complete");
    return result;
  } catch (err) {
    console.warn("Humanizer pass error, using original body:", err.message);
    return body;
  }
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
    (article.series   ? `series: "${article.series.replace(/"/g, '\\"')}"\n` : "") +
    (article.devto_id ? `devto_id: ${article.devto_id}\n` : `# devto_id: (filled after first publish)\n`) +
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
