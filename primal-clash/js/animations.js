/* ============================================
   Primal Clash — animation & particle engine
   DOM/canvas effects; every function is safe to
   call with missing elements (they just no-op),
   which also keeps the engine testable headless.

   MULTIPLAYER CONTRACT: any effect fired while
   the host engine resolves (G.busy) must reach
   the guest. net.js wraps:
     - the classic effects by name (lunge, impact,
       floatText, shake, screenShake), and
     - everything listed in FX.RELAY (fire-and-
       forget) / FX.RELAY_AWAIT (awaited), all of
       which take (el, opts) with a serializable
       opts object.
   New effect? Give it that signature and add its
   name to one of the two lists — done.
   ============================================ */
"use strict";

/* Respect the OS "reduce motion" preference: shakes and particles
   become no-ops; state animations (spawn/death fades) still play. */
const FX_REDUCED = (typeof matchMedia !== 'undefined') &&
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- screen shake (whole board wobbles on impact) ----------
   One shared rAF loop translates #battlefield with a decaying random
   offset. Repeated calls bump the magnitude and restart the decay, so
   a flurry of hits builds up rather than fighting each other. */
let _shakeRoot = null, _shakeMag = 0, _shakeRAF = 0, _shakeStart = 0, _shakeDur = 300;
function _getShakeRoot() {
  if (_shakeRoot) return _shakeRoot;
  if (typeof document === 'undefined') return null;
  _shakeRoot = document.getElementById('battlefield');
  return _shakeRoot;
}
function _runScreenShake(intensity, dur) {
  if (FX_REDUCED) return;
  const root = _getShakeRoot();
  if (!root) return;
  _shakeMag = Math.min(30, _shakeMag + intensity);
  _shakeStart = performance.now();
  _shakeDur = dur;
  if (_shakeRAF) return;                 // a loop is already running
  const frame = (now) => {
    const t = (now - _shakeStart) / _shakeDur;
    const m = _shakeMag * Math.max(0, 1 - t);
    if (m < 0.4) { root.style.transform = ''; _shakeMag = 0; _shakeRAF = 0; return; }
    root.style.transform = `translate(${(Math.random() - 0.5) * m}px, ${(Math.random() - 0.5) * m}px)`;
    _shakeRAF = requestAnimationFrame(frame);
  };
  _shakeRAF = requestAnimationFrame(frame);
}

/* ---------- particle engine ----------
   A single fixed fullscreen canvas + one rAF loop. Particles are plain
   objects; the loop dies when the list empties. Shapes: dot, spark
   (motion-oriented streak), shard (tumbling debris), leaf, bubble, ember. */
const _PARTS = { list: [], canvas: null, ctx: null, raf: 0, last: 0, MAX: 450 };

function _fxCanvas() {
  if (typeof document === 'undefined') return null;
  if (_PARTS.canvas) return _PARTS.canvas;
  const c = document.createElement('canvas');
  c.id = 'fx-canvas';
  document.body.appendChild(c);
  const size = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
  size();
  window.addEventListener('resize', size);
  _PARTS.canvas = c;
  _PARTS.ctx = c.getContext('2d');
  return c;
}

