# Design

**Job:** pop it open from the menu bar, see in one glance where this project stands and what waits on you, answer or ask, and tuck it away. Often after hours away, often mid-job, often in another project than last time.

**Feels like:** calm, glanceable, sure.

**Must not feel:** crowded, technical, nagging.

(Revamp of Nov 26, written as the daily user: Bromo switching between Work and Personal projects all day, answering cards, glancing at spend, reading the one-line tips.)

## Choices

- **Tokens:** `app/window/tokens.css`, copied from the personal design rules. Components use the semantic names only; no raw colors.
- **Accent:** one deep teal (hue 195), used for the primary action (Send) and focus rings. Nothing else is colored except state: red for blocked steps and anything that deletes, and amber when today's spend nears the cap. Color is never the only signal: a delete step also says DELETE, and a diff line starts with + or -.
- **Type:** the system font stack. 14px for the window (dense desktop UI), 12px for captions.
- **Radii:** md (10px) for cards, bubbles, the chat box and notices; sm (6px) for buttons, list rows, inputs and code; pill for tags.
- **Buttons:** three ranks, never colored by meaning: primary (Send only), default (a bordered button: the card answers), quiet (a lighter border, or none for links and the bar). Every button is at least 32px tall with a 40px target (an invisible margin), card answers and list rows are a full 40px, and labels sit centered on one line. Hover only where there is a pointer.
- **Light and dark:** both, following the Mac's setting. `npm test` checks every text and control pairing against WCAG 2.2 AA in both (4.5:1 text, 3:1 edges and focus) and that every color fits in sRGB.
- **Layout:** one column, 480px wide, top to bottom:
  1. **The bar, one line:** the project name (a quiet button with a caret), its tag as plain text, and today's spend on the right. Two controls in one style, nothing else.
  2. **The stage:** the conversation, the only part that scrolls. A panel lies over it as its own surface.
  3. **The card tray:** what waits on you, docked right above the chat box, **one card at a time**, with "1 of 3 waiting" above it when more wait. The next one shows when you answer. The tray scrolls only if a single card is taller than most of the window.
  4. **The notice:** one line just above the chat box, never over the conversation or a panel. A plain note ("Copied.") clears itself after a few seconds; a problem stays until you press **Close**.
  5. **The chat box:** the text box full width, then a row with the mode menu, a status line, Stop and Send.
- **Status line** (next to Send): "Waiting on you", "Claude is working…", and "Waiting in garden-app" when a card waits in another project. Coming back after hours, it says where things stand without opening anything.
- **Claude's replies** sit on the page, full width, without a bubble; what you typed is the one tinted bubble. Status lines in a row group tightly.
- **Motion:** only a small press on buttons, and only when Reduce Motion is off. The menu bar icon holds still with Reduce Motion on.

## The approval card

The most important screen in the app.

- **How it looks (Nov 26 revamp):** a plain surface with a thin border and no shadow (red border on a delete). The first line is the one bold thing, with the copy icon at its end; the kind of step is a small tag; "Why:" in normal text; the steps; the exact command folded; then the answers, 40px tall and equal width; then the learning tip as a muted footnote with **Learn more** and **Docs** as quiet links. One gap value inside the card, a wider one before the answers. No divider lines.

- **The same shape on every card** (Bromo, Nov 26), top to bottom:
  1. **"Claude wants to …"** in plain words: "change notes.txt", "open a web page on example.org", "run 3 commands, in this order". A tool's own name shows only when the app doesn't know the tool, and then it says so.
  2. **What kind of step**, from one fixed list: Only looks, Changes files, Runs a program, Uses the internet, Uses a connected app, Deletes files (red). Plus the file, folder, site or app, unless the first line already names it.
  3. **"Why:"** in Claude's own words. Claude is asked to write a "Why:" line before every step that may need permission, not only edits; failing that, the command's own description. With no reason the card says so: "Claude didn't say. If that matters, Deny and ask."
- **Calmer over time.** A kind of step's learning line shows once per chat. Later cards of that kind offer only a lesson or passage not yet shown, under "More on this kind of step:", or nothing at all.
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

- Tab reaches every control in order: project, spend, conversation, the buttons in the conversation, the card, the notice's Close, the chat box, mode, Stop, Send. Every control shows a focus ring.
- Enter sends, Shift-Enter starts a new line, Esc closes an open "Show ..." first and otherwise tucks the window away.

## The conversation

