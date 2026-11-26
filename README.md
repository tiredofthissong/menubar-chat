# Menu bar chat

A small Mac menu bar window for working with Claude Code without the Terminal. Every change asks you first, work projects can't push anywhere, and it runs on its own separately billed API key.

**Where it stands:** this is the **proving kit (M0)**. It's here to prove on a real Mac that the idea works before the full v1 is built. It is not the finished app.

## What's real and what isn't yet

| Part | State |
|---|---|
| Engine: one Claude Code session per project, through the official Claude Agent SDK | Real |
| Safety: Allow or Deny card for every change, push block on work projects, secret files refused, $5 daily cap, Sonnet | Real, tested |
| Key: read from your Mac's Keychain by Claude Code itself; never stored in a file | Real (needs step 7 below) |
| Menu bar: icon, hotkey Control-Option-Command-C, hover line, notifications, tuck-away | Real, needs your Mac to check |
| Projects | Only the two throwaway test projects that `npm run scratch` makes |
| Packaged app you double-click | Not yet (milestone 6) |

## First Mac test

The full steps, with the likely barriers, are in the v1 build plan doc. In short, in Terminal:

```sh
git clone https://github.com/tiredofthissong/menubar-chat.git ~/menubar-chat
cd ~/menubar-chat
npm install
npm run scratch
npm run block-pushes -- ~/menubar-scratch/work-demo
npm start
```

Before `npm start`, the API key goes into the Keychain (you paste it when asked; it isn't shown):

```sh
security add-generic-password -s claude-menubar-anthropic -a "$USER" -w
```

Then work through the nine checks on the right side of the window, press **Copy results**, and paste them into our chat.

**Each of these waits for your yes at the time:** installing Node (if you don't have it), creating the API key (it costs money), saving it in the Keychain, `npm install`, adding the push block, and allowing notifications.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Opens the app in the menu bar |
| `npm test` | Runs the checks (no key, no network, no cost) |
| `npm run scratch` | Makes `~/menubar-scratch` with two test projects and a local stand-in for GitHub |
| `npm run block-pushes -- <folder>` | Makes every `git push` from that repo fail. `--remove` takes it off again |

## How it stays safe

- **Ask me first, always.** The app always starts Claude Code in its "ask first" mode and checks that it really did. Only an exact click on **Allow once** approves anything; Stop, a timeout, closing the app, or typing a reply all count as no.
- **Three layers on work projects.** A hook that runs before anything else, deny rules, and the card itself. Untagged projects count as work.
- **Its own key, and it checks.** If Claude Code starts with any other login (like your subscription), the app stops before anything runs.
- **Nothing private in the window.** Keys and tokens are blanked out of everything shown, even when split across two pieces of text.

## Layout

```
app/       the menu bar shell and the window
engine/    sessions, status line, budget, plain-English explanations
policy/    the hard rules, the hook, approvals, modes
mock/      a stand-in for Claude Code used only by the tests
scripts/   scratch projects, push block, icon maker, a headless smoke check
test/      npm test
```

## Credits

- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (Anthropic) runs Claude Code.
- [menubar](https://github.com/max-mapper/menubar) (BSD-2-Clause) and [Electron](https://www.electronjs.org/) (MIT) make the menu bar window.
- The approval flow's shape (a waiting list raced against Stop) is from T3 Code (MIT), rewritten. The pop-up pattern (build once, show and hide) is from Maccy (MIT), as an idea only.
- Design tokens from Bromo's own design rules.
