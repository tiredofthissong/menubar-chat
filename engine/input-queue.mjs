// input-queue.mjs - an async iterable the SDK reads user messages from (streaming input).
// One long-lived query per project; each push() is one message from the chat box.
export function createInputQueue() {
  const items = []; const waiters = []; let ended = false;
  return {
    push(msg) { if (ended) return; const w = waiters.shift(); if (w) w({ value: msg, done: false }); else items.push(msg); },
    end() { ended = true; for (const w of waiters.splice(0)) w({ value: undefined, done: true }); },
    [Symbol.asyncIterator]() {
      return {
        next: () => (items.length ? Promise.resolve({ value: items.shift(), done: false })
          : ended ? Promise.resolve({ value: undefined, done: true })
            : new Promise((r) => waiters.push(r))),
        return: () => { ended = true; return Promise.resolve({ value: undefined, done: true }); },
      };
    },
  };
}
