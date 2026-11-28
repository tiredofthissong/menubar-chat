<!-- BEGIN claude-rules/AGENTS.md#saving (managed by claude-rules/scripts/install-mac.sh; edit the source, not this block) -->
## Saving: never overwrite, archive everything
Why: sessions saved old copies over newer work, and a HANDOFF entry vanished twice. Every save keeps what was there.
- Never overwrite blindly. Read a file right before changing it and save against the version you read: `if_version` in hub-mcp and in Claude's memory; in git, pull first and commit on top. If it changed since, read it again, merge both sets of changes, and save again.
- Never force-push, reset a shared branch, or rewrite history. If a save would drop someone else's change, stop and tell me.
- Prefer small edits and appends over rewriting a whole file.
- Archive, don't delete. Text taken out of a file moves to an archive file (like HANDOFF-archive.md) or stays in version history, and the change is logged. Git history and OneDrive version history are the archive; nothing is purged.
- Guards back this up: a git pre-push hook on every machine (claude-rules/scripts/git-hooks), Claude Code deny rules, and a history-guard Action in every repo that saves an archive branch if history is ever rewritten. Never bypass or switch them off (`--no-verify`, changing `core.hooksPath`); if one blocks you, stop and tell me. Every new project gets them: run `install-mac.sh --project <folder>`.


Full shared rules: claude-rules/AGENTS.md (private). Guards: scripts/git-hooks/pre-push and .github/workflows/history-guard.yml.

<!-- END claude-rules/AGENTS.md#saving -->
