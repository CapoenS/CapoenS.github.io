/* ============================================
   Primal Clash — online multiplayer (NET)
   PeerJS (WebRTC) friend-code matches, host-
   authoritative: the HOST runs the full engine
   and broadcasts redacted state snapshots; the
   GUEST renders snapshots and sends action
   intents shaped like the engine entry points
   (playCardFromHand / declareAttack / commitBlocks).

   The free PeerJS cloud (0.peerjs.com) is only
   used to introduce the two browsers to each
   other; all game traffic then flows directly
   peer-to-peer over an encrypted data channel.
   No TURN relay is configured, so a small share
   of strict-NAT networks cannot connect (shown
   as a connection error).

   Trust model: the host is authoritative and
   validates every guest intent through the
   engine's own legality checks, so a modified
   guest client cannot cheat. The host itself
   COULD cheat (it rolls all the dice) — fine
   for friend-code play, unfixable without a
   server.
   ============================================ */
"use strict";

const NET = (() => {
  const PROTO = 3;   // v3: two-target On Summon (play intent carries targetUid2)
  const ID_PREFIX = 'primal-clash-';
  /* Unambiguous alphabet: no 0/O, 1/I/L. */
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_LEN = 4;

  let mode = 'off';          // 'off' | 'host' | 'guest'
  let peer = null;           // Peer instance
  let conn = null;           // DataConnection to the other player
  let inMatchFlag = false;   // true from match start until leave/teardown
  let hostRetries = 0;       // unavailable-id regeneration attempts

  let myName = 'Chieftain';
  let oppName = '';
  let myDeckCards = null;    // my validated template list (both sides)
  let oppDeckCards = null;   // host only: guest's validated template list
  let iWantRematch = false;
  let oppWantsRematch = false;

  let lastSentState = '';    // host: JSON dedupe for the render broadcast
  let prevHandUids = null;   // guest: for re-deriving the draw-in animation
  let fxQueue = [];          // host: effects captured since the last broadcast

  /* ---------------- tiny DOM helpers ---------------- */
  const $id = (i) => document.getElementById(i);
  const setMsg = (text) => { const el = $id('ol-msg'); if (el) el.textContent = text || ''; };
  const setStatus = (text) => { const el = $id('ol-status'); if (el) el.textContent = text || ''; };

  function lobbyView(state) { // 'choose' | 'hosting' | 'lobby'
    for (const [id, s] of [['ol-choose', 'choose'], ['ol-hosting', 'hosting'], ['ol-lobby', 'lobby']]) {
      const el = $id(id);
      if (el) el.classList.toggle('screen-hidden', s !== state);
    }
  }

  /* Generic modal for online play: notices and confirmations. */
  function netModal(title, text, buttons) {
    const overlay = $id('net-modal');
    if (!overlay) return;
    $id('net-modal-title').textContent = title;
    $id('net-modal-text').textContent = text;
    const actions = $id('net-modal-actions');
    actions.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        overlay.classList.add('hidden');
        if (b.fn) b.fn();
      });
      actions.appendChild(btn);
    }
    overlay.classList.remove('hidden');
  }

  /* ---------------- connection lifecycle ---------------- */
  function makeCode() {
    let c = '';
    for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return c;
  }

  function readName() {
    const el = $id('ol-name');
    const name = ((el && el.value.trim()) || 'Chieftain').slice(0, 16);
    if (el) el.value = name;
    if (typeof SAVE !== 'undefined') SAVE.setSetting('playerName', name);
    return name;
  }

  function send(msg) {
    if (!conn || !conn.open) return false;
    msg.v = PROTO;
    conn.send(msg);
    return true;
  }

  /* Full reset back to offline. A single-player G stays resumable; an
     online G (host game or guest snapshot) is dead without the peer, so
     it is discarded to keep Resume honest. */
  function teardown() {
    if (typeof G !== 'undefined' && G && (G.remote || (G.players && G.players[1].isRemote))) G = null;
    if (typeof clearCombatStage === 'function') clearCombatStage();
    if (peer) { try { peer.destroy(); } catch (e) { /* already dead */ } }
    peer = null;
    conn = null;
    mode = 'off';
    inMatchFlag = false;
    oppName = '';
    myDeckCards = null;
    oppDeckCards = null;
    iWantRematch = false;
    oppWantsRematch = false;
    lastSentState = '';
    prevHandUids = null;
    fxQueue = [];
    hostRetries = 0;
  }

  function wirePeerErrors() {
    peer.on('error', (err) => {
      const type = err && err.type;
      if (type === 'unavailable-id' && mode === 'host' && !conn) {
        /* Code collision: silently retry with a fresh code. */
        if (hostRetries++ < 5) { try { peer.destroy(); } catch (e) {} peer = null; hostGame(); }
        else { teardown(); lobbyView('choose'); setMsg('Could not reserve a game code — try again in a moment.'); }
        return;
      }
      if (type === 'peer-unavailable') {
        teardown();
        lobbyView('choose');
        setMsg('No game found with that code. Check the code and that your friend is still hosting.');
        return;
      }
      if (inMatchFlag) {
        connectionLost();
        return;
      }
      teardown();
      lobbyView('choose');
      setMsg(type === 'network' || type === 'server-error' || type === 'socket-error'
        ? 'Could not reach the matchmaking service — check your internet connection and try again.'
        : 'Connection failed. If this keeps happening, one of your networks may block peer-to-peer play.');
    });
    peer.on('disconnected', () => {
      /* Signaling socket only — an in-progress match is direct P2P and
         unaffected. Reconnect so future errors surface properly. */
      if (peer && !peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
  }

  function wireConn() {
    conn.on('data', (m) => {
      try { onMessage(m); } catch (e) { console.error('NET message error', e, m); }
    });
    conn.on('close', () => onPeerGone());
    conn.on('error', () => { if (inMatchFlag && typeof G !== 'undefined' && G && !G.over) connectionLost(); });
  }

  function connectionLost() {
    const who = oppName || 'Your opponent';
    teardown();
    netModal('Connection lost', `${who} disconnected — the match cannot continue.`, [
      { label: 'Back to Menu', fn: () => { hideGameOver(); showScreen('main-menu'); } },
    ]);
  }

  /* The other player is gone (connection closed or a polite bye). What
     that means depends on where we are:
     - mid-match: the match is dead — modal, teardown.
     - after game over: stay on the result screen; Play Again will explain.
     - host in the lobby: keep hosting, wait for a new challenger.
     - guest in the lobby: the host is gone — back to the start. */
  function onPeerGone() {
    if (inMatchFlag && typeof G !== 'undefined' && G && !G.over) { connectionLost(); return; }
    if (inMatchFlag) { conn = null; return; }   // game finished; rematch is simply no longer possible
    if (mode === 'host' && peer && !peer.destroyed) {
      conn = null;
      oppName = '';
      oppDeckCards = null;
      myDeckCards = null;
      lobbyView('hosting');
      setMsg('Your opponent left — waiting for a new challenger…');
      return;
    }
    teardown();
    lobbyView('choose');
    setMsg('The host left.');
  }

  /* ---------------- lobby flow ---------------- */
  function openLobby() {
    /* Entering the lobby screen always starts from a clean slate. */
    teardown();
    lobbyView('choose');
    setMsg('');
    setStatus('');
    const nameEl = $id('ol-name');
    if (nameEl) {
      const saved = (typeof SAVE !== 'undefined' && SAVE.get().settings.playerName) || '';
      nameEl.value = saved || 'Chieftain';
    }
  }

  function hostGame() {
    myName = readName();
    mode = 'host';
    setMsg('');
    const code = makeCode();
    peer = new Peer(ID_PREFIX + code);
    wirePeerErrors();
    peer.on('open', () => {
      hostRetries = 0;
      const big = $id('ol-code-big');
      if (big) big.textContent = code;
      lobbyView('hosting');
    });
    peer.on('connection', (c) => {
      if (conn) { // already have a challenger — politely refuse a second
        c.on('open', () => { c.send({ v: PROTO, type: 'error', code: 'full', msg: 'This game already has two players.' }); c.close(); });
        return;
      }
      conn = c;
      wireConn();
    });
  }

  function joinGame() {
    myName = readName();
    const codeEl = $id('ol-code');
    const code = ((codeEl && codeEl.value) || '').trim().toUpperCase();
    if (code.length !== CODE_LEN) { setMsg('Enter the 4-character game code your friend shared.'); return; }
    mode = 'guest';
    setMsg('Connecting…');
    peer = new Peer();
    wirePeerErrors();
    peer.on('open', () => {
      conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
      wireConn();
      conn.on('open', () => send({ type: 'hello', proto: PROTO, name: myName }));
    });
  }

  /* Both players have met: show the deck-pick lobby. */
  function enterDeckLobby() {
    setMsg('');
    myDeckCards = null;
    oppDeckCards = null;
    const line = $id('ol-opp-line');
    if (line) line.innerHTML = `Challenger found: <b></b> — pick your deck!`;
    if (line) line.querySelector('b').textContent = oppName;
    const sel = $id('ol-deck');
    if (sel) {
      sel.innerHTML = '<option value="">🎲 Random draft</option>';
      const decks = (typeof SAVE !== 'undefined' && SAVE.get().decks) || {};
      for (const name of Object.keys(decks)) {
        if (!validateDeckIds(decks[name])) continue;
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
      const active = (typeof DB !== 'undefined') ? DB.getActiveName() : null;
      if (active && decks[active]) sel.value = active;
    }
    const ready = $id('ol-ready-btn');
    if (ready) ready.disabled = false;
    const sel2 = $id('ol-deck');
    if (sel2) sel2.disabled = false;
    const start = $id('ol-start-btn');
    if (start) start.classList.toggle('screen-hidden', mode !== 'host');
    updateLobbyStatus();
    lobbyView('lobby');
  }

  function updateLobbyStatus() {
    const start = $id('ol-start-btn');
    if (start) start.disabled = !(myDeckCards && oppDeckCards);
    if (mode === 'guest') {
      /* Only the host sees both decks; the guest just knows its own state. */
      setStatus(myDeckCards ? 'Deck locked in — waiting for the host to start the match…' : '');
    } else if (myDeckCards && oppDeckCards) {
      setStatus('Both decks are in — start the match!');
    } else if (myDeckCards) {
      setStatus(`Waiting for ${oppName} to pick a deck…`);
    } else {
      setStatus('');
    }
  }

  function chosenDeckIds() {
    const sel = $id('ol-deck');
    const name = sel ? sel.value : '';
    if (!name) return buildRandomDeck().map((c) => c.id);
    const decks = (typeof SAVE !== 'undefined' && SAVE.get().decks) || {};
    return decks[name] || null;
  }

  function submitDeck() {
    const ids = chosenDeckIds();
    const cards = validateDeckIds(ids);
    if (!cards) { setMsg('That deck is not legal (30 cards, ×2 max, ★ ×1) — fix it in the Deck Builder.'); return; }
    setMsg('');
    myDeckCards = cards;
    const ready = $id('ol-ready-btn');
    if (ready) ready.disabled = true;
    const sel = $id('ol-deck');
    if (sel) sel.disabled = true;
    if (mode === 'guest') send({ type: 'deck', ids });
    updateLobbyStatus();
  }

  function startMatch() {
    if (mode !== 'host' || !myDeckCards || !oppDeckCards) return;
    inMatchFlag = true;
    lastSentState = '';
    showScreen('app');
    newGame({
      p0: { name: myName, cards: myDeckCards },
      p1: { name: oppName, cards: oppDeckCards, remote: true },
    });
  }

  /* ---------------- game feel: FX/SFX capture & replay ----------------
     Sounds and imperative animations (lunges, floating numbers, shakes)
     are fired by the engine WHILE it resolves actions — and the engine
     only runs on the host. So: wrap FX/SFX once; while the host engine
     is resolving (G.busy), every effect is also queued and shipped with
     the next state broadcast; the guest replays the list against its own
     DOM after applying the snapshot. G.busy as the gate means the host's
     local UI feedback (misclick shakes) never leaks into the stream. */
  const REPLAY_SFX = ['playCard', 'attack', 'damage', 'death', 'heal', 'freeze',
    'footstep', 'roar', 'slam', 'whoosh', 'rumble', 'meteorFall', 'explosion', 'shatter', 'sparkleSfx',
    'mystic', 'splash'];
  // win/lose are deliberately NOT relayed: each side plays its own outcome.

  function capturing() {
    return mode === 'host' && inMatchFlag && typeof G !== 'undefined' && G && G.busy;
  }

  /* Serializable reference to an effect's element: creature uid or hero
     index (host-native — the guest flips hero indices on replay). */
  function elRef(el) {
    if (!el) return null;
    if (el.dataset && el.dataset.uid) return { u: Number(el.dataset.uid) };
    if (el.id === 'player-hero') return { h: 0 };
    if (el.id === 'enemy-hero') return { h: 1 };
    return null;
  }

  function resolveRef(r) {
    if (!r) return null;
    if (r.u != null) return elByUid(r.u);
    if (r.h != null) return heroEl(1 - r.h);
    return null;
  }

  (function wrapEffects() {
    if (typeof SFX === 'undefined' || typeof FX === 'undefined') return;
    for (const n of REPLAY_SFX) {
      const orig = SFX[n].bind(SFX);
      SFX[n] = () => {
        if (capturing()) fxQueue.push({ k: 'sfx', n });
        orig();
      };
    }
    const origFloat = FX.floatText.bind(FX);
    FX.floatText = (el, text, cls) => {
      if (capturing()) {
        const at = elRef(el);
        if (at) fxQueue.push({ k: 'float', at, txt: String(text), cls: cls || 'dmg' });
      }
      origFloat(el, text, cls);
    };
    const origShake = FX.shake.bind(FX);
    FX.shake = (el) => {
      if (capturing()) {
        const at = elRef(el);
        if (at) fxQueue.push({ k: 'shake', at });
      }
      origShake(el);
    };
    const origLunge = FX.lunge.bind(FX);
    FX.lunge = (fromEl, toEl, power) => {
      if (capturing()) {
        const from = elRef(fromEl);
        const to = elRef(toEl);
        if (from && to) fxQueue.push({ k: 'lunge', from, to, p: power });
      }
      return origLunge(fromEl, toEl, power);
    };
    const origImpact = FX.impact.bind(FX);
    FX.impact = (el, mag) => {
      if (capturing()) fxQueue.push({ k: 'impact', at: elRef(el), mag: mag == null ? 1 : mag });
      origImpact(el, mag);
    };
    const origScreenShake = FX.screenShake.bind(FX);
    FX.screenShake = (intensity, dur) => {
      if (capturing()) fxQueue.push({ k: 'sshake', i: intensity, d: dur });
      origScreenShake(intensity, dur);
    };
    /* Generic relay for every registered (el, opts) particle effect —
       new effects only need a name in FX.RELAY / FX.RELAY_AWAIT. */
    for (const n of (FX.RELAY || [])) {
      const orig = FX[n].bind(FX);
      FX[n] = (el, o) => {
        if (capturing()) fxQueue.push({ k: 'fxg', n, at: elRef(el), o });
        orig(el, o);
      };
    }
    for (const n of (FX.RELAY_AWAIT || [])) {
      const orig = FX[n].bind(FX);
      FX[n] = (el, o) => {
        if (capturing()) fxQueue.push({ k: 'fxa', n, at: elRef(el), o });
        return orig(el, o);
      };
    }
  })();

  /* Guest: replay a broadcast effect list. Sequential, awaiting only the
     lunge — that reproduces the host's wind-up → impact pacing. */
  async function replayEffects(list) {
    for (const e of list) {
      if (e.k === 'sfx' && REPLAY_SFX.includes(e.n)) SFX[e.n]();
      else if (e.k === 'float') FX.floatText(resolveRef(e.at), e.txt, e.cls);
      else if (e.k === 'shake') FX.shake(resolveRef(e.at));
      else if (e.k === 'lunge') await FX.lunge(resolveRef(e.from), resolveRef(e.to), e.p);
      else if (e.k === 'impact') FX.impact(resolveRef(e.at), e.mag);
      else if (e.k === 'sshake') FX.screenShake(e.i, e.d);
      else if (e.k === 'fxg' && FX.RELAY.includes(e.n)) FX[e.n](resolveRef(e.at), e.o);
      else if (e.k === 'fxa' && FX.RELAY_AWAIT.includes(e.n)) await FX[e.n](resolveRef(e.at), e.o);
    }
  }

  /* ---------------- host: snapshot broadcast ---------------- */

  /* Log lines for the guest: public strings pass through; the host's
     private lines are dropped; the guest's private lines become p:0
     (the guest sees itself as player 0). */
  function logForGuest(entries) {
    const out = [];
    for (const l of entries) {
      if (typeof l === 'string') out.push(l);
      else if (l.p === 1) out.push({ t: l.t, p: 0 });
    }
    return out;
  }

  function stripDrawn(card) {
    if (!card._drawn) return card;
    const c = Object.assign({}, card);
    delete c._drawn;
    return c;
  }

  /* Combat state for the guest: player indices flipped (guest = 0). The
     quick queue keeps its ORDER and COUNT (so the guest can show a spell
     token per queued spell) but the host's spells are redacted to hidden
     placeholders — their contents stay secret until they resolve. */
  function serializeCombat() {
    if (!G.combat) return null;
    return {
      phase: G.combat.phase,
      attackerIdx: 1 - G.combat.attackerIdx,
      lanes: G.combat.lanes.map((l) => ({ aUid: l.aUid, bUid: l.bUid, stalkerLock: l.stalkerLock })),
      quicks: G.combat.quicks.map((q) => q.side === 1
        ? { side: 0, card: q.card, targetUid: q.targetUid }   // guest's own → visible, flipped to side 0
        : { side: 1, hidden: true }),                          // host's → hidden placeholder, flipped to side 1
    };
  }

  /* The guest's entire view of the game, in the guest's own orientation
     (it sees itself as player 0) with hidden zones redacted to counts. */
  function serializeForGuest() {
    const host = G.players[0];
    const guest = G.players[1];
    return {
      gen: G.gen,
      turnCount: G.turnCount,
      over: G.over,
      busy: G.busy,
      active: 1 - G.active,
      winner: G.winner == null ? null : 1 - G.winner,
      attackUsed: G.attackUsed,
      biome: G.biome,
      combat: serializeCombat(),
      log: logForGuest(G.log.slice(-80)),
      you: {
        name: guest.name, hp: guest.hp, maxHp: guest.maxHp,
        amber: guest.amber, maxAmber: guest.maxAmber,
        qmber: guest.qmber, qmberMax: guest.qmberMax, fatigue: guest.fatigue,
        hand: guest.hand.map(stripDrawn),
        deckCount: guest.deck.length,
        board: guest.board,
      },
      opp: {
        name: host.name, hp: host.hp, maxHp: host.maxHp,
        amber: host.amber, maxAmber: host.maxAmber,
        qmber: host.qmber, qmberMax: host.qmberMax, fatigue: host.fatigue,
        handCount: host.hand.length,
        deckCount: host.deck.length,
        board: host.board,
      },
    };
  }

  /* Called at the end of every render(). The engine re-renders between
     its animation sleeps, so each distinct state (spawns, dying, retreats)
     streams to the guest on the host's timing — free minimal animations. */
  function onRender() {
    if (mode !== 'host' || !inMatchFlag || !conn || !conn.open) return;
    if (typeof G === 'undefined' || !G || !G.players[1].isRemote) return;
    const s = serializeForGuest();
    const js = JSON.stringify(s);
    const fx = fxQueue.length ? fxQueue.splice(0, fxQueue.length) : null;
    if (js === lastSentState && !fx) return;
    lastSentState = js;
    conn.send({ v: PROTO, type: 'state', s: JSON.parse(js), a: fx || undefined });
  }

  /* Force a fresh snapshot — used after rejecting a guest intent so the
     guest's optimistic input lock always releases. */
  function resync() {
    lastSentState = '';
    onRender();
  }

  /* ---------------- guest: apply snapshots ---------------- */
  function applySnapshot(s) {
    const hadG = typeof G !== 'undefined' && !!G && inMatchFlag;
    const prevOver = hadG ? G.over : false;
    const prevGen = hadG ? G.gen : null;
    const prevCombatKey = hadG ? (G.combat ? G.combat.phase : 'none') : null;
    if (prevGen !== s.gen) {   // new game (first start or rematch)
      prevHandUids = null;
      iWantRematch = false;
      oppWantsRematch = false;
    }
    if (typeof clearTargetPicker === 'function') clearTargetPicker(); // cancel a stale pre-pick

    const you = {
      idx: 0, isAI: false,
      name: s.you.name, hp: s.you.hp, maxHp: s.you.maxHp,
      amber: s.you.amber, maxAmber: s.you.maxAmber,
      qmber: s.you.qmber || 0, qmberMax: s.you.qmberMax || 3, fatigue: s.you.fatigue || 0,
      hand: s.you.hand,
      board: s.you.board,
      deck: new Array(s.you.deckCount).fill(null),   // ui only reads .length
    };
    const opp = {
      idx: 1, isAI: false,
      name: s.opp.name, hp: s.opp.hp, maxHp: s.opp.maxHp,
      amber: s.opp.amber, maxAmber: s.opp.maxAmber,
      qmber: s.opp.qmber || 0, qmberMax: s.opp.qmberMax || 3, fatigue: s.opp.fatigue || 0,
      hand: Array.from({ length: s.opp.handCount }, () => ({ hidden: true })),
      board: s.opp.board,
      deck: new Array(s.opp.deckCount).fill(null),
    };
    /* Draw-in animation: cards whose uid wasn't in the previous snapshot. */
    for (const c of you.hand) {
      if (!prevHandUids || !prevHandUids.has(c.uid)) c._drawn = true;
    }
    prevHandUids = new Set(you.hand.map((c) => c.uid));

    /* Deck-pile pulse on draws (the engine-side pulse runs on the host). */
    if (hadG && prevGen === s.gen && typeof pulseDeckPile === 'function') {
      if (s.you.deckCount < G.players[0].deck.length) pulseDeckPile(0);
      if (s.opp.deckCount < G.players[1].deck.length) pulseDeckPile(1);
    }

    /* Rebuild combat (indices already flipped host-side). */
    const combat = s.combat ? {
      phase: s.combat.phase,
      attackerIdx: s.combat.attackerIdx,
      lanes: s.combat.lanes,
      quicks: s.combat.quicks || [],
    } : null;
    /* The combat window changed under me (phase advanced, combat ended, or a
       new game) → my in-progress staging is stale, drop it. A same-phase
       resync leaves my staging intact. */
    const newCombatKey = combat ? combat.phase : 'none';
    if (typeof clearCombatStage === 'function' && prevCombatKey !== null && prevCombatKey !== newCombatKey) {
      clearCombatStage();
    }

    G = {
      remote: true,   // guest-side snapshot, not a locally simulated game
      gen: s.gen,
      players: [you, opp],
      biome: s.biome,
      active: s.active,
      turnCount: s.turnCount,
      over: s.over,
      winner: s.winner,
      busy: s.busy,
      combat,
      attackUsed: !!s.attackUsed,
      log: s.log,
    };
    render();

    if (prevOver && !s.over) hideGameOver();       // rematch started
    if (!prevOver && s.over) {                     // game just ended
      if (typeof SAVE !== 'undefined') SAVE.recordResult(s.winner === 0);
      if (s.winner === 0) SFX.win(); else SFX.lose();
      /* Mirror the host: the loser's panel collapses, THEN the overlay. */
      const loserIdx = s.winner === 0 ? 1 : 0;
      (async () => {
        await FX.heroDeath(heroEl(loserIdx));
        if (G && G.over) showGameOver();
      })();
    }
  }

  /* ---------------- guest: intents ---------------- */
  function lockAndSend(msg) {
    G.busy = true;   // optimistic input lock; the next snapshot is authoritative
    render();
    send(msg);
  }

  /* Play a card (guest). For creatures with a targeted On Summon effect
     the guest picks the target here, on its own snapshot, using the same
     modal as single-player — the host never opens a picker for us. */
  async function playCard(card, dropTarget) {
    let target = dropTarget, target2;
    if (card.type === 'creature' && card.onSummon) {
      const def = ON_SUMMON[card.onSummon.id];
      if (def && def.targets) {
        /* Pre-pick On Summon target(s) locally, then ship the uid(s) — the
           host never opens a modal for us. Two-target effects (targets2,
           e.g. Gigantopithecus) send both. Escape cancels the whole play. */
        const t1s = def.targets(0, card).filter((t) => !t.dying);
        if (t1s.length) {
          const label1 = def.prompt ? def.prompt(1) : 'On Summon: click a highlighted target.';
          target = await uiChooseTarget(t1s, `${card.name} — ${label1}`, card.uid);
          if (!target) { render(); return; }
        }
        if (def.targets2 && target) {
          const t2s = def.targets2(0, card, target).filter((t) => !t.dying);
          if (t2s.length) {
            const label2 = def.prompt ? def.prompt(2) : 'On Summon: click a highlighted target.';
            target2 = await uiChooseTarget(t2s, `${card.name} — ${label2}`, card.uid);
            if (!target2) { render(); return; }
          }
        }
      }
    }
    lockAndSend({
      type: 'play', uid: card.uid,
      targetUid: target ? target.uid : undefined,
      targetUid2: target2 ? target2.uid : undefined,
    });
  }

  function sendEndTurn() {
    lockAndSend({ type: 'endTurn' });
  }

  /* Surrender (guest): the host zeroes our leader — no optimistic lock
     needed, the resulting snapshot ends the game. */
  function sendSurrender() {
    send({ type: 'surrender' });
  }

  /* Emotes travel outside the intent system: allowed anytime, both ways. */
  function sendEmote(e) {
    send({ type: 'emote', e: String(e).slice(0, 4) });
  }

  /* Combat intents (guest). Payloads are uid-based; the host re-validates
     everything through the engine commit functions. Four steps: declare
     attackers, assign blocks, attacker casts spells, defender casts. */
  function sendCombatDeclare(decl) {
    lockAndSend({ type: 'combatDeclare', lanes: decl.lanes });
  }
  function sendCombatBlocks(decl) {
    lockAndSend({ type: 'combatBlocks', blocks: decl.blocks });
  }
  function sendCombatAttackerCast(decl) {
    lockAndSend({ type: 'combatAttackerCast', quicks: decl.quicks });
  }
  function sendCombatDefenderCast(decl) {
    lockAndSend({ type: 'combatDefenderCast', quicks: decl.quicks });
  }

  function requestRematch() {
    if (!inMatchFlag) return;
    if (!conn || !conn.open) {
      netModal('Opponent left', `${oppName || 'Your opponent'} has left — no rematch this time.`, [
        { label: 'Back to Menu', fn: () => { leave(); hideGameOver(); showScreen('main-menu'); } },
      ]);
      return;
    }
    iWantRematch = true;
    if (mode === 'host' && oppWantsRematch) { doRematch(); return; }
    send({ type: 'rematch' });
    const el = $id('game-over-text');
    if (el) el.textContent = `Waiting for ${oppName} to accept the rematch…`;
  }

  function doRematch() {   // host only
    iWantRematch = false;
    oppWantsRematch = false;
    lastSentState = '';
    hideGameOver();
    startMatch();
  }

  /* ---------------- leaving ---------------- */

  /* Run `fn`, first confirming (and conceding) if an online match is live.
     Offline this is a plain passthrough. */
  function guardLeave(fn) {
    if (!inMatchFlag) { fn(); return; }
    if (typeof G !== 'undefined' && G && G.over) { leave(); fn(); return; }
    netModal('Leave the match?', 'Leaving an online match counts as a concede.', [
      { label: 'Stay', fn: null },
      {
        label: 'Concede & Leave',
        fn: () => {
          send({ type: 'concede' });
          if (typeof SAVE !== 'undefined') SAVE.recordResult(false);
          /* Give the concede a moment to flush before killing the peer. */
          setTimeout(teardown, 250);
          inMatchFlag = false;
          fn();
        },
      },
    ]);
  }

  function leave() {
    if (mode === 'off') return;
    send({ type: 'bye' });
    teardown();
  }

  /* ---------------- message handling ---------------- */
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.v !== PROTO) {
      send({ type: 'error', code: 'version' });
      teardown();
      netModal('Version mismatch', 'Your friend is running a different game version — you should both refresh the page and try again.', [
        { label: 'OK', fn: () => showScreen('online-screen') },
      ]);
      return;
    }
    if (mode === 'host') onHostMessage(m);
    else if (mode === 'guest') onGuestMessage(m);
  }

  function onHostMessage(m) {
    switch (m.type) {
      case 'hello':
        if (m.proto !== PROTO) { send({ type: 'error', code: 'version' }); return; }
        oppName = String(m.name || 'Challenger').slice(0, 16);
        if (oppName === myName) oppName += ' 2';   // keep "name === 'You'" grammar & labels unambiguous
        send({ type: 'helloAck', name: myName });
        enterDeckLobby();
        break;
      case 'deck': {
        const cards = validateDeckIds(m.ids);
        if (!cards) { send({ type: 'deckAck', ok: false, error: 'The host rejected that deck as illegal.' }); return; }
        oppDeckCards = cards;
        send({ type: 'deckAck', ok: true });
        updateLobbyStatus();
        break;
      }
      case 'play': case 'endTurn':
      case 'combatDeclare': case 'combatBlocks':
      case 'combatAttackerCast': case 'combatDefenderCast':
      case 'surrender':
        handleIntent(m);
        break;
      case 'emote':
        if (typeof showEmote === 'function') showEmote(1, m.e);
        break;
      case 'rematch':
        oppWantsRematch = true;
        if (typeof G !== 'undefined' && G && G.over) {
          if (iWantRematch) doRematch();
          else { const el = $id('game-over-text'); if (el) el.textContent = `${oppName} wants a rematch — hit Play Again!`; }
        }
        break;
      case 'concede':
        if (typeof G !== 'undefined' && G && !G.over && inMatchFlag) {
          G.over = true;
          G.winner = 0;
          G.busy = false;
          log(`${oppName} concedes the clash!`);
          if (typeof SAVE !== 'undefined') SAVE.recordResult(true);
          SFX.win();
          render();
          showGameOver();
        }
        break;
      case 'bye':
        onPeerGone();
        break;
    }
  }

  function onGuestMessage(m) {
    switch (m.type) {
      case 'helloAck':
        oppName = String(m.name || 'Host').slice(0, 16);
        if (oppName === myName) myName += ' 2';
        enterDeckLobby();
        break;
      case 'deckAck':
        if (!m.ok) {
          myDeckCards = null;
          const ready = $id('ol-ready-btn');
          if (ready) ready.disabled = false;
          const sel = $id('ol-deck');
          if (sel) sel.disabled = false;
          setMsg(m.error || 'The host rejected that deck.');
        }
        updateLobbyStatus();
        break;
      case 'state':
        if (!inMatchFlag) {           // first snapshot = the match is starting
          inMatchFlag = true;
          hideGameOver();
          showScreen('app');
        }
        applySnapshot(m.s);
        if (Array.isArray(m.a)) replayEffects(m.a);
        break;
      case 'rematch':
        oppWantsRematch = true;
        if (!iWantRematch) { const el = $id('game-over-text'); if (el) el.textContent = `${oppName} wants a rematch — hit Play Again!`; }
        break;
      case 'emote':
        if (typeof showEmote === 'function') showEmote(1, m.e);
        break;
      case 'concede':
        if (typeof G !== 'undefined' && G && !G.over && inMatchFlag) {
          G.over = true;
          G.winner = 0;
          G.busy = false;
          if (typeof SAVE !== 'undefined') SAVE.recordResult(true);
          SFX.win();
          render();
          showGameOver();
        }
        break;
      case 'error':
        if (m.code === 'version') {
          teardown();
          netModal('Version mismatch', 'The host is running a different game version — you should both refresh the page and try again.', [
            { label: 'OK', fn: () => showScreen('online-screen') },
          ]);
        } else if (m.code === 'full') {
          teardown();
          lobbyView('choose');
          setMsg('That game already has two players.');
        }
        break;
      case 'bye':
        onPeerGone();
        break;
    }
  }

  /* ---------------- host: validate & execute guest intents ----------------
     The engine's own checks are the authority: uids are translated to live
     instances, legality is re-verified, and anything invalid or stale is
     silently dropped followed by a resync (which also unlocks the guest). */
  function findCreatureByUid(uid) {
    if (uid == null) return undefined;
    return G.players[0].board.find((c) => c.uid === uid) ||
           G.players[1].board.find((c) => c.uid === uid);
  }

  async function handleIntent(m) {
    /* Surrender is allowed at ANY time — even off-turn or mid-combat. */
    if (m.type === 'surrender') {
      if (typeof G === 'undefined' || !G || G.over || !G.players[1].isRemote) return;
      log(`${G.players[1].name} raises the white flag!`);
      G.players[1].hp = 0;
      checkWin();
      return;
    }
    /* Phase-aware gate: actingSide() === 1 covers BOTH cases — the guest
       acting on its own turn (play/endTurn/combatDeclare), and the guest
       acting OFF-TURN as the defender during the block phase
       (combatBlocks), when G.active is 0 but combat.phase === 'block' with
       the host as attacker. All legality lives in the engine entry points. */
    if (typeof G === 'undefined' || !G || G.over || !G.players[1].isRemote || actingSide() !== 1) {
      resync();
      return;
    }
    const gen = G.gen;

    if (m.type === 'endTurn') {
      if (G.combat) { resync(); return; }
      await endTurn();
      return;   // startTurn renders → broadcast happens on its own
    }

    if (m.type === 'play') {
      const card = G.players[1].hand.find((c) => c.uid === m.uid);
      if (!card) { resync(); return; }
      const target = findCreatureByUid(m.targetUid);
      const target2 = findCreatureByUid(m.targetUid2);   // two-target On Summon (Gigantopithecus)
      G.busy = true;   // keep the guest locked while the play resolves
      render();
      const ok = await playCardFromHand(1, card.uid, target, target2);
      if (!G || G.gen !== gen) return;
      if (!G.over) G.busy = false;
      render();
      if (!ok) resync();
      return;
    }

    if (m.type === 'combatDeclare') {
      const ok = await declareAttack(1, { lanes: m.lanes || [] });
      if (!G || G.gen !== gen) return;
      if (!ok) resync();
      return;   // advanceCombat handles the hand-off from here
    }

    if (m.type === 'combatBlocks') {
      const ok = await commitBlocks(1, { blocks: m.blocks || [] });
      if (!G || G.gen !== gen) return;
      if (!ok) resync();
      return;
    }

    if (m.type === 'combatAttackerCast') {
      const ok = await commitAttackerCast(1, { quicks: m.quicks || [] });
      if (!G || G.gen !== gen) return;
      if (!ok) resync();
      return;
    }

    if (m.type === 'combatDefenderCast') {
      const ok = await commitDefenderCast(1, { quicks: m.quicks || [] });
      if (!G || G.gen !== gen) return;
      if (!ok) resync();
      return;   // commitDefenderCast runs the full resolution
    }
  }

  /* ---------------- boot ---------------- */
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      if (!$id('ol-host-btn')) return;
      $id('ol-host-btn').addEventListener('click', hostGame);
      $id('ol-join-btn').addEventListener('click', joinGame);
      $id('ol-code').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') joinGame(); });
      $id('ol-ready-btn').addEventListener('click', submitDeck);
      $id('ol-start-btn').addEventListener('click', startMatch);
      $id('ol-back-btn').addEventListener('click', () => { leave(); showScreen('main-menu'); });
      $id('ol-code-big').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText($id('ol-code-big').textContent); } catch (e) { /* select-all styling covers it */ }
      });
    });
  }

  return {
    get mode() { return mode; },
    isHost: () => mode === 'host',
    isGuest: () => mode === 'guest',
    inMatch: () => inMatchFlag,
    openLobby,
    hostGame,
    joinGame,
    leave,
    guardLeave,
    startMatch,
    playCard,
    sendEndTurn,
    sendSurrender,
    sendEmote,
    sendCombatDeclare,
    sendCombatBlocks,
    sendCombatAttackerCast,
    sendCombatDefenderCast,
    requestRematch,
    onRender,
  };
})();