function _fxTick(now) {
  const { list, ctx, canvas } = _PARTS;
  const dt = Math.min(0.05, (now - _PARTS.last) / 1000 || 0.016);
  _PARTS.last = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt * 1000;
    if (p.life <= 0) { list.splice(i, 1); continue; }
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    ctx.globalAlpha = Math.min(1, p.life / p.fade) * p.alpha;
    ctx.fillStyle = p.color;
    switch (p.shape) {
      case 'spark': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-p.size * 1.8, -p.size * 0.25, p.size * 3.6, p.size * 0.5);
        ctx.restore();
        break;
      }
      case 'shard': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(-p.size, p.size);
        ctx.lineTo(0, -p.size * 1.4);
        ctx.lineTo(p.size, p.size * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'leaf': {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.5, p.size * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'bubble': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'ember': {
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.7 + 0.3 * Math.sin(p.life / 45)), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
      default: {   // dot / snow / dust
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  if (list.length) _PARTS.raf = requestAnimationFrame(_fxTick);
  else { _PARTS.raf = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

/* Spawn `o.n` particles at (x, y). All speeds px/s, life in ms. */
function _emit(x, y, o = {}) {
  if (FX_REDUCED || !_fxCanvas()) return;
  const n = Math.max(0, Math.min(o.n || 12, _PARTS.MAX - _PARTS.list.length));
  const colors = o.colors || ['#ffffff'];
  for (let i = 0; i < n; i++) {
    const ang = (o.angle != null ? o.angle : -Math.PI / 2) +
      (Math.random() - 0.5) * (o.spread != null ? o.spread : Math.PI * 2);
    const spd = (o.speed || 220) * (0.35 + Math.random() * 0.95);
    _PARTS.list.push({
      x: x + (Math.random() - 0.5) * (o.jitter || 8),
      y: y + (Math.random() - 0.5) * (o.jitter || 8),
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      grav: o.grav != null ? o.grav : 520,
      drag: o.drag != null ? o.drag : 0.985,
      life: (o.life || 650) * (0.55 + Math.random() * 0.75),
      fade: o.fade || 240,
      size: (o.size || 4) * (0.6 + Math.random() * 0.9),
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: o.shape || 'dot',
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 10,
      alpha: o.alpha != null ? o.alpha : 1,
    });
  }
  if (!_PARTS.raf && _PARTS.list.length) {
    _PARTS.last = performance.now();
    _PARTS.raf = requestAnimationFrame(_fxTick);
  }
}

function _centerOf(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
}
function _fieldCenter() {
  if (typeof document === 'undefined') return null;
  return _centerOf(document.getElementById('battlefield'));
}

/* Expanding ring at page coords (the visual "boom" outline).
   `o.reverse` contracts instead — energy gathering inward. */
function _ring(x, y, o = {}) {
  if (typeof document === 'undefined') return;
  const ring = document.createElement('div');
  ring.className = 'fx-ring';
  ring.style.left = x + 'px';
  ring.style.top = y + 'px';
  ring.style.width = ring.style.height = (o.size || 90) + 'px';
  ring.style.borderColor = o.color || 'rgba(255,235,180,.9)';
  document.body.appendChild(ring);
  const out = [
    { transform: 'translate(-50%,-50%) scale(.15)', opacity: 0.95 },
    { transform: `translate(-50%,-50%) scale(${o.scale || 2})`, opacity: 0 },
  ];
  const anim = ring.animate(o.reverse ? [out[1], out[0]] : out,
    { duration: o.dur || 420, easing: 'cubic-bezier(.2,.7,.3,1)' });
  const done = () => ring.remove();
  anim.finished.then(done).catch(done);
}

/* Particles spawned on a circle, flying INWARD to converge on (x, y)
   right as their life ends — "energy gathering" (dream summons). */
function _converge(x, y, o = {}) {
  if (FX_REDUCED || !_fxCanvas()) return;
  const n = Math.max(0, Math.min(o.n || 20, _PARTS.MAX - _PARTS.list.length));
  const colors = o.colors || ['#ffffff'];
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rad = (o.radius || 120) * (0.7 + Math.random() * 0.6);
    const life = (o.life || 700) * (0.8 + Math.random() * 0.4);
    const speed = rad / (life / 1000);          // arrives as it fades
    _PARTS.list.push({
      x: x + Math.cos(ang) * rad,
      y: y + Math.sin(ang) * rad,
      vx: -Math.cos(ang) * speed,
      vy: -Math.sin(ang) * speed,
      grav: 0, drag: 1,
      life, fade: 160,
      size: (o.size || 3) * (0.6 + Math.random() * 0.8),
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: o.shape || 'spark',
      rot: 0, vr: 0,
      alpha: o.alpha != null ? o.alpha : 1,
    });
  }
  if (!_PARTS.raf && _PARTS.list.length) {
    _PARTS.last = performance.now();
    _PARTS.raf = requestAnimationFrame(_fxTick);
  }
}

/* ---------- dim overlay (cinematics) ---------- */
let _dimEl = null;
function _setDim(alpha, ms = 300) {
  if (typeof document === 'undefined' || FX_REDUCED) return;
  if (!_dimEl) {
    _dimEl = document.createElement('div');
    _dimEl.id = 'fx-dim';
    document.body.appendChild(_dimEl);
  }
  _dimEl.style.transitionDuration = ms + 'ms';
  _dimEl.style.opacity = alpha;
}

/* Full-field tint flash (biome sweeps, frost). Cleans itself up. */
function _tintFlash(rect, color, ms = 900) {
  if (typeof document === 'undefined' || FX_REDUCED || !rect) return;
  const t = document.createElement('div');
  t.className = 'fx-sweep';
  t.style.left = rect.left + 'px';
  t.style.top = rect.top + 'px';
  t.style.width = rect.width + 'px';
  t.style.height = rect.height + 'px';
  t.style.background = color;
  document.body.appendChild(t);
  const anim = t.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }],
    { duration: ms, easing: 'ease-in-out' });
  const done = () => t.remove();
  anim.finished.then(done).catch(done);
}

