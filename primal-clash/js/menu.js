/* ============================================
   Primal Clash — screens & main menu
   Simple screen manager: main menu, deck
   builder, settings, and the game itself.
   ============================================ */
"use strict";

const SCREEN_IDS = ['main-menu', 'deck-builder', 'settings-screen', 'online-screen', 'app'];

function showScreen(id) {
  for (const s of SCREEN_IDS) {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('screen-hidden', s !== id);
  }
  if (id === 'main-menu') updateMenuInfo();
  if (id === 'deck-builder') DB.open();
  if (id === 'online-screen') NET.openLobby();
  if (id === 'settings-screen') {
    const snd = document.getElementById('setting-sound');
    if (snd) snd.checked = !SFX.isMuted();
    refreshSaveInfo();
  }
}

/* ---------- save data UI (Settings screen) ---------- */
function refreshSaveInfo() {
  const el = document.getElementById('save-stats');
  if (!el) return;
  const d = SAVE.get();
  el.textContent = `Battles: ${d.stats.games} · Wins: ${d.stats.wins} · Losses: ${d.stats.losses} · Saved decks: ${Object.keys(d.decks || {}).length}`;
}

function saveMsg(text, isError) {
  const el = document.getElementById('save-msg');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

/* Apply persisted settings (currently: mute) to the live UI. */
function applySavedSettings() {
  const muted = !!SAVE.get().settings.muted;
  if (SFX.isMuted() !== muted) SFX.toggleMute();
  const muteBtn = document.getElementById('mute-btn');
  if (muteBtn) {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.title = muted ? 'Unmute' : 'Mute';
  }
  const snd = document.getElementById('setting-sound');
  if (snd) snd.checked = !muted;
}

function initSaveUI() {
  const $id = (i) => document.getElementById(i);
  if (!$id('save-export-copy')) return;

  $id('save-export-copy').addEventListener('click', async () => {
    const code = SAVE.exportCode();
    try {
      await navigator.clipboard.writeText(code);
      saveMsg('Save code copied to clipboard.');
    } catch (e) {
      const ta = $id('save-import-text');
      ta.value = code;
      ta.select();
      saveMsg('Clipboard blocked — the code is in the box below, copy it manually.');
    }
  });

  $id('save-export-file').addEventListener('click', () => {
    const blob = new Blob([SAVE.exportCode()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'primal-clash-save.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    saveMsg('Save file downloaded.');
  });

  const doImport = (text) => {
    const r = SAVE.importCode(text);
    if (r.ok) {
      $id('save-import-text').value = '';
      refreshSaveInfo();
      applySavedSettings();
      updateMenuInfo();
      saveMsg('Save imported! Decks, stats and settings restored.');
    } else {
      saveMsg(r.error, true);
    }
  };

  $id('save-import-btn').addEventListener('click', () => {
    const t = $id('save-import-text').value.trim();
    if (!t) { saveMsg('Paste a save code first.', true); return; }
    doImport(t);
  });
  $id('save-import-file-btn').addEventListener('click', () => $id('save-import-file').click());
  $id('save-import-file').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (f) f.text().then((t) => doImport(t.trim()));
    ev.target.value = '';
  });

  $id('save-reset').addEventListener('click', () => {
    if (confirm('Reset ALL progress (decks, stats, settings)? This cannot be undone.')) {
      SAVE.reset();
      refreshSaveInfo();
      applySavedSettings();
      updateMenuInfo();
      saveMsg('Progress reset.');
    }
  });
}

function updateMenuInfo() {
  const info = document.getElementById('menu-deck-info');
  if (info) {
    const name = DB.getActiveName();
    info.textContent = name ? `Active deck: “${name}”` : 'Active deck: random draft';
  }
  const resume = document.getElementById('resume-btn');
  /* Only single-player games can be resumed — an online game without its
     connection is just a dead snapshot. */
  const resumable = G && !G.over && !G.remote && !G.players[1].isRemote;
  if (resume) resume.classList.toggle('screen-hidden', !resumable);
  const note = document.getElementById('quit-note');
  if (note) note.classList.add('screen-hidden');
}

/* ---------- Sandbox mode (testing playground) ----------
   Infinite amber for you, a conjure-any-card panel (🧪 Cards in the
   topbar), and cheat buttons to boost the AI. The AI itself plays its
   normal game. Results are never recorded. */
let sbTarget = 0;   // who receives conjured cards: 0 = you, 1 = the AI
let sbQuery = '';

function sbMsg(text) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('sb-msg');
  if (el) el.textContent = text || '';
}

function renderSbCards() {
  const el = document.getElementById('sb-cards');
  if (!el) return;
  el.innerHTML = '';
  const list = CARD_POOL.filter((tpl) => {
    if (!sbQuery) return true;
    return [tpl.name, tpl.type, tpl.tribe || '', tpl.era || '', (tpl.abilities || []).join(' ')]
      .join(' ').toLowerCase().includes(sbQuery);
  });
  const order = { creature: 0, event: 1, biome: 2 };
  list.sort((a, b) => order[a.type] - order[b.type] || a.cost - b.cost || a.name.localeCompare(b.name));
  for (const tpl of list) {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'sb-card';
    d.title = `${tpl.name} (${tpl.cost} amber) — add to ${sbTarget === 0 ? 'your' : "the AI's"} hand`;
    d.innerHTML = `<span class="sb-cost">${tpl.cost}</span>` +
      artHTML(tpl.id, tpl.type === 'creature' ? TRIBE_ICONS[tpl.tribe] : tpl.icon, 'sb-art') +
      `<span class="sb-name">${tpl.name}</span>`;
    d.addEventListener('click', () => sbGiveCard(tpl));
    el.appendChild(d);
  }
  if (!list.length) el.innerHTML = '<div class="db-no-results">No cards match.</div>';
}

