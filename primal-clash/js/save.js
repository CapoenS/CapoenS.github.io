/* ============================================
   Primal Clash — SaveManager
   One versioned save blob for ALL player data
   (decks, active deck, match stats, settings,
   future card unlocks).

   Layer 1: localStorage autosave (per browser).
   Layer 2: portable save codes — base64 JSON
   with a checksum, e.g.  PC1.eyJ2IjoxLC4uLg.9f2ab3c4
   Players can copy the code / download it as a
   file and import it anywhere, so progress
   survives cleared browsers and moves between
   devices — no server needed (GitHub Pages OK).
   ============================================ */
"use strict";

const SAVE = (() => {
  const KEY = 'pc_save';
  const VERSION = 1;
  let data = null;   // in-memory copy (also the fallback when storage is blocked)
  let mem = null;

  function blank() {
    return {
      v: VERSION,
      decks: {},                            // deck name -> [card ids]
      activeDeck: null,                     // null = random draft
      stats: { wins: 0, losses: 0, games: 0 },
      unlocked: null,                       // reserved for a future unlock system (null = everything)
      settings: { muted: false },
      savedAt: 0,
    };
  }

  function readRaw() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(KEY);
    } catch (e) { /* storage blocked */ }
    return mem;
  }

  function writeRaw(s) {
    mem = s;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, s);
    } catch (e) { /* storage blocked — memory only */ }
  }

  /* Fill missing fields and pull in decks from the pre-SaveManager
     localStorage keys, so nobody loses their old decks. */
  function migrate(d) {
    try {
      if (typeof localStorage !== 'undefined' && (!d.decks || !Object.keys(d.decks).length)) {
        const legacy = localStorage.getItem('pc_decks');
        if (legacy) {
          d.decks = JSON.parse(legacy) || {};
          d.activeDeck = localStorage.getItem('pc_active_deck') || null;
        }
      }
    } catch (e) { /* ignore broken legacy data */ }
    const b = blank();
    for (const k of Object.keys(b)) if (d[k] === undefined) d[k] = b[k];
    if (!d.stats || typeof d.stats !== 'object') d.stats = b.stats;
    if (!d.settings || typeof d.settings !== 'object') d.settings = b.settings;
    d.v = VERSION;
    return d;
  }

  function load() {
    if (data) return data;
    let d = null;
    const raw = readRaw();
    if (raw) {
      try { d = JSON.parse(raw); } catch (e) { d = null; }
    }
    if (!d || typeof d !== 'object') d = blank();
    data = migrate(d);
    return data;
  }

  function persist() {
    load();
    data.savedAt = Date.now();
    writeRaw(JSON.stringify(data));
  }

  /* ---------- accessors (all autosave immediately) ---------- */
  function get() { return load(); }
  function setDecks(decks) { load().decks = decks; persist(); }
  function setActiveDeck(name) { load().activeDeck = name || null; persist(); }
  function setSetting(k, v) { load().settings[k] = v; persist(); }
  function recordResult(won) {
    const s = load().stats;
    s.games++;
    if (won) s.wins++; else s.losses++;
    persist();
  }
  function reset() { data = blank(); persist(); }

  /* ---------- save codes ---------- */
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  }

  /* "PC<version>.<base64url payload>.<fnv1a checksum>" */
  function exportCode() {
    load();
    const body = b64encode(JSON.stringify(data));
    return `PC${VERSION}.${body}.${fnv1a(body)}`;
  }

  function importCode(code) {
    try {
      const m = String(code).trim().match(/^PC(\d+)\.([A-Za-z0-9\-_]+)\.([0-9a-f]{8})$/);
      if (!m) return { ok: false, error: 'That does not look like a Primal Clash save code.' };
      const [, ver, body, sum] = m;
      if (fnv1a(body) !== sum) return { ok: false, error: 'Checksum mismatch — the code is incomplete or was altered.' };
      if (parseInt(ver, 10) > VERSION) return { ok: false, error: 'This save code is from a newer game version.' };
      const d = JSON.parse(b64decode(body));
      if (!d || typeof d !== 'object' || typeof d.decks !== 'object') {
        return { ok: false, error: 'Save data is malformed.' };
      }
      /* sanitize decks: only known card ids, sane names */
      const decks = {};
      for (const [name, ids] of Object.entries(d.decks || {})) {
        if (!Array.isArray(ids)) continue;
        decks[String(name).slice(0, 24)] =
          ids.filter((id) => CARD_POOL.some((c) => c.id === id));
      }
      d.decks = decks;
      if (d.activeDeck && !decks[d.activeDeck]) d.activeDeck = null;
      data = migrate(d);
      persist();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not read that save code.' };
    }
  }

  return { get, setDecks, setActiveDeck, setSetting, recordResult, reset, exportCode, importCode };
})();