const FX = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),

  /* net.js relays every effect named here (they all take (el, opts)
     with JSON-safe opts). RELAY = fire-and-forget; RELAY_AWAIT = the
     guest awaits them, preserving the host's cinematic pacing. */
  RELAY: ['burst', 'shockRing', 'dust', 'slash', 'sparkle', 'deathBurst',
          'retreatWisp', 'emberBurn', 'lavaBurst', 'frostWash', 'biomeSweep'],
  RELAY_AWAIT: ['meteorStrike', 'legendarySummon', 'cardReveal'],

  /* Hearthstone-style play reveal: the card swells up center-screen so
     everyone SEES what was just played, holds a beat, then swirls away.
     `o` = { side: engine idx of who played, card: JSON-safe card data }.
     Each viewer skips reveals of their OWN plays (they know what they
     clicked); the relay ships it to the guest, which flips the viewer. */
  async cardReveal(el, o = {}) {
    if (typeof document === 'undefined' || !o.card) return;
    const viewerIdx = (typeof NET !== 'undefined' && NET.isGuest && NET.isGuest()) ? 1 : 0;
    if (o.side === viewerIdx) return;
    if (typeof fullCardHTML !== 'function') return;
    const wrap = document.createElement('div');
    wrap.className = 'card-reveal';
    wrap.innerHTML = `<div class="card-reveal-inner">${fullCardHTML(o.card, 'big-card')}</div>`;
    document.body.appendChild(wrap);
    try {
      const inner = wrap.firstElementChild;
      const inMs = FX_REDUCED ? 80 : 260;
      const holdMs = FX_REDUCED ? 250 : 950;
      const outMs = FX_REDUCED ? 80 : 280;
      inner.animate(
        [{ transform: 'scale(.45) rotate(-5deg)', opacity: 0 },
         { transform: 'scale(1.06) rotate(1deg)', opacity: 1, offset: 0.75 },
         { transform: 'scale(1)', opacity: 1 }],
        { duration: inMs, easing: 'cubic-bezier(.2,.8,.3,1.15)' });
      await FX.sleep(inMs + holdMs);
      const out = inner.animate(
        [{ transform: 'scale(1)', opacity: 1 },
         { transform: 'scale(.6) translateY(-40px)', opacity: 0 }],
        { duration: outMs, easing: 'cubic-bezier(.5,0,.8,.4)' });
      await out.finished.catch(() => {});
    } finally {
      wrap.remove();
    }
  },

  /* Board-wide shake. `intensity` in px (~6 chip, ~24 huge), `dur` ms. */
  screenShake(intensity = 8, dur = 300) {
    _runScreenShake(intensity, dur);
  },

  /* The fallen leader BREAKS APART like a slain creature: a violent
     rattle, then the panel shatters into shards that tumble away. The
     game-over overlay WAITS for this (checkWin / guest applySnapshot).
     Not relayed — each side runs its own from the winner in its state.
     hideGameOver() restores the panel for the next game. */
  async heroDeath(el) {
    if (typeof document === 'undefined' || !el) return;
    _setDim(0.6, 350);
    _runScreenShake(18, 700);
    if (typeof SFX !== 'undefined') SFX.rumble();

    /* 1. death rattle */
    el.classList.add('hero-dying');
    await FX.sleep(FX_REDUCED ? 120 : 450);
    el.classList.remove('hero-dying');

    /* 2. shatter: hide the real panel, fling clipped shard-clones of it */
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (typeof SFX !== 'undefined') SFX.shatter();
    _emit(cx, cy, {
      n: 30, colors: ['#cdb891', '#8a7248', '#c62828', '#6d5b41'], shape: 'spark',
      speed: 260, grav: 500, life: 950, size: 3.5,
    });
    el.style.visibility = 'hidden';
    const shards = [];
    const N = 3;                       // 3×3 grid of shards
    if (!FX_REDUCED) {
      for (let gy = 0; gy < N; gy++) {
        for (let gx = 0; gx < N; gx++) {
          const s = el.cloneNode(true);
          s.removeAttribute('id');
          s.classList.remove('hero-dying');
          s.style.cssText =
            `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
            'margin:0;z-index:930;pointer-events:none;visibility:visible;';
          const x0 = (gx / N) * 100, x1 = ((gx + 1) / N) * 100;
          const y0 = (gy / N) * 100, y1 = ((gy + 1) / N) * 100;
          s.style.clipPath = `polygon(${x0}% ${y0}%, ${x1}% ${y0}%, ${x1}% ${y1}%, ${x0}% ${y1}%)`;
          document.body.appendChild(s);
          shards.push(s);
          /* fling each shard away from the panel's center, tumbling */
          const dx = (gx - 1) * (55 + Math.random() * 50) + (Math.random() * 24 - 12);
          const dy = (gy - 1) * 45 + 90 + Math.random() * 70;   // gravity pulls all down
          const rot = (Math.random() * 70 - 35).toFixed(1);
          s.animate(
            [{ transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
             { transform: `translate(${dx * 0.6}px, ${dy * 0.25}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.4 },
             { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 }],
            { duration: 1300 + Math.random() * 300, easing: 'cubic-bezier(.3,.4,.6,1)', fill: 'forwards' });
        }
      }
    }
    await FX.sleep(FX_REDUCED ? 300 : 1650);
    for (const s of shards) s.remove();
    _setDim(0, 500);
    /* stays broken (hidden) until hideGameOver() restores it */
  },

  /* Hitstop: a brief freeze so a hit "lands" with weight. */
  hitstop(ms = 70) {
    return FX.sleep(ms);
  },

  /* Impact punch on `el`: flash + shockwave pop + spark spray + board
     shake scaled by `mag` (~1 normal hit, ~2.5 huge). `el` may be null
     for a screen-only tremor. */
  impact(el, mag = 1) {
    if (typeof document === 'undefined') return;
    _runScreenShake(Math.min(24, 6 + 7 * mag), 240 + 80 * mag);
    if (!el) return;
    el.classList.add('hit-flash');
    setTimeout(() => el.classList.remove('hit-flash'), 300);
    const c = _centerOf(el);
    if (!c) return;
    _ring(c.x, c.y, { size: 70, scale: 0.8 + 0.6 * mag, dur: 320 + 60 * mag });
    _emit(c.x, c.y, {
      n: Math.round(6 + 9 * mag),
      colors: ['#fff6c8', '#ffd54f', '#ff9d3c'],
      shape: 'spark',
      speed: 260 + 150 * mag,
      grav: 720, life: 420, size: 2.5 + mag,
    });
  },

  /* Attacker wind-up → beat → dash → recoil → glide home. `power` (its
     effective ATK) scales the whole thing: heavy hitters (6+) coil
     longer, rumble, and kick up a dust trail. The dash duration scales
     with the DISTANCE to cover, so a cross-board charge glides instead
     of teleporting, and it eases out of the coil into the strike.

     Resolves AT THE MOMENT OF CONTACT and returns { settled } — the
     caller can land damage numbers/shake exactly on the hit while the
     bounce-off and glide home play out in the background (await
     `settled` before re-rendering the attacker or it doubles up).

     The flight happens on a FIXED-POSITION CLONE appended to <body>
     (z 550) while the real card hides. The battle rows clip their
     content (`overflow: hidden`, so cards can't spill into the
     neighbouring row at rest) — a clone above everything can never
     be swallowed when it crosses into the opposing field. */
  async lunge(fromEl, toEl, power = 1) {
    const noop = { settled: Promise.resolve() };
    if (!fromEl || !toEl || typeof document === 'undefined') return noop;
    const a = fromEl.getBoundingClientRect();
    const b = toEl.getBoundingClientRect();
    if (!a.width || !b.width) return noop;
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const bx = -dx / dist, by = -dy / dist;      // pull-back direction
    const heavy = power >= 6;

    const wind    = FX_REDUCED ? 80 : heavy ? 300 : 200;
    const hold    = FX_REDUCED ? 0  : heavy ? 100 : 60;   // beat at full coil
    const dash    = FX_REDUCED ? 90 :
      Math.round(Math.max(170, Math.min(320, dist * (heavy ? 0.36 : 0.42))));
    const recoil  = FX_REDUCED ? 0   : 90;
    const recover = FX_REDUCED ? 100 : 220;

    const ghost = fromEl.cloneNode(true);
    ghost.classList.add('lunge-ghost');
    ghost.classList.remove('ready', 'selected', 'targetable', 'spawn');
    ghost.style.left = a.left + 'px';
    ghost.style.top = a.top + 'px';
    ghost.style.width = a.width + 'px';
    ghost.style.height = a.height + 'px';
    document.body.appendChild(ghost);
    fromEl.style.visibility = 'hidden';

    /* Strike pose: lean into the travel, stretched slightly along it. */
    const lean = (dx / dist) * 5;
    const stretch = Math.abs(dy) >= Math.abs(dx) ? 'scale(1.03, 1.1)' : 'scale(1.1, 1.03)';

    /* 1. wind-up: rear back and settle into the coil, then hold a beat
       so the launch reads as a decision, not a glitch. */
    ghost.style.transition = `transform ${wind}ms cubic-bezier(.2,.7,.3,1)`;
    ghost.style.transform =
      `translate(${bx * (12 + power * 2.5)}px, ${by * (12 + power * 2.5)}px) ` +
      `rotate(${bx * -5}deg) scale(${heavy ? 1.12 : 1.06})`;
    if (heavy && typeof SFX !== 'undefined') SFX.rumble();
    await FX.sleep(wind + hold);

    /* 2. dash: accelerate out of the coil, decelerate into the target. */
    if (heavy && typeof SFX !== 'undefined') SFX.whoosh();
    ghost.style.transition = `transform ${dash}ms cubic-bezier(.5,0,.15,1)`;
    ghost.style.transform = `translate(${dx * 0.78}px, ${dy * 0.78}px) rotate(${lean}deg) ${stretch}`;
    if (heavy) {
      const c = _centerOf(ghost);
      if (c) {
        _emit(c.x, c.y, {
          n: 10, colors: ['#cdb891', '#8a7248', '#6d5b41'], shape: 'dot',
          speed: 120, grav: 300, life: 480, size: 4, alpha: 0.7,
          angle: Math.atan2(-dy, -dx), spread: 1.1,
        });
      }
    }
    await FX.sleep(dash);
    toEl.classList.add('hit-flash');

    /* Contact! Resolve now; bounce off and glide home in the background. */
    const settled = (async () => {
      try {
        if (recoil) {
          ghost.style.transition = `transform ${recoil}ms cubic-bezier(.2,.8,.4,1)`;
          ghost.style.transform = `translate(${dx * 0.62}px, ${dy * 0.62}px) rotate(${lean * -0.4}deg)`;
          await FX.sleep(recoil);
        }
        ghost.style.transition = `transform ${recover}ms cubic-bezier(.45,0,.3,1)`;
        ghost.style.transform = '';
        await FX.sleep(recover);
        toEl.classList.remove('hit-flash');
      } finally {
        ghost.remove();
        fromEl.style.visibility = '';
      }
    })();
    return { settled };
  },

  /* Floating number/text above an element (damage, heals, buffs). */
  floatText(el, text, cls = 'dmg') {
    if (!el || typeof document === 'undefined') return;
    const r = el.getBoundingClientRect();
    const n = document.createElement('div');
    n.className = 'float-num ' + cls;
    n.textContent = text;
    n.style.left = (r.left + r.width / 2) + 'px';
    n.style.top = (r.top + r.height * 0.2) + 'px';
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1100);
  },

  /* Brief shake (invalid action, leader hit). */
  shake(el) {
    if (!el) return;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 420);
  },

  /* ============ relayable particle effects (el, opts) ============ */

  /* Generic radial burst at an element's centre. */
  burst(el, o = {}) {
    const c = _centerOf(el) || _fieldCenter();
    if (c) _emit(c.x, c.y, o);
  },

  /* Parametrized shockwave ring at an element's centre. */
  shockRing(el, o = {}) {
    const c = _centerOf(el) || _fieldCenter();
    if (c) _ring(c.x, c.y, o);
  },

  /* Small summoning dust poof under a freshly played creature. */
  dust(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y + (c.r ? c.r.height * 0.3 : 20), {
      n: o.n || 12, colors: ['#cdb891', '#8a7248', '#6d5b41'],
      shape: 'dot', speed: 130, grav: 240, life: 550, size: 4, alpha: 0.75,
      angle: -Math.PI / 2, spread: 2.4,
    });
  },

  /* Quick claw-slash for targeted strikes (Predator Ambush). */
  slash(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y, {
      n: 12, colors: ['#ffffff', '#ff5f52', '#ffd54f'], shape: 'spark',
      speed: 330, grav: 260, life: 340, size: 3.2,
      angle: Math.PI / 4, spread: 0.5,
    });
    _emit(c.x, c.y, {
      n: 8, colors: ['#ffffff', '#ff5f52'], shape: 'spark',
      speed: 300, grav: 260, life: 300, size: 3,
      angle: (3 * Math.PI) / 4, spread: 0.5,
    });
    _ring(c.x, c.y, { size: 52, scale: 1.5, color: 'rgba(255,95,82,.8)', dur: 300 });
  },

  /* Rising good-magic sparkles (heals, buffs, rally). */
  sparkle(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y, {
      n: o.n || 14,
      colors: o.colors || ['#b9f6ca', '#7ee081', '#fff6c8'],
      shape: 'spark', speed: 95, grav: -170, life: 800, size: 2.6,
      spread: Math.PI, angle: -Math.PI / 2, jitter: 26,
    });
  },

  /* The card breaks: bone shards + dark puff + a pale ring. */
  deathBurst(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y, {
      n: 16, colors: ['#e8dcc8', '#bdb1a0', '#8a7f70', '#5d5348'],
      shape: 'shard', speed: 250, grav: 780, life: 720, size: 5,
    });
    _emit(c.x, c.y, {
      n: 10, colors: ['#3a3128', '#241a10'], shape: 'dot',
      speed: 100, grav: -70, life: 850, size: 6, alpha: 0.45,
    });
    _ring(c.x, c.y, { size: 70, scale: 1.6, color: 'rgba(232,220,200,.55)', dur: 380 });
  },

  /* Cold blue wisps drifting up as a creature loses heart and flees. */
  retreatWisp(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y, {
      n: 16, colors: ['#bfe3ff', '#9fd4ff', '#e8f4ff'], shape: 'dot',
      speed: 80, grav: -140, life: 950, size: 4, alpha: 0.7,
      spread: Math.PI, angle: -Math.PI / 2, jitter: 30, drag: 0.99,
    });
  },

  /* Volcanic-biome burn tick: embers curl up off the creature. */
  emberBurn(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y + 8, {
      n: 8, colors: ['#ff9d3c', '#ff5722', '#ffd54f'], shape: 'ember',
      speed: 70, grav: -130, life: 700, size: 3, alpha: 0.9,
      spread: 1.6, angle: -Math.PI / 2, jitter: 22,
    });
  },

  /* Eruption: a violent gout of lava and rock on one target. */
  lavaBurst(el, o = {}) {
    const c = _centerOf(el);
    if (!c) return;
    _emit(c.x, c.y, {
      n: 22, colors: ['#ffd54f', '#ff9d3c', '#ff5722', '#c62828'],
      shape: 'ember', speed: 330, grav: 640, life: 750, size: 4.5,
    });
    _emit(c.x, c.y, {
      n: 10, colors: ['#5d5348', '#3a3128'], shape: 'shard',
      speed: 260, grav: 800, life: 650, size: 5,
    });
    _ring(c.x, c.y, { size: 90, scale: 2, color: 'rgba(255,140,40,.9)', dur: 450 });
    _runScreenShake(12, 350);
  },

  /* Ice Age wash: a frost tint over a board + drifting snow. */
  frostWash(el, o = {}) {
    if (typeof document === 'undefined') return;
    const root = el || document.getElementById('battlefield');
    const c = _centerOf(root);
    if (!c) return;
    _tintFlash(c.r, 'linear-gradient(180deg, rgba(160,215,255,.35), rgba(160,215,255,.08))', 1100);
    for (let i = 0; i < 3; i++) {
      _emit(c.r.left + c.r.width * Math.random(), c.r.top + 6, {
        n: 10, colors: ['#ffffff', '#dcecff', '#bfe3ff'], shape: 'dot',
        speed: 40, grav: 70, life: 1500, size: 2.6, alpha: 0.9,
        spread: 0.8, angle: Math.PI / 2, jitter: c.r.width / 3, drag: 0.997,
      });
    }
  },

  /* Biome played: a themed particle sweep across the battlefield. */
  biomeSweep(el, o = {}) {
    const fc = _fieldCenter();
    if (!fc) return;
    const r = fc.r;
    const kind = String(o.kind || '');
    const presets = {
      ocean:    { colors: ['rgba(140,200,255,.85)', '#bfe3ff', '#7fb3d5'], shape: 'bubble', up: true,  tint: 'linear-gradient(180deg, rgba(46,134,193,.25), transparent)' },
      jungle:   { colors: ['#7cb342', '#4caf50', '#2e7d32'],               shape: 'leaf',   up: false, tint: 'linear-gradient(180deg, rgba(76,175,80,.2), transparent)' },
      fern:     { colors: ['#ffd54f', '#d4ac2b', '#fff6c8'],               shape: 'dot',    up: false, tint: 'linear-gradient(180deg, rgba(212,172,43,.18), transparent)' },
      tundra:   { colors: ['#ffffff', '#dcecff', '#bfe3ff'],               shape: 'dot',    up: false, tint: 'linear-gradient(180deg, rgba(160,215,255,.28), transparent)' },
      volcanic: { colors: ['#ff9d3c', '#ff5722', '#ffd54f'],               shape: 'ember',  up: true,  tint: 'linear-gradient(0deg, rgba(198,40,40,.28), transparent)' },
    };
    let p = presets.fern;
    if (kind.includes('ocean') || kind.includes('panthalassa')) p = presets.ocean;
    else if (kind.includes('jungle') || kind.includes('carboniferous')) p = presets.jungle;
    else if (kind.includes('tundra') || kind.includes('glacial')) p = presets.tundra;
    else if (kind.includes('volcanic')) p = presets.volcanic;
    _tintFlash(r, p.tint, 1000);
    for (let i = 0; i < 5; i++) {
      _emit(r.left + r.width * Math.random(), p.up ? r.bottom - 8 : r.top + 8, {
        n: 9, colors: p.colors, shape: p.shape,
        speed: p.up ? 90 : 45, grav: p.up ? -110 : 80,
        life: 1400, size: p.shape === 'bubble' ? 4 : 3.2, alpha: 0.9,
        spread: 0.9, angle: p.up ? -Math.PI / 2 : Math.PI / 2,
        jitter: r.width / 4, drag: 0.996,
      });
    }
  },

  /* ============ awaited cinematics ============ */

  /* Meteor Impact: sky darkens, the rock screams in, detonates. */
  async meteorStrike(el, o = {}) {
    if (typeof document === 'undefined') return;
    const c = _centerOf(el) || _fieldCenter();
    if (!c) return;
    if (typeof SFX !== 'undefined') SFX.meteorFall();
    _setDim(0.45, 200);
    const m = document.createElement('div');
    m.className = 'fx-meteor';
    document.body.appendChild(m);
    const sx = c.x + Math.min(520, window.innerWidth * 0.4);
    const sy = c.y - Math.min(560, window.innerHeight * 0.7);
    const anim = m.animate(
      [{ transform: `translate(${sx}px, ${sy}px) scale(.45)`, opacity: 0 },
       { transform: `translate(${sx * 0.4 + c.x * 0.6}px, ${sy * 0.4 + c.y * 0.6}px) scale(.85)`, opacity: 1, offset: 0.45 },
       { transform: `translate(${c.x}px, ${c.y}px) scale(1.05)`, opacity: 1 }],
      { duration: FX_REDUCED ? 250 : 700, easing: 'cubic-bezier(.5,0,.9,.4)' });
    try { await anim.finished; } catch (e) { /* interrupted */ }
    m.remove();
    if (typeof SFX !== 'undefined') SFX.explosion();
    _ring(c.x, c.y, { size: 160, scale: 3, color: 'rgba(255,160,60,.95)', dur: 650 });
    _emit(c.x, c.y, {
      n: 44, colors: ['#ffd54f', '#ff9d3c', '#ff5722', '#fff6c8'],
      shape: 'ember', speed: 430, grav: 620, life: 900, size: 5,
    });
    _emit(c.x, c.y, {
      n: 20, colors: ['#5d5348', '#3a3128'], shape: 'shard',
      speed: 340, grav: 820, life: 800, size: 6,
    });
    _runScreenShake(26, 700);
    await FX.hitstop(110);
    _setDim(0, 500);
  },

  /* Legendary summon dispatcher: each legendary gets its own entrance.
     `o.kind` is the card's template id (passed by the engine and
     relayed to multiplayer guests automatically). */
  async legendarySummon(el, o = {}) {
    if (typeof document === 'undefined') return;
    const kind = String(o.kind || '');
    if (kind === 'hallucigenia') return _summonDream(el, o);
    if (kind === 'spinosaurus') return _summonSplash(el, o);
    return _summonStomp(el, o);   // T-rex (and default for future giants)
  },
};

