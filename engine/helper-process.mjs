// helper-process.mjs - the entry point of the background process (Electron utilityProcess).
// The Claude Code sessions, the safety rules and the approval cards all live here, away from
// the window. Started by app/helper-link.mjs; talks only over Electron's built-in messaging.
import { query, listSessions, getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { serveHelper } from './serve.mjs';

const port = process.parentPort;
if (!port) {
  process.stderr.write('helper-process.mjs only runs inside the app (as an Electron utility process).\n');
  process.exit(1);
}
serveHelper(port, { sdk: { query, listSessions, getSessionMessages }, exit: () => setTimeout(() => process.exit(0), 200) });
