A new hire at most companies waits days for access. Laptop, then email, then the one repo they need, and every extra permission goes through a ticket someone grumbles about.

An AI agent gets onboarded in about a minute. Full shell. Your personal API keys, because they were already in the environment. Unrestricted network. Read access to your entire home directory, including the `.ssh` folder nobody thinks about. We spent twenty years internalizing least privilege for people and service accounts, then handed an agent more access than we would give a contractor, on day one, without an interview.

I work in security, and this is the gap I now see everywhere. Here is how I think about closing it, in six rules you can apply this week.

## Why agents break the usual model

Classic access control assumes the account holder decides what the account does. Your intern might make mistakes, but the instructions come from their brain.

An agent takes instructions from text. All text. The prompt you typed, but also the web page it fetched, the README in the repo it cloned, the issue comment it read, the description of a tool it loaded. Prompt injection means every input channel is a potential command channel, and model vendors are getting better at resisting it, but I would not bet my SSH keys on any model saying no every time.

So an agent is a confused deputy by design. You do not fix that with a smarter prompt. You contain it with permissions, which makes least privilege the actual security boundary here, not a compliance checkbox you tick after the fact.

## Rule 1: scope by task, not by agent

Wildcard grants exist because narrow ones are annoying. `Bash(*)` never interrupts you. It also means an injected instruction can run anything your shell can.

Grant the commands the task needs and nothing else. `Bash(git *)` for a repo task. `Bash(npm run test)` for CI work. When a legitimate task fails on a missing permission, expand the list by one line. That friction earns its keep. It is the same friction that made you think twice before giving the intern prod access, and it works for the same reason.

## Rule 2: the agent gets its own identity

Never hand an agent your personal token. Give it a dedicated service identity with the minimum scopes for the job, and make the credentials short-lived.

Two reasons. First, blast radius: when a key leaks through an injected exfiltration attempt, you rotate one narrow key instead of your whole digital life. Second, audit: with a separate identity you can actually tell which actions were the agent and which were you, which matters enormously on the day something goes wrong.

## Rule 3: jail the filesystem

Give the agent one workspace directory it can write to. Mount reference material read-only. Everything else, including dotfiles, browser profiles, and password stores, should simply not resolve.

The one people forget is the environment. If secrets live in environment variables the agent's shell inherits, then every `env` dump is exfiltration-ready, and "print your environment for debugging" is one of the oldest injection payloads there is. Secrets belong in a manager or a broker that hands them to specific processes, not in a namespace the agent can enumerate.

## Rule 4: allowlist the network

An agent that can read a secret but cannot reach the outside world has very little to offer an attacker. Most injection payloads need a way out. Deny the way out.

Egress allowlists are the cheapest high-value control on this list: enumerate the domains the agent genuinely needs, deny everything else by default, and log the denials. The deny log doubles as a free detection feed, because an agent suddenly trying to reach a domain you never approved is exactly the signal you want to see early.

## Rule 5: gate the irreversible

Require human confirmation for actions you cannot take back: sending messages, publishing content, deleting data, spending money, granting access.

And be honest about the tradeoff, because security has learned this lesson the hard way with alert fatigue. If you gate everything, you train yourself to click approve without reading, and then the gate protects nothing. Automate the reversible, confirm the irreversible, and keep the second list short enough that you still read each prompt.

## Rule 6: audit, then trim

Log the tool calls. After two weeks, read the log and revoke everything the agent never used.

Privilege creep hits agents faster than humans because granting is one click and nothing nags you to undo it. A monthly review is enough. The question is always the same one you would ask about a service account: what did this identity actually do, and why can it do more than that?

## A starter policy

If you want something to copy today, this is the shape of mine:

```plaintext
1. Permissions  explicit allowlist, no wildcards
2. Identity     dedicated keys, minimal scopes, short-lived
3. Filesystem   one writable workspace, read-only elsewhere,
                no dotfiles, no browser profiles
4. Network      egress allowlist, deny by default, log denials
5. Confirmation required for send / publish / delete / pay / grant
6. Secrets      in a manager, never in env or readable files
7. Review       monthly, remove anything unused
```

## The mindset

Treat the agent like a brilliant new hire with no context and infinite confidence, working in a building where strangers can slip notes into their inbox. You would not give that person root either.

Assume the agent will be successfully injected at some point, because on a long enough timeline it will be. The goal of least privilege was never to prevent every incident. It never managed that for humans either. What it did was make incidents survivable, and that is exactly the job it has here: when the bad day comes, you want it to be annoying, not existential.