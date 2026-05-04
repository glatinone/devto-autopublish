# devto-autopublish

> Write a `.md` file, push to `main`, and it goes live on dev.to — automatically.

![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI%2FCD-2088FF?logo=github-actions&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

---

## How it works

```
You write Markdown  →  git push  →  GitHub Actions runs  →  Article live on dev.to
```

Every push to `main` that touches a file inside `articles/` triggers the workflow. The script reads the frontmatter of each changed file, then calls the dev.to API to create or update the article.

---

## Project structure

```
devto-autopublish/
├── .github/
│   └── workflows/
│       └── publish-to-devto.yml   ← GitHub Actions workflow
├── articles/
│   ├── _template.md               ← Copy this for every new article
│   ├── 2025-05-04-my-first-post.md
│   └── ...
├── scripts/
│   ├── package.json
│   └── publish.js                 ← Core publish script
└── README.md
```

---

## Setup (one-time, ~5 minutes)

### 1. Get your dev.to API key

1. Go to [dev.to/settings/extensions](https://dev.to/settings/extensions)
2. Scroll to **DEV Community API Keys**
3. Click **Generate API Key**, give it a name, copy the key

### 2. Add the secret to your GitHub repo

1. Open your repo on GitHub → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `DEVTO_API_KEY`
4. Value: paste your API key
5. Click **Add secret**

### 3. That's it

The workflow is already wired up. Every push to `main` that changes a file in `articles/` will trigger a publish.

---

## Daily workflow

### Create a new article

```bash
cp articles/_template.md articles/2025-05-04-my-awesome-post.md
```

Open the new file, fill in the frontmatter, write your article, then:

```bash
git add articles/2025-05-04-my-awesome-post.md
git commit -m "add: my awesome post"
git push
```

GitHub Actions picks it up and publishes within ~30 seconds.

### Check the result

Go to [dev.to/dashboard](https://dev.to/dashboard) to see your article. If `published: false`, it appears as a draft.

---

## Frontmatter reference

Every article must have YAML frontmatter at the top of the file:

```yaml
---
title: "Your Article Title"
published: false
tags: webdev, javascript, beginners, tutorial
description: "Short description shown in the dev.to feed and search results"
cover_image: "https://example.com/your-cover-image.png"
series: "My Series Name"
devto_id: 123456
---
```

| Field | Required | Description |
|---|---|---|
| `title` | **Yes** | Article title shown on dev.to |
| `published` | No | `true` = live, `false` = draft. Defaults to `false` |
| `tags` | No | Comma-separated or YAML list. Max 4 tags, each lowercase |
| `description` | No | SEO description, shown in feed previews |
| `cover_image` | No | Full URL to a cover image (recommended: 1000×420px) |
| `series` | No | Groups articles under a named series on dev.to |
| `devto_id` | No | Added after first publish — enables updates instead of duplicates |

---

## Draft vs. publish

| `published` value | Result |
|---|---|
| `false` | Creates a **draft** — visible only to you on the dashboard |
| `true` | Goes **live** immediately and appears in the dev.to feed |

### Recommended flow

```
1. Push with published: false  →  review your draft on dev.to
2. Tweak until happy
3. Change to published: true   →  push again  →  it goes live
```

---

## Updating an existing article

After the first publish the GitHub Actions log prints the `devto_id`. Add it to your frontmatter:

```yaml
---
title: "My Article"
published: true
devto_id: 1928374   # ← add this line
---
```

Every subsequent push **updates** the existing article instead of creating a duplicate.

> **Tip:** The `devto_id` is also visible in the URL on dev.to, e.g. `dev.to/you/my-article-1928374`.

---

## Local testing

Run the publish script locally without triggering GitHub Actions:

```bash
cd scripts
npm install
DEVTO_API_KEY=your_key_here node publish.js ../articles/your-article.md
```

On Windows (PowerShell):

```powershell
cd scripts
npm install
$env:DEVTO_API_KEY="your_key_here"; node publish.js ../articles/your-article.md
```

The script prints what it's doing and exits with code `1` on any error, so it's safe to run repeatedly.

---

## GitHub Actions workflow explained

The workflow (`.github/workflows/publish-to-devto.yml`) does the following on every push to `main`:

1. Checks out the repo with `fetch-depth: 2` to compare the current and previous commit
2. Detects which `.md` files inside `articles/` changed in the latest push
3. Runs `scripts/publish.js` once per changed file
4. Logs the result (article URL + ID) or exits with an error

Only files that changed in the push are processed — unchanged articles are skipped.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Workflow doesn't trigger | Make sure your file is inside `articles/` and you pushed to `main` |
| `DEVTO_API_KEY` not found | Double-check the secret name — it must be exactly `DEVTO_API_KEY` |
| Article created as draft when `published: true` | dev.to may rate-limit new accounts. Wait a bit and push again |
| Duplicate articles | Add `devto_id` to frontmatter (see [Updating an existing article](#updating-an-existing-article)) |
| `fetch-depth` error | The workflow needs at least 2 commits. Create an initial commit first |

---

## Roadmap

- [ ] Telegram bot: send a `.md` file to a bot → auto-push → auto-publish
- [ ] Scheduled publishing: push now, go live at a specific time
- [ ] Cross-post to Hashnode and Medium
- [ ] Auto-fill `devto_id` back into the markdown file after first publish

---

## License

MIT
