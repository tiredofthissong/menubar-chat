# Design

**Job:** a calm chat window that drops down from the menu bar, does one small thing in a project, and gets out of the way.

**Three words:** calm, plain, trustworthy.

## Choices

- **Tokens:** `app/window/tokens.css`, copied from the personal design rules. Components use the semantic names only; no raw colors.
- **Accent:** one deep teal (hue 195), used for the primary action (Send) and focus rings. Nothing else is colored except state: red for blocked steps and anything that deletes, and amber when today's spend nears the cap. Color is never the only signal: a delete step also says DELETE, and a diff line starts with + or -.
- **Type:** the system font stack. 14px for the window (dense desktop UI), 12px for captions.
- **Radii:** md (10px) for buttons, cards and bubbles; sm (6px) for small buttons, inputs and code; pill for tags.
- **Light and dark:** both, following the Mac's setting. `npm test` checks every text and control pairing against WCAG 2.2 AA in both (4.5:1 text, 3:1 edges and focus) and that every color fits in sRGB.
- **Layout:** one column, 480px wide. Bar (project, work or personal, mode, today's spend), the conversation, cards waiting on you, then the chat box.
- **Motion:** only a small press on buttons, and only when Reduce Motion is off. The menu bar icon holds still with Reduce Motion on.

## The approval card

The most important screen in the app.

- One plain sentence first ("Run 3 steps: download the latest changes; make a folder; copy files.").
- A chained command lists **every** step, numbered, so nothing hides behind the first one. A delete step is red.
- The exact command is one click away, under **Show the exact command**, with a **Copy** button.
- **Deny** and **Allow once** look the same and neither is selected, so a stray Enter can't approve. Deny comes first.
- **A delete** turns the card red, adds "This deletes files", and offers three answers that look the same: **Deny**, **Move to Trash instead**, **Delete for good**. Move to Trash is a no to the delete; Claude is told to move the same files to the Trash with `mv -n` (never overwrites), which comes back as its own card.
- There's no "always allow".

## The chat box

- One box, no shell box. Type in your own words.
- Pasted Terminal lines (like `git pull` then `npm install`) become one command that Claude runs after you allow it, so the card names every step.
- `claude ...`, `!cmd` and `$ cmd` work too; the window trims the extra and says so in one line.
- A mistyped /command gets "Did you mean /design-rules?" with a **Use /design-rules** button. Terminal-only commands (like /theme) say so. /clear starts a fresh chat; /cost, /model and /permissions point to the part of this window that does it.

## Keyboard

- Tab reaches every control in order: project, mode, conversation, the buttons in the conversation, the card, then the chat box. Every control shows a focus ring.
- Enter sends, Shift-Enter starts a new line, Esc closes an open "Show ..." first and otherwise tucks the window away.

## The conversation

- The window grows to fit the conversation and cards, up to the bottom of the screen. Past that, the conversation scrolls and the chat box stays put.
- The scrollbar always shows (macOS hides its overlay scrollbars), so it's clear there's more above.
- New messages keep you at the newest one only while you're already there. Scroll up to read back and you stay put; a **Jump to latest** button appears instead. Sending a message brings you back to the bottom.
- If a trackpad or wheel turn doesn't move the conversation, the window moves it itself (backup in `scroll.js`).

## Changes and modes (milestone 1)

- **A change card per file change:** one plain sentence ("Changed 2 lines in notes.md. Why: fix the typo."), **Undo**, and **Show the change** for the diff. If Claude gave no reason, the conversation says so.
- **Undo** puts the file back as it was, or removes a file Claude created. If the file changed since, it says so and changes nothing.
- **The mode button** in the top bar reads **Ask me first** or **Plan first**. Plan first: Claude reads and plans, changes nothing, and asks before it starts; each change still gets its card.

## Menu bar feel (milestone 3)

- **Opening:** the window is built once at start and kept hidden, so it opens under the icon at once, with the cursor in the chat box.
- **Tucking away:** Esc, a second click on the icon, clicking another app and the hotkey (Control-Option-Command-C) always tuck it away. After a reply it tucks itself away about 5 seconds later, but never while you type, while a card waits on you or while Claude is still working. While the pointer is over the window it waits, and counts again once the pointer leaves. Opening the window never inherits an old reply's countdown. The rules live in `app/tuck.mjs`.
- **Icon:** still when ready, moving while Claude thinks or works, a slow blink while a card waits on you, an alert mark when something needs a look. With Reduce Motion on it shows the first frame only, and it follows the setting as soon as you change it.
- **Hover line:** under 100 characters, most urgent project first, with "(+1 more)" when another project is busy. "Waiting on you" stays while a card is open; no other update can replace it. Keys and tokens are blanked out before it's shown.
- **Notifications:** only when a card waits and the window is tucked away. They offer **Review** (opens the window) and **Deny**, never Allow, because Allow needs the card. The notification closes once you answer the card.

## Next-step buttons

- Claude is asked to end a reply with up to three "Next:" lines when a next step would clearly help, and never to suggest deleting files or spending money.
- Those lines come out of the reply and show under it as quiet buttons (the same look as other buttons in the conversation; Send stays the one accent). A button sends its words as your message, exactly as if you'd typed them, so anything it leads to still gets its card.
- Once you send anything, the older buttons switch off. Long suggestions wrap onto a second line.

## Known gaps

- Undo copies are kept in memory, so they're gone once the app quits.
- Changes to files outside the project folder have no Undo.

## Not yet

- **Start at Mac login** (Bromo, Nov 26): the packaged app (milestone 6) adds itself as a login item with Electron's `app.setLoginItemSettings({ openAtLogin: true })`, behind a "Start at login" switch that's off until Bromo turns it on. Turning it on is a Mac setting he approves at that step.
