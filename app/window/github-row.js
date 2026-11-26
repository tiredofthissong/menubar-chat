// github-row.js - the Add from GitHub row in the Projects panel. Plain script.
// A drop-down lists your GitHub repos, private ones too, newest-changed first, so a repo you just
// made in the Claude app is at the top. Refresh asks GitHub again. Repos already in your list are
// shown but can't be picked twice. A repo that isn't listed can still be typed or pasted.
// The list comes from the app (app/github-list.mjs); the window never sees a GitHub sign-in.
'use strict';
window.ChatGithubRow = (() => {
  const { el, button } = window.ChatDom;

  /** Fills the drop-down from GitHub. Leaves a plain note in place when the list can't load. */
  async function load(ctx, pick, note) {
    pick.replaceChildren(new Option('Loading your repos…', '')); pick.disabled = true; note.textContent = '';
    const r = await ctx.api.listGithub();
    pick.replaceChildren();
    if (!r?.ok) {
      pick.append(new Option('Your repos didn\'t load', '')); note.textContent = r?.error || 'Your repos didn\'t load. Type the repo below.'; return;
    }
    const have = new Set(ctx.projects().map((p) => String(p.repo || '').toLowerCase()).filter(Boolean));
    pick.append(new Option(r.repos.length ? `Pick a repo (${r.repos.length} found)` : 'No repos found', ''));
    for (const repo of r.repos) {
      const added = have.has(repo.full.toLowerCase());
      const o = new Option(`${repo.full}${repo.private ? ' · private' : ''}${added ? ' · in your list' : ''}`, repo.full);
      o.disabled = added; pick.append(o);
    }
    pick.disabled = !r.repos.length;
  }

  /** Opens the row under `where`. onAdded(result) runs after a repo is copied and added. */
  function open(where, ctx, say, onAdded) {
    where.querySelector('.github-add')?.remove();
    const form = el('form', 'confirm github-add'); form.setAttribute('aria-label', 'Add a repo from GitHub');
    const pick = el('select', 'github-input'); pick.setAttribute('aria-label', 'Your GitHub repos');
    const note = el('p', 'panel-note'); note.setAttribute('role', 'status');
    const refresh = button('Refresh', 'btn btn-small btn-quiet', () => load(ctx, pick, note));
    const input = el('input', 'github-input'); input.type = 'text'; input.placeholder = 'owner/repo or a GitHub link';
    input.setAttribute('aria-label', 'Or type a GitHub repo'); input.spellcheck = false;
    pick.addEventListener('change', () => { if (pick.value) input.value = ''; });
    const go = button('Copy and add', 'btn btn-small', () => {}); go.type = 'submit';
    const actions = el('div', 'confirm-actions'); actions.append(button('Cancel', 'btn btn-small', () => form.remove()), go);
    form.append(el('p', '', 'Pick one of your repos. It goes in ~/GitHub on this Mac, tagged Personal.'), pick, refresh, note,
      el('p', 'panel-note', 'Not in the list? Type owner/repo or paste its link.'), input, actions);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const repo = input.value.trim() || pick.value; if (!repo) return;
      go.disabled = true; go.textContent = 'Copying…';
      const r = say(await ctx.api.addGithub(repo));
      if (r?.ok) onAdded(r); else { go.disabled = false; go.textContent = 'Copy and add'; }
    });
    where.append(form); pick.focus();
    load(ctx, pick, note);
  }
  return { open };
})();
