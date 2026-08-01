# claude-pet

A desktop pet that shows what your coding agent is doing **right now**.

It sits in the corner of your screen, reads the session files Claude Code and
Codex already write, and shows the tool being used, the thing it was asked for,
and what the agent just said. When the agent finishes and it's your turn, a red
badge appears.

No hooks to install, no server to run, no configuration. If nothing is running,
nothing shows up.

```bash
npx claude-pet
```

---

## What it reads

Everything on screen comes from files that already exist on your machine:

| Shown | Read from |
|---|---|
| What it's doing now | the last event in the newest session transcript |
| The message | the agent's own text, or your last prompt |
| Skills · plugins · MCP · rules | the capability blocks in the session, and `~/.claude/plugins/installed_plugins.json` |
| Level | tokens spent, counted incrementally as the transcript grows |
| Waiting for you | the agent stopped **after answering** — not after a tool call |

Nothing is invented. If a plugin isn't installed, there's no hat. If no skill is
installed, there's no weapon. An agent that is still working does not get the
"your turn" badge, because it is not your turn.

## Equipment

Gear is worn because it is **installed**, and it lights up when it is **used**.

- **Hat** — a plugin is installed. Five to choose from.
- **Weapon** — a skill is installed. Six to choose from, each with its own swing.
- **Toolbox pet** — an MCP server is connected. One pet stands for all of them.

Click the character to pin the panel open, then pick your hat and weapon. The
choice is remembered.

## Level

Levels come from tokens, not from quality. We can count how much an agent spent;
we cannot count how well it did, and a number that pretends otherwise is worse
than no number.

The curve is geometric: level 1 at 1,000 tokens, level 100 at 1 trillion, with
each level costing about 23% more than the last. Early levels arrive quickly and
later ones do not — which is the point.

| Level | Tokens |
|---|---|
| 1 | 1,000 |
| 23 | 100,000 |
| 44 | 9,400,000 |
| 60 | 240,000,000 |
| 100 | 1,000,000,000,000 |

The running total is kept per file in `~/.kibitz-pet/progress.json`, so restarting
doesn't recount and doesn't double count.

## Controls

| | |
|---|---|
| Click | pin the panel open |
| Hover | peek at the panel |
| Drag | move the pet |
| Open this session | jump back to that conversation (⌥ for a dashboard) |
| × | hide this pet until the next session |

## Assets

The pixel items are generated, not hand-drawn, so the palette and grid stay
consistent:

```bash
npm run assets
```

Each item is one 24×24 character grid in `make-items.mjs`. Editing a hat means
editing a picture you can see, which is the only way pixel art actually gets
fixed.

## Where this came from

Split out of [kibitz](https://github.com/HarryKane11/kibitz), which traces what
coding agents did after the fact. This is the other half: what one is doing while
it's doing it. The idea of a desktop pet reading Claude Code state comes from
[nunchi](https://github.com/ysksean/nunchi).

## License

Apache-2.0
