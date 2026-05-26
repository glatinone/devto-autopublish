---
title: "I Built a Kubernetes Alternative. It Changed My Perspective on Complexity."
published: false
tags: devops, webdev, javascript, github
description: "Building a Kubernetes alternative revealed the hidden complexities I’d previously overlooked."
# devto_id: (filled after first publish)
---

After three long nights of coding, I stood on the edge of quitting. The most recent error? 'Connection refused: too many retries.' How does one recover from such a humiliating message? I guess you just pick yourself up and try again.

## 
## ACT 1: The Confidence Built on Ignorance

At first, I was cocky about my ability to develop a simpler alternative to Kubernetes. After all, I was drawing from over five years of experience building and managing containerized applications. Besides, I had graduated from a reputable programming boot camp, which ended up leading me to some great opportunities. I figured if I could wrangle Kubernetes, I could surely create something less complex and more approachable.

When I began this project, I believed the only thing standing in my way was time. I had convinced myself that my technical skills were enough; all I had to do was write the code, and it would come together. I thought eliminating a few features and minimizing configurations would be all it took to create something user-friendly. I pictured it, lightweight, no more than 300 lines of code for my entire tool. Simple, right? 

## ACT 2: The Moment It Broke

That illusion shattered when I hit my first major roadblock. After several days of coding with barely any sleep, I tried to deploy my work for the first time. I was so giddy with excitement; it was like I was seeing the light at the end of a tunnel. For about two seconds, it felt like everything was going great. And then came the error message:

```
Error: invalid configuration: failed to find a ready to use service
```

I thought, “How could this happen?” My tool was designed to simplify the deployment process, not make it more convoluted. After sweating over the terminal for hours, I tried everything. I rechecked the API calls, re-evaluated services, and even consulted the Kubernetes official documentation (which, let's be honest, is just a fancy way of saying I ended up down a rabbit hole of YAML files).

At that moment, it hit me: I hadn’t just omitted complexity; I had disregarded the very principles that make Kubernetes powerful, its ability to manage the scalability and orchestration of applications in distributed environments. I realized simplicity doesn't always mean fewer lines of code. Sometimes, it means better abstractions that serve higher purposes. 

## The Turning Point: What I Discovered

I decided to roll my sleeves up, go back to the drawing board, and analyze what I was actually trying to achieve. Instead of just cutting features, I began to rethink some of them entirely. I analyzed critical aspects like service discovery and load balancing and realized that perhaps they weren’t