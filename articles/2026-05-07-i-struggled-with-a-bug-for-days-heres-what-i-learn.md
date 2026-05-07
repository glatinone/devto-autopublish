---
title: "I Struggled with a Bug for Days — Here's What I Learned About Clean Code and Debugging"
published: false
tags: webdev, javascript, devops, github
description: "A frustrating bug led to a bigger understanding of code quality. Here's my real journey."
# devto_id: (filled after first publish)
---

As I sat in front of my computer screen one humid evening in Batam, covered with the shadows of unfinished projects, I felt a sinking frustration deep in my chest. For days, I was plagued by a bug in a JavaScript function that seemed to mock me, with every test yielding inconsistent results. I was convinced I had a handle on clean code principles, but the hours spent chasing this elusive problem made me question everything I knew.

### Context & Stakes

debugging effectively is essential for any developer, especially when working in tight deadlines or collaborative environments. I was leading a small team on a client project, a dynamic web application intended to streamline local business operations. Our success depended on delivering clean, efficient code, and I was the one responsible for reviewing and finalizing it. The stakes were high, and with each failed attempt to fix the issue, our timeline slipped further.

The bug originated in a function designed to fetch user data from an API, but the data only loaded half the time. After scanning and re-scanning the code, everything seemed fine — I had followed all the recommended practices. Yet, the problem persisted. This relentless loop of testing and frustration forced me to confront my limitations head-on. Would I be able to solve this before our deadline? 

### CHALLENGE

What I had overlooked was a crucial aspect of my code's asynchronous nature. Here’s the snippet that tripped me up:

```javascript
async function fetchUserData(userId) {
  const response = await fetch(`https://api.example.com/users/${userId}`);
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  const data = await response.json();
  return data;
}
```

At first glance, this code looked correct, but the challenge was in the way it interacted with the rest of the application. I was using this function in multiple places within the codebase, but because the API could occasionally be slow, I hadn’t handled the failures correctly in the components calling it. This led to intermittent fraying of user experience, with components loading only half the time or throwing unhandled errors.

I felt the weight of inefficiency weighing down my team. The pressure to deliver without compromising quality left me juggling multiple hats, and I realized that my understanding of clean, maintainable code had been superficial. I needed to dig deeper into both debugging techniques and code readability practices to navigate this complexity.

### BREAKTHROUGH

The breakthrough came when I decided to systematically approach the problem. Instead of diving straight into fixing it, I first resurfaced and rewrote the function to make it clearer and more manageable:

```javascript
async function fetchUserData(userId) {
  try {
    const response = await fetch(`https://api.example.com/users/${userId}`);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return await response.json();
  } catch (error) {
    console.error('Fetching user data failed: ', error);  // Logging error with context
    return null;  // Handle this gracefully on the calling side
  }
}
```

By adding error handling and a `try/catch` block, I octupled my chances of catching errors early. However, the biggest revelation was shifting my mindset from fixing bugs to devising solutions that make the code robust against future issues. I took the time to document the expected outcomes in the comments as a reminder to myself and my teammates. This transparency in the code not only made it easier for us to follow, but it also set the stage for better collaboration.

### DEEPER INSIGHT

Through this experience, I gleaned a larger principle: clean code is not just about aesthetics or following patterns; it is about making it maintainable and resilient. As developers, we must anticipate how our code may misbehave under unexpected conditions. The cleaner and more explicit we write our code, the easier it becomes for us and others to debug it — saving precious development time in the long run.

Additionally, the experience reinforced the idea that debugging is as much about mindset as it is about skill. It’s easy to get lost in the weeds of our code; stepping back to reassess the problem can sometimes bring clarity, especially with peer programming, where you can have a fresh set of eyes or someone to help brainstorm.

### WHAT I'D DO DIFFERENTLY

Upon reflection, here are a few actionable steps I’d take to improve my approach to debugging and code quality moving forward:

1. **Prioritize Error Handling**: Always include explicit error handling strategies within asynchronous functions. Errors are inevitable; planning for them pays off.
2. **Encourage Team Code Reviews**: Foster a culture of peer reviews within your team. Fresh perspectives often unearth issues that one might overlook.
3. **Document Potential Errors**: Add comments to clarify how functions behave in edge cases. Documentation can be a lifesaver.
4. **Test-Driven Development (TDD)**: Implement TDD practices for new features to catch bugs early in the development cycle, enhancing code reliability. 
5. **Set Up Monitoring**: Utilize tools like Sentry to catch runtime errors and log issues transparently into the application, so you can react in real-time.

By taking these steps, I believe we can significantly minimize bugs and build a more resilient infrastructure for our applications. 

### CLOSING QUESTION

What debugging techniques or coding practices have you found essential in your own projects? How have you dealt with seemingly insurmountable bugs? Let's discuss in the comments!