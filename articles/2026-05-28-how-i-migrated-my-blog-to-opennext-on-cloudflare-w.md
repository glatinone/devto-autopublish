---
title: "How I Migrated My Blog to OpenNext on Cloudflare Workers Without Losing Traffic."
published: false
tags: cloudflare, webdev, devops, javascript
description: "Step-by-step guide to migrating blogs smoothly while maintaining audience engagement."
devto_id: 3767604
---

My terminal blared at 8:32 PM, echoing the command I had run to deploy my blog: ‘Deployment successful.’ I felt a surge of triumph. By midnight, Google Analytics showed a steep drop in traffic.

## 
## The Setup

I decided to migrate my static blog to OpenNext running on Cloudflare Workers. Why? I wanted a faster user experience and serverless deployment, which meant I wouldn’t have to worry about server management or scalability issues. Plus, with Cloudflare's edge network, I hoped to serve my content super close to my audience, giving them quicker load times.

## The Problem

After following the initial setup guide, I ran a deployment command that promised everything would go smoothly. Instead, I was met with that error message. Here’s a snippet of the `handler.js` file that was causing the hassle:

```javascript
export default { 
 async fetch(request) { 
 const url = new URL(request.url); 
 const pathname = url.pathname; 
 // I intended to check for paths and render the appropriate content here 
 if (pathname.startsWith('/')) { 
 return new Response('Not Found', { status: 404 }); 
 }
 return new Response('Hello World!'); 
 }
}
```

The error in my code was that I didn’t specify the correct exporting method for the function; it needed to be structured properly to work with Cloudflare Workers. My hope of a functional migration turned into a frustrating roadblock. 

## The Fix

After realizing my mistake, I fixed the exporting method in `handler.js`. Here's the corrected code:

```javascript
addEventListener('fetch', event => { 
 event.respondWith(handleRequest(event.request)); 
});

async function handleRequest(request) { 
 const url = new URL(request.url); 
 const pathname = url.pathname;
 if (pathname.startsWith('/')) {
 return new Response('Hello from Cloudflare Workers!', { status: 200 });
 }
 return new Response('Not Found', { status: 404 });
}
```

Here's what changed:
1. I used `addEventListener('fetch', ..)` to properly handle the request.
2. I wrapped my logic in a dedicated `handleRequest` function. This makes it easier to manage complex logic and keeps the fetch listener clean.
3. The response content now reflects who’s serving the page. It’s a small touch, but it feels more personal.

Each line matters here. The `addEventListener` is key to intercepting the HTTP requests coming in, and managing them properly is how we get around Cloudflare's edge features effectively.

## Why It Works

This approach works because it aligns with how Cloudflare Workers handle requests. They expect a structured way to process incoming requests, which means we need to adhere to their API guidelines. That also reflects a broader lesson in web development: understanding the underlying principles of platforms you work with saves a lot of headaches. Rather than just following tutorials, getting into the why behind the what's of your code can prevent errors down the line.

## What I'd Skip Next Time

1. **Local Testing:** Next time, I’d ensure I had a solid local testing setup for my Workers. Something like the Cloudflare Workers CLI (wrangler) can let you simulate the environment before deploying. 
2. **Better Logging:** Adding logging to track my requests and responses would help catch smaller mistakes before they became bigger problems.
3. **Thorough Documentation Review:** I ignored some parts of the documentation because I thought I knew better. Re-reading the relevant sections could’ve pointed me to solutions before I ran into trouble.

Every developer has those moments of clarity in hindsight. I often think, if only I spent an extra hour double-checking my work, I could’ve avoided the stress.

As for a solid closing thought: Was it worth rushing the migration only to hit a wall? On one hand, getting it done quickly can be a great rush. On the other, it’s important to ensure quality over speed. What do you think: Do you prioritize speed or quality in your own projects?