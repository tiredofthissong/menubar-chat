# Design

**Job:** a calm chat window that drops down from the menu bar, does one small thing in a project, and gets out of the way.

**Three words:** calm, plain, trustworthy.

## Choices

- **Tokens:** `app/window/tokens.css`, copied from the personal design rules. Components use the semantic names only; no raw colors.
- **Accent:** one deep teal (hue 195), used for the primary action (Send), focus rings and the app's own measurements in the checklist. Nothing else is colored except state: green for a "Why:" line and Pass, red for blocked steps, Fail and anything that deletes.
- **Type:** the system font stack. 14px for the window (dense desktop UI), 12px for captions.
- **Radii:** md (10px) for buttons, cards and bubbles; sm (6px) for small buttons, inputs and code; pill for tags.
- **Light and dark:** both, following the Mac's setting.
- **Motion:** only a small press on buttons, and only when Reduce Motion is off. The menu bar icon holds still with Reduce Motion on.

## The approval card

The most important screen in the app.

- One plain sentence first ("Run 3 steps: download the latest changes; make a folder; copy files.").
- A chained command lists **every** step, numbered, so nothing hides behind the first one. A delete step is red.
- The exact command is one click away, under **Exact command**.
- **Deny** and **Allow once** look the same and neither is selected, so a stray Enter can't approve. Deny comes first.
- There's no "always allow".

## The conversation

- The window grows to fit the conversation and cards, up to the bottom of the screen. Past that, the conversation scrolls and the chat box stays put.
- The scrollbar always shows (macOS hides its overlay scrollbars), so it's clear there's more above.
- New messages keep you at the newest one only while you're already there. Scroll up to read back and you stay put; a **Jump to latest** button appears instead. Sending a message brings you back to the bottom.
- If a trackpad or wheel turn doesn't move the conversation, the window moves it itself (backup in `scroll.js`).

## Changes and modes (milestone 1)

- **A change card per file change:** one plain sentence ("Changed 2 lines in notes.md. Why: fix the typo."), then the diff, then **Undo**. If Claude gave no reason, the card says so.
- **Undo** puts the file back as it was, or removes a file Claude created. If the file changed since, it says so and changes nothing.
- **The mode button** in the top bar reads **Ask me first** or **Plan first**. Plan first: Claude reads and plans, changes nothing, and asks before it starts; each change still gets its card.

## Known gaps

- Undo copies are kept in memory, so they're gone once the app quits.
- Changes to files outside the project folder have no Undo.

## Not yet

- The v1 chat window (milestone 2) gets its own layout pass, with the checklist panel removed.
- **Start at Mac login** (Bromo, Nov 26): the packaged app (milestone 6) adds itself as a login item with Electron's `app.setLoginItemSettings({ openAtLogin: true })`, behind a "Start at login" switch that's off until Bromo turns it on. Turning it on is a Mac setting he approves at that step.