function sbGiveCard(tpl) {
  if (!G || !G.sandbox || G.over) return;
  const p = G.players[sbTarget];
  if (p.hand.length >= 10) {
    sbMsg(`${sbTarget === 0 ? 'Your' : "The AI's"} hand is full (10 cards).`);
    return;
  }
  const hc = makeHandCard(tpl);
  if (sbTarget === 0) hc._drawn = true;
  p.hand.push(hc);
  sbMsg(`${tpl.name} → ${sbTarget === 0 ? 'your' : "the AI's"} hand.`);
  log(`🧪 ${tpl.name} conjured into ${sbTarget === 0 ? 'your' : "the AI's"} hand.`);
  render();
}

function initSandboxUI() {
  const $id = (i) => document.getElementById(i);
  if (!$id('sandbox-panel')) return;

  $id('sandbox-menu-btn').addEventListener('click', () => {
    NET.guardLeave(() => {
      showScreen('app');
      newGame({ sandbox: true });
    });
  });
  $id('sandbox-btn').addEventListener('click', () => {
    if (!G || !G.sandbox) return;
    sbMsg('');
    renderSbCards();
    $id('sandbox-panel').classList.remove('hidden');
  });
  $id('sb-close').addEventListener('click', () => $id('sandbox-panel').classList.add('hidden'));
  $id('sandbox-panel').addEventListener('click', (ev) => {
    if (ev.target === $id('sandbox-panel')) $id('sandbox-panel').classList.add('hidden');
  });

  const setTarget = (t) => {
    sbTarget = t;
    $id('sb-target-you').classList.toggle('on', t === 0);
    $id('sb-target-ai').classList.toggle('on', t === 1);
    renderSbCards();
  };
  $id('sb-target-you').addEventListener('click', () => setTarget(0));
  $id('sb-target-ai').addEventListener('click', () => setTarget(1));

  $id('sb-search').addEventListener('input', (ev) => {
    sbQuery = ev.target.value.trim().toLowerCase();
    renderSbCards();
  });

  $id('sb-ai-amber').addEventListener('click', () => {
    if (!G || !G.sandbox || G.over) return;
    const ai = G.players[1];
    ai.maxAmber = Math.min(10, ai.maxAmber + 3);
    ai.amber = Math.min(ai.maxAmber, ai.amber + 3);
    sbMsg(`AI amber: ${ai.amber}/${ai.maxAmber}.`);
    log('🧪 The AI is granted extra amber.');
    render();
  });
  $id('sb-ai-draw').addEventListener('click', () => {
    if (!G || !G.sandbox || G.over) return;
    drawCards(G.players[1], 2);
    sbMsg('The AI drew 2 cards.');
    log('🧪 The AI draws 2 extra cards.');
    render();
  });
}

function quitGame() {
  window.close();
  /* Browsers usually block window.close() for tabs the script didn't open. */
  setTimeout(() => {
    const note = document.getElementById('quit-note');
    if (note) note.classList.remove('screen-hidden');
  }, 200);
}

function initMenus() {
  document.getElementById('play-btn').addEventListener('click', () => {
    showScreen('app');
    newGame();
  });
  document.getElementById('resume-btn').addEventListener('click', () => {
    showScreen('app');
    render();
  });
  document.getElementById('online-btn').addEventListener('click', () => showScreen('online-screen'));
  document.getElementById('deck-builder-btn').addEventListener('click', () => showScreen('deck-builder'));
  document.getElementById('settings-btn').addEventListener('click', () => showScreen('settings-screen'));
  document.getElementById('quit-btn').addEventListener('click', quitGame);

  for (const btn of document.querySelectorAll('.back-to-menu')) {
    btn.addEventListener('click', () => showScreen('main-menu'));
  }
  document.getElementById('menu-btn').addEventListener('click', () => {
    NET.guardLeave(() => showScreen('main-menu'));
  });
  document.getElementById('menu-over-btn').addEventListener('click', () => {
    NET.leave();   // no-op offline; after an online game this closes the connection
    hideGameOver();
    showScreen('main-menu');
  });

  /* Settings: sound toggle (kept in sync with the in-game 🔊 button, persisted). */
  document.getElementById('setting-sound').addEventListener('change', (ev) => {
    if (ev.currentTarget.checked === SFX.isMuted()) SFX.toggleMute();
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊';
      muteBtn.title = SFX.isMuted() ? 'Unmute' : 'Mute';
    }
    SAVE.setSetting('muted', SFX.isMuted());
  });

  initSaveUI();
  initSandboxUI();
  applySavedSettings();
  DB.init();
  showScreen('main-menu');
}