/* Resolve a possibly re-rendered creature element by uid. */
function _summonFinder(el) {
  const uid = el && el.dataset ? el.dataset.uid : null;
  return () => (uid != null && typeof elByUid === 'function' ? elByUid(uid) : el) || el;
}

/* ---- T-rex: the lights go down, something enormous approaches —
   three building footsteps — then it lands with a board-smashing
   slam, a dust fan, a shock ring and a roar. ---- */
async function _summonStomp(el, o = {}) {
    const findEl = _summonFinder(el);

    _setDim(0.55, 260);
    if (typeof SFX !== 'undefined') SFX.rumble();
    await FX.sleep(FX_REDUCED ? 80 : 260);

    /* approaching footsteps, each closer and harder */
    const steps = FX_REDUCED ? 1 : 3;
    for (let i = 0; i < steps; i++) {
      if (typeof SFX !== 'undefined') SFX.footstep();
      _runScreenShake(7 + i * 6, 320);
      const cur = findEl();
      const c = _centerOf(cur) || _fieldCenter();
      if (c) {
        _emit(c.x + (Math.random() - 0.5) * 140, c.y + 42, {
          n: 6, colors: ['#cdb891', '#8a7248'], shape: 'dot',
          speed: 90, grav: 250, life: 500, size: 4, alpha: 0.7,
          angle: -Math.PI / 2, spread: 1.6,
        });
      }
      await FX.sleep(FX_REDUCED ? 120 : 330);
    }

    /* the beast lands */
    const landEl = findEl();
    if (landEl) {
      landEl.classList.remove('pre-summon');
      try {
        const drop = landEl.animate(
          [{ transform: 'translateY(-160px) scale(1.8)', opacity: 0.25, filter: 'brightness(2)' },
           { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'brightness(1)' }],
          { duration: FX_REDUCED ? 120 : 230, easing: 'cubic-bezier(.35,0,.8,.4)' });
        await drop.finished;
      } catch (e) { /* re-rendered mid-flight — fine */ }
    }
    if (typeof SFX !== 'undefined') { SFX.slam(); SFX.roar(); }
    const c2 = _centerOf(findEl()) || _fieldCenter();
    if (c2) {
      _ring(c2.x, c2.y, { size: 140, scale: 2.8, color: 'rgba(255,213,79,.95)', dur: 600 });
      _emit(c2.x, c2.y + 22, {
        n: 30, colors: ['#cdb891', '#8a7248', '#6d5b41', '#ffd54f'],
        shape: 'dot', speed: 330, grav: 640, life: 750, size: 5,
        spread: Math.PI, angle: -Math.PI / 2,
      });
      _emit(c2.x, c2.y, {
        n: 14, colors: ['#fff6c8', '#ffd54f'], shape: 'spark',
        speed: 380, grav: 700, life: 500, size: 4,
      });
    }
    _runScreenShake(24, 650);
    await FX.hitstop(120);
    _setDim(0, 550);
}

