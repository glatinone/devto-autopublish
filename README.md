# devto-autopublish

> A personal content engine — send an idea to Telegram, wake up to a draft on dev.to.

![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?logo=github-actions&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-Automation-F38020?logo=cloudflare&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

**Live articles:** [dev.to/kielltampubolon](https://dev.to/kielltampubolon)

---

## What this is

Most developer blogs die because writing consistently is hard. This pipeline removes the friction:

- **Send ideas to Telegram** anytime — shower thoughts, today's bug, something you learned
- **Every weekday at 9am** a Cloudflare Worker turns your ideas into a full article draft
- **GitHub Actions** pushes it to dev.to as a draft automatically
- **You review and publish** from dev.to dashboard — one click, done

Your only job: send raw thoughts. The pipeline handles the rest.

---

## Full architecture

```
┌─────────────────────────────────────────────────────────┐
│  YOUR TELEGRAM                                          │
│  "baru nemu bug aneh di wrangler secret handling"  ──→ │
│  "insight: edge computing lebih murah dari lambda"      │
│  /generate cloudflare KV tips                           │
└──────────────────────┬──────────────────────────────────┘
                       │ saved to Cloudflare KV
                       ▼
┌─────────────────────────────────────────────────────────┐
│  CLOUDFLARE WORKER  (content-engine)                    │
│  Cron: weekdays 09:00 WIB                               │
│                                                         │
│  1. Fetch trending topics → dev.to API                  │
│  2. Load your saved ideas → Cloudflare KV               │
│  3. Generate article → OpenAI GPT-4o-mini               │
│  4. Commit to main → GitHub API                         │
│  5. Notify → Telegram                                   │
└──────────────────────┬──────────────────────────────────┘
                       │ push to articles/*.md
                       ▼
┌─────────────────────────────────────────────────────────┐
│  GITHUB ACTIONS  (.github/workflows/publish-to-devto)   │
│  Detects changed .md → runs publish.js                  │
└──────────────────────┬──────────────────────────────────┘
                       │ API call
                       ▼
┌─────────────────────────────────────────────────────────┐
│  DEV.TO                                                 │
│  Article created as draft                               │
│  You review → click Publish → live 🚀                   │
└─────────────────────────────────────────────────────────┘
                       │ Sunday 08:00 WIB
                       ▼
               📊 Weekly digest to Telegram
               (views, reactions, top articles)
```

---

## Repository structure

```
devto-autopublish/
├── .github/
│   └── workflows/
│       └── publish-to-devto.yml   ← Detects changed .md, publishes to dev.to
│
├── articles/
│   ├── _template.md               ← Copy this for manual articles
│   └── 2026-05-05-*.md            ← AI-generated + manual articles
│
├── scripts/
│   ├── package.json
│   └── publish.js                 ← Calls dev.to API (create/update)
│
├── content-engine/                ← Cloudflare Worker
│   ├── src/
│   │   └── worker.js              ← Main automation brain
│   ├── wrangler.toml
│   └── package.json
│
└── README.md
```

---

## Part 1 — GitHub Actions publish pipeline

Handles the actual publishing. Every push to `main` that changes a file in `articles/` triggers it.

### Setup (5 minutes)

**1. Get your dev.to API key**

Go to [dev.to/settings/extensions](https://dev.to/settings/extensions) → **DEV Community API Keys** → Generate

**2. Add secret to GitHub repo**

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
- Name: `DEVTO_API_KEY`
- Value: your API key

**3. Push an article**

```bash
cp articles/_template.md articles/2026-05-05-my-post.md
# edit the file
git add articles/2026-05-05-my-post.md
git commit -m "add: my post"
git push
```

Article appears as draft on dev.to within ~30 seconds.

### How updates work

After first publish, copy the `devto_id` from the Actions log into your frontmatter:

```yaml
devto_id: 3612154   ← add this
```

Future pushes **update** the article instead of creating duplicates.

### Published status

The `published` field in frontmatter is **only used on first creation** (always creates as draft). Once on dev.to, publish/unpublish from the dashboard — pushing the file again won't change it.

---

## Part 2 — Content Engine (Cloudflare Worker)

The automation brain. Generates articles from your ideas every weekday.

### Telegram commands

| Command | What it does |
|---|---|
| *any message* | Save as idea/inspiration for next article |
| `/generate [topic]` | Generate article right now from a topic |
| `/ideas` | Show everything saved in your inbox |
| `/clear` | Clear idea inbox |
| `/digest` | Get your article performance stats now |
| `/status` | Check pipeline health |

### Setup

**1. Install and deploy**

```bash
cd content-engine
npm install
npx wrangler login
npx wrangler deploy
```

**2. Set secrets**

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GITHUB_TOKEN        # needs repo scope
npx wrangler secret put GITHUB_REPO         # glatinone/devto-autopublish
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put DEVTO_USERNAME      # your dev.to username
```

**3. Register Telegram webhook**

After deploying, run this once (replace with your values):

```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://content-engine.<YOUR_SUBDOMAIN>.workers.dev/telegram
```

**4. Test**

Hit `https://content-engine.<subdomain>.workers.dev/trigger` — you'll get a Telegram notification and a new draft on dev.to within ~30 seconds.

### Cost

| Service | Cost |
|---|---|
| Cloudflare Workers | Free (100k req/day) |
| OpenAI GPT-4o-mini | ~$0.01 per article |
| Cloudflare KV | Free |
| **Total per month** | **~$0.20** |

---

## Frontmatter reference

```yaml
---
title: "Your Article Title"
published: false
tags: webdev, javascript, beginners, tutorial
description: "Short SEO description (max 140 chars)"
cover_image: "https://example.com/cover.png"
series: "My Series Name"
devto_id: 123456
---
```

| Field | Required | Notes |
|---|---|---|
| `title` | **Yes** | Article title |
| `published` | No | Ignored on update — use dev.to dashboard |
| `tags` | No | Max 4, comma-separated, lowercase |
| `description` | No | SEO preview text |
| `cover_image` | No | Full URL, recommended 1000×420px |
| `series` | No | Groups articles on dev.to |
| `devto_id` | No | Add after first publish to enable updates |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Workflow doesn't trigger | File must be in `articles/` and pushed to `main` |
| `DEVTO_API_KEY` not found | Secret name must be exactly `DEVTO_API_KEY` |
| Duplicate articles | Add `devto_id` to frontmatter |
| Worker doesn't generate | Check `npx wrangler tail` for error logs |
| Telegram bot not responding | Re-register webhook URL after each deploy |
| Article body too short | Check OpenAI API credits — gpt-4o-mini may truncate on low balance |

---

## What people are building with pipelines like this

This is part of a wider movement of developers treating themselves as **personal media companies**:

- **Ghost + Zapier + Claude** — newsletter automation ($50-200/month in tools)
- **Beehiiv AI** — newsletter drafts with human approval
- **Buffer + AI** — social media scheduling from one source
- **Voice memo → Article** — record while commuting, AI writes the post

This repo does it for **~$0.20/month** on infrastructure you fully own and control.

---

## Roadmap

- [x] GitHub Actions auto-publish pipeline
- [x] Smart update (devto_id) — no duplicates
- [x] Dashboard-controlled publish status
- [x] Cloudflare Worker cron — daily article generation
- [x] Telegram idea inbox → AI article
- [x] `/generate [topic]` on demand
- [x] Weekly performance digest
- [ ] `/generate` with series support — plan a 5-part series
- [ ] Auto-fill `devto_id` back into the .md file after first publish
- [ ] Cross-post to Hashnode
- [ ] Voice memo input (WhatsApp → transcribe → article)
- [ ] Comment reply drafts sent to Telegram for approval

---

## License

MIT
