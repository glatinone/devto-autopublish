---
title: I Shipped My First Cloudflare Worker via GitHub Actions in 47 Minutes (3 Were Wasted on the Wrong API Token)
published: false
tags: cloudflare, github, devops, beginners
---

My first Cloudflare Worker deployed in 47 minutes. Three of those were spent staring at this exact error in a red GitHub Actions log: `Authentication error [code: 10000]`. I had the API token. I had the account ID. I had copy-pasted the workflow from the official docs. It still failed.

The fix was one checkbox I never selected. That checkbox is the entire reason I'm writing this post, because every tutorial I read assumed I would not get it wrong.

## What I Built

A Cloudflare Worker that returns a JSON response saying hello. Three lines of actual logic. One `wrangler.toml` file. One GitHub Actions workflow. Push to `main`, the Worker is live on the edge, end of story.

The point was never the Worker itself. The point was getting the pipeline working so the next 100 commits ship themselves.

## The Setup That Actually Works

Here is the worker. It lives at `src/index.js`:

```javascript
export default {
  async fetch(request, env, ctx) {
    return Response.json({
      message: "Hello from the edge",
      region: request.cf?.colo ?? "unknown",
    });
  },
};
```

The `wrangler.toml`:

```toml
name = "hello-edge"
main = "src/index.js"
compatibility_date = "2025-01-01"
```

And the GitHub Actions workflow at `.github/workflows/deploy.yml`:

```yaml
name: Deploy Worker

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

That is the whole thing. Three files. Roughly 25 lines including blanks.

## The 3 Minutes I Want Back

The first time I pushed, the Action failed in 11 seconds with `Authentication error [code: 10000]`. I assumed I had pasted the token wrong. I rotated it. Same error. I checked the secret name. Correct. I read the wrangler-action README twice. I started questioning the structure of reality.

What I had done: created a Cloudflare API token using the **"Read All Resources"** template because I was being cautious. That token can read everything and write nothing. Wrangler needs to write. The fix was to use the **"Edit Cloudflare Workers"** template instead, which scopes write access to exactly the Workers resource and nothing else.

The reason this isn't obvious from the error: code 10000 is Cloudflare's generic auth failure. It does not say "your token has no write permission." It says "auth bad." Three minutes of my life, gone, to a missing checkbox.

The other gotcha most posts skip: the **Account ID is not a secret**. It's visible in your dashboard URL. Storing it as a GitHub secret is fine, but it's not protecting anything sensitive. The API token is the actual key to the kingdom. Do not commit it. Do not log it. Rotate it if you so much as look at it sideways in a public terminal.

## Why I Bothered With CI/CD on Day One

Honest answer: I almost didn't. The Cloudflare dashboard has a perfectly fine "Connect to Git" button that wires up auto-deploys without writing a single line of YAML. For a beginner shipping one Worker, that is the faster path.

I went with GitHub Actions anyway because of one thing: control. The wrangler-action approach lets me add steps I'll need later, like running tests before deploy, deploying to a staging environment first, posting to Slack on failure, gating on a manual approval. The dashboard integration gives me a black box. The Actions workflow gives me a file I can read.

The trade is more setup time now (about 15 extra minutes) for unlimited flexibility later. For a learning project, that's the right trade. For shipping a one-off marketing site, just click the button.

## The First Successful Deploy

It logged this:

```
Total Upload: 0.42 KiB / gzip: 0.30 KiB
Uploaded hello-edge (1.15 sec)
Deployed hello-edge triggers (0.32 sec)
  https://hello-edge.<my-subdomain>.workers.dev
```

I clicked the URL. It loaded in 38 milliseconds from a Singapore data center. I am writing this from Batam, Indonesia, so that's roughly 60 km away. My code, on a server, 60 km from me, deployed by a GitHub Action I wrote 47 minutes ago.

The thing I was not expecting: the satisfaction came from the pipeline, not the Worker. Pushing to `main` and watching the green check appear on GitHub, knowing my Worker is now live globally without me touching the Cloudflare dashboard, that's the actual feature. The Worker is a hello world. The CI/CD is the real thing I built.

## What This Teaches

Three things, if you're about to do this for the first time:

**Use the "Edit Cloudflare Workers" API token template, not "Read All Resources" or any custom one you build yourself.** The pre-baked template has the exact scopes wrangler needs. Custom tokens are how you lose 3 minutes to error code 10000.

**Set up the Actions pipeline before your code is interesting.** A boring Worker behind a working pipeline is worth more than a clever Worker you deploy by hand. The pipeline compounds. Your hand-deploys do not.

**The Account ID is public, the API token is not.** Store both as secrets if it makes your life easier, but understand which one matters. One leak is a footgun. The other leak is a key handed to a stranger.

## What I'm Building Next

Next step is preview deploys per pull request, so every PR gets its own `*.workers.dev` URL automatically. I think the answer is a second job in the workflow keyed on `pull_request`, plus a comment bot that posts the preview URL on the PR.

If you've done this with Workers (not Pages, that's the easy mode), what does your workflow look like? And what's the one CI/CD mistake you wish someone had warned you about on day one?