/* ---- Hallucigenia: it doesn't arrive, it MANIFESTS. A violet hush,
   dream-motes spiralling inward, a contracting ring — then the card
   blurs into existence with a hue-shifted shimmer. ---- */
async function _summonDream(el, o = {}) {
  const findEl = _summonFinder(el);

  _setDim(0.4, 300);
  if (typeof SFX !== 'undefined') SFX.mystic();
  const c = _centerOf(findEl()) || _fieldCenter();
  if (c) {
    _converge(c.x, c.y, {
      n: 28, colors: ['#c084fc', '#8e44ad', '#bfe3ff', '#ffffff'],
      radius: 140, life: 720, size: 3, shape: 'spark',
    });
    _ring(c.x, c.y, { size: 150, scale: 2, color: 'rgba(192,132,252,.8)', dur: 700, reverse: true });
  }
  await FX.sleep(FX_REDUCED ? 150 : 700);

  const landEl = findEl();
  if (landEl) {
    landEl.classList.remove('pre-summon');
    try {
      const appear = landEl.animate(
        [{ opacity: 0, transform: 'scale(1.28)', filter: 'blur(9px) hue-rotate(90deg) brightness(1.9)' },
         { opacity: 1, transform: 'scale(.96)', filter: 'blur(1px) hue-rotate(25deg) brightness(1.25)', offset: 0.7 },
         { opacity: 1, transform: 'scale(1)', filter: 'blur(0px) hue-rotate(0deg) brightness(1)' }],
        { duration: FX_REDUCED ? 150 : 560, easing: 'ease-out' });
      await appear.finished;
    } catch (e) { /* re-rendered mid-shimmer — fine */ }
  }
  const c2 = _centerOf(findEl()) || c;
  if (c2) {
    _emit(c2.x, c2.y, {
      n: 18, colors: ['#c084fc', '#e8dcff', '#8e44ad'],
      shape: 'spark', speed: 150, grav: -70, life: 850, size: 2.6,
    });
    _ring(c2.x, c2.y, { size: 90, scale: 1.9, color: 'rgba(192,132,252,.7)', dur: 500 });
  }
  if (typeof SFX !== 'undefined') SFX.sparkleSfx();
  _setDim(0, 420);
}

