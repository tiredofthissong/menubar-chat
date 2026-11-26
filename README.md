# Menu bar chat

A small Mac menu bar window for working with Claude Code without the Terminal. Every change asks you first, work projects can't push anywhere, and it runs on its own separately billed API key.

**Where it stands:** milestones 1 to 5 of v1 are in. The engine runs in a background helper with change cards, Undo and two modes; the window is the v1 chat window with plain approval cards and next-step buttons; it behaves like a menu bar app (opens fast, tucks itself away); it knows your project folders, their past chats, Work or Personal, and what you've spent; and every card teaches one plain line with a checked link to learn more. It is not the packaged app yet.

## What's real and what isn't yet

| Part | State |
|---|---|
| Engine: one Claude Code session per project, through the official Claude Agent SDK, in a background helper the window talks to over Electron's own messaging (no network port) | Real, tested |
| Two modes: **Ask me first** (default) and **Plan first**. Click the mode button to switch | Real, tested |
| Change cards: every file change shows one plain sentence, Claude's reason, the change itself one click away, and an **Undo** button | Real, tested |
| One chat box, no Terminal: pasted Terminal lines become one command Claude runs after you allow it; `claude ...`, `!cmd` and mistyped /commands get a one-line fix | Real, tested |
| Delete cards are red and offer **Move to Trash instead** (the delete never runs; Claude asks again to move the files to your Trash) | Real, tested |
| Safety: Allow or Deny card for every change, push block on work projects, secret files refused, $5 daily cap, Sonnet | Real, tested |
| Key: read from your Mac's Keychain by Claude Code itself; never stored in a file | Real (needs step 7 below) |
| Next-step buttons: when Claude suggests what to do next, each suggestion is a button; tapping it sends it as your message, so anything it leads to still asks you first | Real, tested |
| Menu bar: opens under the icon with the cursor in the chat box; tucks away on Esc, a second click, clicking another app, the hotkey Control-Option-Command-C, or by itself about 5 seconds after a reply; animated icon (still with Reduce Motion); hover line; notifications with Review and Deny | Real, tested in the cloud, needs your Mac to check |
| Projects: click the project name for your folders (each tagged Work or Personal), its past chats to pick up, **New chat**, and **Add a folder…** (picked in the Mac's own folder window) | Real, tested |
| Work or Personal: untagged counts as Work. Work blocks GitHub, `gh` and your personal hub with no button to override; making a project Personal asks first. **Add push block** puts the pre-push hook in a work repo after you confirm | Real, tested with real git |
| Usage: click the spending figure for today against the $5 cap, this chat in dollars, and how much of Claude's memory the chat has used | Real, tested |
| Learning: every card has one plain line, plus **Learn more** (the Claude Academy lesson for this step) and **Docs** (code.claude.com, opened at the passage that fits, highlighted). A chat never offers the same lesson or passage twice. Checked links only. The Usage panel shows a learning log by Academy course | Real, tested |
| Starters: an empty chat offers three ways to start; one fills the chat box and sends nothing | Real, tested |
| Warm start: picking a project starts Claude Code early, so the first reply is quicker | Real, tested |
| **Wrap up this chat** (Projects panel): after you confirm, adds one dated note to the end of `HANDOFF.md` in the project folder and changes nothing else | Real, tested |
| New skills and /commands show up without restarting the app; the chat carries on | Real, tested |
| **Menu Bar Chat.app**: `npm run package` builds an app you open like any other, menu bar only, no Dock icon. Same projects, spend and learning log as `npm start` | Real, built and started in the cloud, needs your Mac to check |
| Right-click the menu bar icon: **Start at login** (off until you tick it; installed app only) and **Quit Menu Bar Chat** | Real, tested |

## Setting it up

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

Already set up? To get a new milestone: `git pull`, then `npm install`, then quit the app (right-click its menu bar icon, or Control-C in the Terminal that runs it) and run `npm start` again.

**The installed app (milestone 6).** `npm run package` builds `dist/Menu Bar Chat-darwin-arm64/Menu Bar Chat.app`. It needs Node 22.12 or newer. Drag it to Applications and open it from there. It's signed for this Mac only, not by a developer, so if macOS says it can't check it, open System Settings > Privacy & Security and choose Open Anyway. Quit any `npm start` copy first: only one runs at a time. After a `git pull`, run `npm run package` again and replace the copy in Applications.

**Keys in the window:** Enter sends, Shift-Enter starts a new line, Tab moves between controls, Esc closes an open panel, otherwise it tucks the window away.

**Each of these waits for your yes at the time:** installing Node (if you don't have it), creating the API key (it costs money), saving it in the Keychain, `npm install`, adding the push block, allowing notifications, copying the app to Applications and opening it, and ticking Start at login.

## Commands

| Command | What it does |
|---|---|
| `npm start` | Opens the app in the menu bar |
| `npm test` | Runs the checks (no key, no network, no cost). Every source file stays at 200 lines or fewer |
| `npm run scratch` | Makes `~/menubar-scratch` with two test projects and a local stand-in for GitHub |
| `npm run block-pushes -- <folder>` | Makes every `git push` from that repo fail. `--remove` takes it off again |
| `npm run package` | Builds **Menu Bar Chat.app** in `dist/`. It installs nothing and opens nothing |
| `npm run check-learn` | Opens each docs page a Docs button points at and checks the highlighted passage is still there (needs the internet) |

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
scripts/   scratch projects, push block, icon maker, a headless smoke check, the app builder
test/      npm test
```

## Credits

- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) (Anthropic) runs Claude Code.
- [menubar](https://github.com/max-mapper/menubar) (BSD-2-Clause) and [Electron](https://www.electronjs.org/) (MIT) make the menu bar window.
- The approval flow's shape (a waiting list raced against Stop) is from T3 Code (MIT), rewritten. The pop-up pattern (build once, show and hide) is from Maccy (MIT), as an idea only.
- Design tokens from Bromo's own design rules.
