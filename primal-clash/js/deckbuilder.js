/* ============================================
   Primal Clash — deck builder
   Browse the whole card pool, build 20-card
   decks (max 2 copies), save them to
   localStorage, and pick the active deck
   used when you hit Play.
   ============================================ */
"use strict";

const DB = (() => {
  const LS_DECKS = 'pc_decks';
  const LS_ACTIVE = 'pc_active_deck';
  /* DECK_SIZE comes from cards.js — single source of truth. */
  const MAX_COPIES = 2;

  let current = [];   // card ids in the deck being edited (duplicates allowed, max 2)

  /* ---------- search & filters ---------- */
  const filters = { q: '', costs: new Set(), tribes: new Set(), skills: new Set() };

  /* extra words the search understands per tribe ("ocean" finds Aquatics…) */
  const TRIBE_SYNONYMS = {
    Aquatic: 'ocean sea water marine fish',
    Arthropod: 'insect bug scorpion spider',
    Reptile: 'dinosaur dino lizard scaly',
    Bird: 'avian feather',
    Mammal: 'fur furry beast',
  };

  function matchesFilters(tpl) {
    if (filters.costs.size) {
      const bucket = Math.min(7, tpl.cost);      // "7+" chip catches everything above
      if (!filters.costs.has(bucket)) return false;
    }
    if (filters.tribes.size && !(tpl.type === 'creature' && filters.tribes.has(tpl.tribe))) return false;
    if (filters.skills.size) {
      if (tpl.type !== 'creature') return false;
      if (![...filters.skills].some((s) => tpl.abilities.includes(s))) return false;
    }
    if (filters.q) {
      const hay = [
        tpl.name, tpl.type, tpl.tribe || '', tpl.era || '',
        (tpl.abilities || []).join(' '),
        tpl.ability ? tpl.ability.text : '',
        tpl.onSummon ? 'on summon ' + tpl.onSummon.text : '',
        tpl.text || '',
        tpl.legendary ? 'legendary' : '',
        tpl.type === 'creature' ? (TRIBE_SYNONYMS[tpl.tribe] || '') : '',
      ].join(' ').toLowerCase();
      if (!hay.includes(filters.q)) return false;
    }
    return true;
  }

  function buildChips() {
    const mk = (wrapId, values, set, labelFn) => {
      const wrap = document.getElementById(wrapId);
      if (!wrap) return;
      for (const v of values) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.innerHTML = labelFn(v);
        b.addEventListener('click', () => {
          if (set.has(v)) set.delete(v); else set.add(v);
          b.classList.toggle('on', set.has(v));
          renderPool();
        });
        wrap.appendChild(b);
      }
    };
    mk('db-filter-cost', [1, 2, 3, 4, 5, 6, 7], filters.costs, (v) => (v === 7 ? '7+' : String(v)));
    mk('db-filter-tribe', Object.keys(TRIBE_ICONS), filters.tribes, (t) => `${TRIBE_ICONS[t]} ${t}`);
    mk('db-filter-skill', Object.keys(KEYWORD_ICONS), filters.skills, (k) => `${KEYWORD_ICONS[k]} ${cap(k)}`);
  }

  /* ---------- storage (delegates to the SaveManager, js/save.js) ---------- */
  function loadDecks() {
    return SAVE.get().decks || {};
  }
  function saveDecks(decks) {
    SAVE.setDecks(decks);
  }
  function getActiveName() {
    const name = SAVE.get().activeDeck;
    return name && Array.isArray(loadDecks()[name]) ? name : null;
  }
  function setActive(name) {
    SAVE.setActiveDeck(name || null);
  }

  /* Validated card list for the active deck, or null to use a random draft. */
  function getActiveDeckCards() {
    const name = getActiveName();
    if (!name) return null;
    return validateDeckIds(loadDecks()[name]);  // shared validator, cards.js
  }

  /* ---------- editing ---------- */
  const countOf = (id) => current.filter((x) => x === id).length;

  function add(id) {
    const tpl = CARD_POOL.find((c) => c.id === id);
    if (!tpl) return;
    if (current.length >= DECK_SIZE) { setMsg(`Deck is full (${DECK_SIZE} cards).`, true); return; }
    if (countOf(id) >= maxCopiesOf(tpl)) {
      setMsg(tpl.legendary ? '★ Legendary — only 1 copy allowed per deck.' : `Max ${MAX_COPIES} copies of a card.`, true);
      return;
    }
    current.push(id);
    setMsg('');
    renderAll();
  }
  function removeOne(id) {
    const i = current.indexOf(id);
    if (i >= 0) { current.splice(i, 1); setMsg(''); renderAll(); }
  }
  function clear() { current = []; setMsg(''); renderAll(); }

  function randomFill() {
    const bag = [];
    for (const tpl of CARD_POOL) {
      for (let k = countOf(tpl.id); k < maxCopiesOf(tpl); k++) bag.push(tpl.id);
    }
    shuffle(bag);
    while (current.length < DECK_SIZE && bag.length) current.push(bag.pop());
    setMsg('');
    renderAll();
  }

  function save() {
    if (current.length !== DECK_SIZE) {
      setMsg(`A deck needs exactly ${DECK_SIZE} cards (you have ${current.length}).`, true);
      return;
    }
    const input = document.getElementById('db-name');
    const name = (input.value.trim() || 'My Deck').slice(0, 24);
    input.value = name;
    const decks = loadDecks();
    decks[name] = current.slice();
    saveDecks(decks);
    setActive(name);
    setMsg(`Saved “${name}” — it will be used when you hit Play.`);
    renderAll();
  }

  function loadForEdit(name) {
    const ids = loadDecks()[name];
    if (!Array.isArray(ids)) return;
    current = ids.slice(0, DECK_SIZE);
    document.getElementById('db-name').value = name;
    setMsg(`Editing “${name}”.`);
    renderAll();
  }

  function del(name) {
    const decks = loadDecks();
    delete decks[name];
    saveDecks(decks);
    if (getActiveName() === null) setActive(null);
    setMsg(`Deleted “${name}”.`);
    renderAll();
  }

  function use(name) {
    setActive(name);
    setMsg(`“${name}” is now your active deck.`);
    renderAll();
  }

  function useRandom() {
    setActive(null);
    setMsg('Play will use a random draft.');
    renderAll();
  }

  /* ---------- rendering ---------- */
  function setMsg(text, isError) {
    const el = document.getElementById('db-msg');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  function cardInfoTitle(tpl) {
    if (tpl.type === 'creature') {
      return `${tpl.name} — ${tpl.cost} amber\n${tpl.atk} ATK / ${tpl.armor} Armor / ${tpl.hp} HP / ${tpl.abilities.includes('fearless') ? '∞' : tpl.morale} Morale\n${tpl.tribe} · ${tpl.era}` +
        (tpl.legendary ? '\n★ Legendary — only 1 copy per deck' : '') +
        (tpl.onSummon ? '\nOn Summon: ' + tpl.onSummon.text : '') +
        (tpl.ability ? '\n' + tpl.ability.text : '') +
        (tpl.abilities.length ? '\n' + tpl.abilities.map((a) => KEYWORD_HELP[a]).join('\n') : '');
    }
    return `${tpl.name} — ${tpl.cost} amber\n${tpl.text}`;
  }

  const TYPE_ORDER = { creature: 0, event: 1, biome: 2 };
  function sortedPool() {
    return CARD_POOL.slice().sort((a, b) =>
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.cost - b.cost || a.name.localeCompare(b.name));
  }

  /* Pool creature — rendered exactly like a creature on the playing field
     (art, title bar with stat gems, parchment text box), plus a cost gem. */
  function poolCreatureEl(tpl) {
    const d = document.createElement('div');
    d.className = `creature ctype-creature db-pool-card era-${tpl.era.toLowerCase()} tribe-${tpl.tribe.toLowerCase()}`;
    for (const a of tpl.abilities) d.classList.add('kw-' + a);
    if (tpl.legendary) d.classList.add('legendary');
    const ruleHTML = [
      tpl.onSummon ? `<b>On Summon:</b> ${tpl.onSummon.text}` : '',
      tpl.ability ? tpl.ability.text : '',
    ].filter(Boolean).join('<br>');
    if (ruleHTML) d.classList.add('has-ability');
    d.innerHTML = `
      ${tpl.legendary ? '<div class="legendary-frame"></div><div class="lg-star">★</div>' : ''}
      ${artHTML(tpl.id, TRIBE_ICONS[tpl.tribe], 'c-art')}
      <div class="c-title">
        <div class="stat-badge stat-atk" title="Attack">${tpl.atk}</div>
        <div class="c-name">${tpl.name}</div>
        ${tpl.armor ? `<div class="stat-badge stat-armor" title="Armor">${tpl.armor}</div>` : ''}
        <div class="stat-badge stat-hp" title="Health">${tpl.hp}</div>
        <div class="stat-badge stat-morale" title="${tpl.abilities.includes('fearless') ? 'Fearless — infinite Morale' : 'Morale — retreats to hand at 0'}">${tpl.abilities.includes('fearless') ? '∞' : tpl.morale}</div>
      </div>
      ${ruleHTML ? `<div class="c-ability">${ruleHTML}</div>` : ''}
      <div class="cost" title="Amber cost">${tpl.cost}</div>`;
    return d;
  }

  /* Pool event/biome — rendered like the full hand card. */
  function poolSpellEl(tpl) {
    const d = document.createElement('div');
    d.className = `hand-card ctype-${tpl.type} db-pool-card era-none`;
    d.innerHTML = `
      <div class="cost" title="Amber cost">${tpl.cost}</div>
      ${artHTML(tpl.id, tpl.icon, tpl.type === 'event' ? 'card-art sigil' : 'biome-vista')}
      <div class="card-name">${tpl.name}</div>
      <div class="card-text">${tpl.text}</div>
      <div class="card-sub">${tpl.type === 'event' ? '⚡ Event' : '🌍 Biome'}</div>`;
    return d;
  }

  function poolCardEl(tpl) {
    const d = tpl.type === 'creature' ? poolCreatureEl(tpl) : poolSpellEl(tpl);
    const n = countOf(tpl.id);
    if (n >= maxCopiesOf(tpl)) d.classList.add('maxed');
    d.title = cardInfoTitle(tpl);
    if (n) d.insertAdjacentHTML('beforeend', `<span class="db-count-badge">×${n}</span>`);
    d.addEventListener('click', () => add(tpl.id));
    return d;
  }

  const POOL_SECTIONS = [
    { type: 'creature', label: 'Creatures' },
    { type: 'event',    label: 'Events' },
    { type: 'biome',    label: 'Biomes' },
  ];

  function renderPool() {
    const el = document.getElementById('db-pool');
    if (!el) return;
    el.innerHTML = '';
    const pool = sortedPool().filter(matchesFilters);
    for (const sec of POOL_SECTIONS) {
      const cards = pool.filter((t) => t.type === sec.type);
      if (!cards.length) continue;
      const h = document.createElement('div');
      h.className = 'db-section-title';
      h.innerHTML = `<span>${sec.label}</span><em>${cards.length}</em>`;
      el.appendChild(h);
      for (const tpl of cards) el.appendChild(poolCardEl(tpl));
    }
    if (!pool.length) {
      el.innerHTML = '<div class="db-no-results">No cards match your search or filters.</div>';
    }
  }

  function renderDeck() {
    const list = document.getElementById('db-deck-list');
    const count = document.getElementById('db-count');
    if (!list) return;
    if (count) count.textContent = current.length;
    const agg = {};
    for (const id of current) agg[id] = (agg[id] || 0) + 1;
    const rows = Object.keys(agg)
      .map((id) => CARD_POOL.find((c) => c.id === id))
      .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.cost - b.cost || a.name.localeCompare(b.name));
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<div class="db-empty">Click cards on the left to add them.</div>';
      return;
    }
    for (const tpl of rows) {
      const r = document.createElement('div');
      r.className = `db-row era-${(tpl.era || 'none').toLowerCase()}${tpl.tribe ? ' tribe-' + tpl.tribe.toLowerCase() : ''}`;
      r.title = 'Click to remove one copy';
      r.innerHTML = `<span class="db-row-cost">${tpl.cost}</span>
        <span class="db-row-name">${tpl.name}</span>
        <span class="db-row-count">×${agg[tpl.id]}</span>`;
      r.addEventListener('click', () => removeOne(tpl.id));
      list.appendChild(r);
    }
  }

  function renderSaved() {
    const el = document.getElementById('db-saved');
    if (!el) return;
    const decks = loadDecks();
    const active = getActiveName();
    el.innerHTML = '';

    const randomRow = document.createElement('div');
    randomRow.className = 'saved-row';
    randomRow.innerHTML = `<span class="saved-name">${active ? '' : '★ '}🎲 Random draft</span>`;
    const useRandomBtn = document.createElement('button');
    useRandomBtn.textContent = 'Use';
    useRandomBtn.disabled = !active;
    useRandomBtn.addEventListener('click', useRandom);
    randomRow.appendChild(useRandomBtn);
    el.appendChild(randomRow);

    for (const name of Object.keys(decks).sort()) {
      const row = document.createElement('div');
      row.className = 'saved-row';
      row.innerHTML = `<span class="saved-name">${active === name ? '★ ' : ''}${name}</span>`;
      const useBtn = document.createElement('button');
      useBtn.textContent = 'Use';
      useBtn.disabled = active === name;
      useBtn.addEventListener('click', () => use(name));
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => loadForEdit(name));
      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.title = 'Delete deck';
      delBtn.addEventListener('click', () => del(name));
      row.append(useBtn, editBtn, delBtn);
      el.appendChild(row);
    }
  }

  function renderAll() {
    renderPool();
    renderDeck();
    renderSaved();
  }

  /* ---------- lifecycle ---------- */
  function init() {
    document.getElementById('db-save').addEventListener('click', save);
    document.getElementById('db-random').addEventListener('click', randomFill);
    document.getElementById('db-clear').addEventListener('click', clear);

    const search = document.getElementById('db-search');
    if (search) {
      search.addEventListener('input', () => {
        filters.q = search.value.trim().toLowerCase();
        renderPool();
      });
    }
    const clearBtn = document.getElementById('db-filter-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        filters.q = '';
        filters.costs.clear();
        filters.tribes.clear();
        filters.skills.clear();
        if (search) search.value = '';
        document.querySelectorAll('#deck-builder .chip.on').forEach((c) => c.classList.remove('on'));
        renderPool();
      });
    }
    buildChips();
  }

  function open() {
    /* Start from the active deck if the editor is empty. */
    if (!current.length) {
      const name = getActiveName();
      const ids = name ? loadDecks()[name] : null;
      if (Array.isArray(ids)) {
        current = ids.slice(0, DECK_SIZE);
        document.getElementById('db-name').value = name;
      }
    }
    setMsg('');
    renderAll();
  }

  return { init, open, getActiveName, getActiveDeckCards };
})();