/* ---- Spinosaurus: the river king. Water gathers under the slot
   (blue wash, rising bubbles, a low rumble) — then it BURSTS up from
   the depths in a fountain of spray, droplets raining back down. ---- */
async function _summonSplash(el, o = {}) {
  const findEl = _summonFinder(el);

  _setDim(0.35, 250);
  if (typeof SFX !== 'undefined') SFX.rumble();
  const c = _centerOf(findEl()) || _fieldCenter();
  if (c) {
    _tintFlash(c.r, 'radial-gradient(circle, rgba(46,134,193,.4), rgba(46,134,193,.05))', 950);
    _emit(c.x, c.y + 30, {
      n: 16, colors: ['rgba(140,200,255,.9)', '#bfe3ff'],
      shape: 'bubble', speed: 85, grav: -140, life: 720, size: 3.5,
      spread: 1.6, angle: -Math.PI / 2, jitter: 44,
    });
  }
  await FX.sleep(FX_REDUCED ? 120 : 620);

  const landEl = findEl();
  if (landEl) {
    landEl.classList.remove('pre-summon');
    try {
      const rise = landEl.animate(
        [{ transform: 'translateY(130px) scale(.7)', opacity: 0, filter: 'saturate(2.2) brightness(1.4)' },
         { transform: 'translateY(-14px) scale(1.06)', opacity: 1, offset: 0.72 },
         { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'none' }],
        { duration: FX_REDUCED ? 150 : 420, easing: 'cubic-bezier(.2,.8,.3,1)' });
      await rise.finished;
    } catch (e) { /* re-rendered mid-breach — fine */ }
  }
  if (typeof SFX !== 'undefined') SFX.splash();
  const c2 = _centerOf(findEl()) || c;
  if (c2) {
    _ring(c2.x, c2.y, { size: 130, scale: 2.4, color: 'rgba(120,190,255,.9)', dur: 550 });
    /* the splash fountain: spray shoots up, droplets rain back down */
    _emit(c2.x, c2.y + 20, {
      n: 34, colors: ['#bfe3ff', '#7fb3d5', '#e8f4ff', 'rgba(140,200,255,.9)'],
      shape: 'dot', speed: 390, grav: 920, life: 820, size: 3.6,
      spread: 1.5, angle: -Math.PI / 2,
    });
    _emit(c2.x, c2.y, {
      n: 14, colors: ['rgba(140,200,255,.8)'],
      shape: 'bubble', speed: 160, grav: -60, life: 900, size: 4,
    });
  }
  _runScreenShake(14, 450);
  await FX.hitstop(90);
  _setDim(0, 450);
}