- The window grows to fit the conversation and cards, up to the bottom of the screen. Past that, the conversation scrolls and the chat box stays put.
- The scrollbar always shows (macOS hides its overlay scrollbars), so it's clear there's more above.
- New messages keep you at the newest one only while you're already there. Scroll up to read back and you stay put; a **Jump to latest** button appears instead. Sending a message brings you back to the bottom.
- If a trackpad or wheel turn doesn't move the conversation, the window moves it itself (backup in `scroll.js`).

## Changes and modes (milestone 1)

- **A change card per file change:** one plain sentence ("Changed 2 lines in notes.md. Why: fix the typo."), **Undo**, and **Show the change** for the diff. If Claude gave no reason, the conversation says so.
- **Undo** puts the file back as it was, or removes a file Claude created. If the file changed since, it says so and changes nothing.
- **The mode menu** sits by Send (it decides how the next message runs) and reads **Ask me first**, **Plan first** or **Dev mode**; anything but Ask me first shows darker. Plan first: Claude reads and plans, changes nothing, and asks before it starts; each change still gets its card.

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

## Projects, Work or Personal, and usage (milestone 4)

- **A panel, not a sidebar.** The plan said sidebar; at 480 pixels wide that leaves no room to chat. The project name in the top bar is a button that opens a panel under the bar instead: projects with their tag, the chats in this project (newest first, from Claude Code's own list) with **New chat**, then a Safety section. The spending figure opens a Usage panel the same way. Esc or a second click closes a panel and puts focus back on its button. A panel lies over the conversation (which keeps its place underneath) on its own surface with a shadow, and scrolls on its own; while it's open the card tray steps aside and the status line says what waits. Projects are grouped under **Personal** and **Work**, with "working" next to a busy one. The Usage panel leads with one big figure (today against the cap); the fine print folds under **How these numbers work**.
- **Picking up a past chat** redraws its turns (what you typed, what Claude wrote) and says "Picked up this chat"; anything you send carries on from there.
- **Adding a folder** opens the Mac's own folder window, so a path never comes from the page. Home, the top of the disk, system folders and key folders are refused. You then pick Work or Personal; the two answers look the same.
- **Tags take effect at once.** Changing a tag closes that project's open chat, so the next message runs under the new rules, and a card that was waiting is denied.
- **No override.** Work to Personal asks first in the panel; Personal to Work doesn't, since it only adds safety. There is no button that turns the push block or the Work rules off.
- **Push block** shows On, Off (with **Add push block**, which asks once more), or "has its own hook" (left alone). Only the app writes the hook; Claude never does.
- **Usage** uses two plain bars (today against the cap; memory used) in the text colour, not the accent, so Send stays the one accent.

## Learning layer and extras (milestone 5)

- **One plain line on every card** says what this kind of step is ("A delete is hard to take back…"), muted, as a footnote under the answers, so it never competes with Deny and Allow. **Learn more** opens the Claude Academy lesson that fits this step (not just the course). **Docs** opens the Claude Code docs at the section that fits, with the key passage highlighted (a text fragment, which Safari and Chrome both follow; a browser that doesn't still opens the right section).
- **Fits the step.** A chained command (`&&`, `;`, `|`) gets the passage on how each part is checked; a delete gets the one on why a Terminal delete has no Undo; and so on, for 11 kinds of card.
- **No repeats in a chat.** Each kind of card has its picks in order, most useful first. A lesson or passage this chat already offered, on any card, isn't offered again: the card moves to the next pick, and once a kind's picks are used up its card keeps the plain line and drops the links. A new chat, or a past chat picked up, starts fresh.
- **Checked links only.** Every link lives in `shared/learn.mjs`. Lessons come from the Academy's own catalog; `npm run check-learn` opens each docs page and checks that the section and the passage are really there (22 of 22 on Nov 26, 2026). The app opens a link only if it is exactly one of those. Anything else, however close, is refused.
- **Learning log.** Each card adds one line to `learning-log.jsonl` in the app's own folder: the time, the project, the topic and its Academy course. Never the command or a file name. The Usage panel shows the courses you've met, with counts; a click opens the course. The oldest lines go after 2,000.
- **Starters.** An empty chat offers three ways to start. A starter fills the chat box and puts the cursor there; nothing goes until you press Send.
- **Warm start.** Picking a project starts Claude Code in the background (only when the key is in place), so the first reply comes sooner. It costs nothing until you send.
- **Wrap up this chat** (Projects panel) asks first, then adds one dated note to the end of `HANDOFF.md` in the project folder: what you asked, what changed, cards allowed or not, what it cost and what Claude suggested next. Secrets are hidden. It only ever adds to the end, makes the file if needed, and leaves a `HANDOFF.md` that is a link or a folder alone.
- **New skills without a restart.** Before each message the app checks the skills and /commands folders (the project's and yours). If something was added or changed, it picks the same chat up in a fresh Claude Code, says so in one line, and the new skill works in the / picker.

## The installed app (milestone 6)

- **`npm run package`** builds `Menu Bar Chat.app` in `dist/` with Electron Packager. It only builds: copying it to Applications, opening it and Start at login are Bromo's own steps.
- **Named Menu Bar Chat**, never after Claude Code. Menu bar only (`LSUIElement`), no Dock icon.
- **No archive** (`asar` off), so the SDK runs Claude Code's own program straight from the app folder.
- **Signed ad hoc for this Mac only.** No developer certificate, so it isn't for sharing. If macOS says it can't check the app, System Settings > Privacy & Security > Open Anyway.
- **One data folder.** Run from the Terminal or installed, the app keeps projects, spend and the learning log in the same `menubar-chat` folder, and only one copy runs at a time.
- **Right-click menu on the icon:** Start at login (Bromo, Nov 26), off until he ticks it, built fresh on each click so the tick is always current, and greyed out under `npm start`, where it would add Electron itself; and Quit Menu Bar Chat.
- **PATH from the Finder.** An app opened from the Finder gets a short PATH, so the helper adds Homebrew, `/usr/local/bin` and `~/.local/bin` after the PATH it has. Claude's commands find `git`, `node` and `gh` the same as in the Terminal.
- Tests and developer scripts stay out of the app.

## Fixes from the first real build (Nov 26)

- **Claude's questions are a card you tap.** When Claude asks a multiple-choice question, the card shows one button per answer, with Claude's note under each. One question with one pick sends on the tap; more questions, or "pick any", send with **Send answers**, which stays greyed out until each question has a pick. Typing in the chat box answers it in your own words, and **Skip** says no. Nothing is picked for you. The old card had only Allow, which let the question run with no answer, so Claude said it "didn't come through".
- **The meter no longer drops spend after a restart.** Claude Code reports a running cost from $0 for each run of its program, so the app now keeps one total per run and adds them up. Before, a New chat, a past chat or a skill reload in a project dropped what that project had already spent today. A skill reload also keeps the chat's own cost.
- **Permission cards in one shape.** See The approval card above.
- **Long step lists fold up.** Over three steps, the list sits behind **Show all N steps**, so the card stays short. Every step is still named, one click away. A list with a delete in it never folds.
- **Copy.** A small copy icon at the end of each card's first line copies the whole card as text; one under each reply copies it as Claude wrote it. Card text can be selected too.
- **Dev mode** (Bromo: "the allow prompts are too many"). A third mode in the mode menu. Claude Code runs in its normal asking mode; the app answers its asks without a card only for steps that stay in the project folder: reading, changing or creating files there (not in `.git`), and commands whose every path is in the folder. It still asks for anything outside the folder or in home or system folders, deletes, the internet (installs, downloads, push and pull), connected apps, helpers, `sudo` and system tools, and git steps that throw work away. A link that leads out of the folder counts as outside. The hard rules run first and are never loosened, change cards and Undo still come, and the chat lists every step. Turning it on says all this in the chat.
- **Claude knows who it's working for.** The app tells Claude that you use this chat instead of a terminal or editor: it never asks you to edit a file or run a command yourself, it offers to do it. Before it calls work done or suggests a demo, it runs the project's tests and checks and says what is still untested. (Bromo, after Claude told him to edit plants.json in a code editor.)
- **How accurate it is.** The figures update when each reply finishes, from Claude Code's own estimate at list prices. The Anthropic Console has the exact bill; the panel says so.

## Known gaps

- Undo copies are kept in memory, so they're gone once the app quits.
- Changes to files outside the project folder have no Undo.
- Warm start keeps one Claude Code running for each project you've opened, until the app quits.
- The installed app has Electron's icon in the Finder and Applications (the menu bar icon is the app's own).
- A Node or tool installed somewhere other than Homebrew, `/usr/local/bin` or `~/.local/bin` (nvm, for one) isn't on the installed app's PATH.
- The installed app doesn't update itself: after a `git pull`, run `npm run package` again.

## Not yet

- A week of Bromo's real use, the fixes it turns up, then v1 is tagged (milestone 6).
