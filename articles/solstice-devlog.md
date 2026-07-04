*This is a submission for the [June Solstice Game Jam](https://dev.to/challenges/june-game-jam-2026-06-03)*

## The Game

**Solstice â€” Hold the Light**

You are the last spark before the longest night. Move with your cursor, collect golden orbs to keep your light from fading, and avoid the shadows drifting in from the dark.

The world dims as your light dims. When your light hits zero, darkness wins.

ðŸŽ® **Play it here:** [glatinone.github.io/solstice-game](https://glatinone.github.io/solstice-game/)

ðŸ“¦ **Source:** [github.com/glatinone/solstice-game](https://github.com/glatinone/solstice-game)

## How It Plays

- Move with mouse (desktop) or touch (mobile)
- Collect golden orbs to restore light
- Each orb is worth 1 point
- Avoid the drifting shadows; they drain your light on contact
- Your light decays continuously, faster as time goes on
- Game ends when light reaches zero
- Score = orbs collected before darkness

There is no win state. Only how long you can hold the light.

## The Solstice Theme

The brief was the June solstice: the longest day, the shortest night. I flipped it. What if you were on the other side of the year, watching the light slip away?

Three things carry the theme:

**Visual decay.** The background is a radial gradient centered on the player. At full light it is warm: amber, dusk, sunset reds. As light drains the colors shift cold and dark. Stars become more visible. The screen literally dims with you.

**Light as resource.** Light is not just visual. It is your health bar, your time, and your radius of awareness all at once. Lose light, lose the game.

**Shadows that grow with time.** Difficulty scales with how long you have survived. More shadows, faster shadows, fewer orbs. The longer you hold the light, the harder the dark pushes back.

## Tech Stack

- **HTML5 Canvas** for rendering
- **Vanilla JavaScript**, no frameworks, no build step
- **CSS** for the UI shell (start screen, HUD, game over)
- **localStorage** for high score
- **GitHub Pages** for hosting

The whole game is one HTML file. About 600 lines including the styles and script. No dependencies.

## Design Decisions

A few things I locked in early:

**No menus, no levels, no upgrades.** A jam game should be playable in 30 seconds. Press Begin, move mouse, see what happens.

**No instant fail.** Touching a shadow drains light, it doesn't kill you. This means a confident player can recover, but a careless one accumulates damage. Skill ceiling without frustration.

**Visuals over mechanics.** The core loop is simple: collect, dodge, survive. What carries the experience is the way the world looks at full light versus near-zero light. Particle trails, radial glows, the slow color shift. The game's mood is the gameplay.

**One screen, no scrolling.** Mobile and desktop play identically. No camera systems, no levels to load.

## What I Would Add With More Time

- Sound (a slow ambient drone that intensifies as light fades)
- A second orb type that gives bigger light boost but moves
- Boss shadow at extreme low light
- Daily seed leaderboard

These would all stack on top of the existing loop without changing it.

## Reflection

I have not built a game from scratch in years. Twenty-four hours from idea to playable submission, single file, no engine.

The hardest part was not the code. It was knowing when to stop. A jam game asks you to ship something fun, not something complete. Every extra feature is a tax on the player's first impression.

Solstice is a small game. That is the point.

---

*Built with HTML5 Canvas. Hosted on GitHub Pages. Survival time is yours to discover.*
