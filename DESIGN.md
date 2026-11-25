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

## Not yet

Window size is fixed at 780 by 600 for the proving kit. The v1 chat window (milestone 2) gets its own layout pass, with the checklist panel removed.
