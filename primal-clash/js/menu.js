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
  applySavedSettings();
  DB.init();
  showScreen('main-menu');
}
