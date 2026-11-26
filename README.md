# Menu bar chat

A small Mac menu bar window for working with Claude Code without the Terminal. Every change asks you first, work projects can't push anywhere, and it runs on its own separately billed API key.

**Where it stands:** milestone 1 of v1 is in. The proving kit (M0) passed its Mac test, and the engine now runs the way v1 will: in a background helper, with change cards, Undo and two modes. The window is still the proving-kit window until milestone 2 rebuilds it. It is not the finished app.

## What's real and what isn't yet

| Part | State |
|---|---|
| Engine: one Claude Code session per project, through the official Claude Agent SDK, in a background helper the window talks to over Electron's own messaging (no network port) | Real, tested |
| Two modes: **Ask me first** (default) and **Plan first**. Click the mode button to switch | Real, tested |
| Change cards: every file change shows one plain sentence, Claude's reason, and an **Undo** button | Real, tested |
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
| `npm test` | Runs the checks (no key, no network, no cost). Every source file stays at 200 lines or fewer |
| `npm run scratch` | Makes `~/menubar-scratch` with two test projects and a local stand-in for GitHub |
| `npm run block-pushes -- <folder>` | Makes every `git push` from that repo fail. `--remove` takes it off again |

## How it stays safe

- **Ask me first, always.** The app always starts Claude Code in its "ask first" mode and checks that it really did. Only an exact click on **Allow once** approves anything; Stop, a timeout, closing the app, or typing a reply all count as no.
- **Three layers on work projects.** A hook that runs before anything else, deny rules, and the card itself. Untagged projects count as work.
- **Its own key, and it checks.** If Claude Code starts with any other login (like your subscription), the app stops before anything runs.
- **Nothing private in the window.** Everything the helper sends goes out one door, which blanks keys and tokens, even when split across two pieces of text. The log never holds what you typed or file text, only its length.
- **Checked twice.** Every command from the window is checked by the app and again by the helper. Anything unexpected is refused, never guessed at.
- **Undo never writes over newer work.** If a file changed after Claude's edit, Undo says so and leaves it alone. Files outside the project folder get no Undo.
- **Only two modes.** "Accept edits", "auto" and "bypass" are left out on purpose: they let changes through without a card.

## Layout

```
app/       the menu bar shell, the window, and the link to the background helper
engine/    the background helper: sessions, the one SDK reader (translate), one exit (publish)
policy/    the hard rules, the hook, approvals, the two modes
changes/   change cards and Undo
usage/     the daily cap and this chat's cost and context meter
status/    the hover line
sidebar/   the history list (shown from milestone 4)
shared/    the window-helper contract, secret hiding, the log, plain-English explanations
mock/      a stand-in for Claude Code used only by the tests
scripts/   scratch projects, push block, icon maker, a headless smoke check
test/      npm test
```

## Credits

- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (Anthropic) runs Claude Code.
- [menubar](https://github.com/max-mapper/menubar) (BSD-2-Clause) and [Electron](https://www.electronjs.org/) (MIT) make the menu bar window.
- The approval flow's shape (a waiting list raced against Stop) is from T3 Code (MIT), rewritten. The pop-up pattern (build once, show and hide) is from Maccy (MIT), as an idea only.
- Design tokens from Bromo's own design rules.
