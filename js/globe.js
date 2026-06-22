/**
 * globe.js — 3D paleogeographic globe renderer.
 *
 * Requires d3 as a browser global (loaded via CDN <script> before the module).
 * Fetches coastlines live from the GPlates Web Service (gws.gplates.org),
 * EarthByte Group, model MERDITH2021 (Merdith et al. 2021, ESR).
 * Falls back to baked approximations (js/geo/*.js) when offline or outside
 * model range. Coverage: ~1000 Ma to present; older periods show fallbacks.
 *
 * Easter egg: at exactly 66 Ma the Chicxulub impactor streaks in.
 */

const GWS          = 'https://gws.gplates.org/reconstruct/coastlines/';
const MODEL        = 'MERDITH2021';
const CACHE_PREFIX = 'ae-coast-v1-';
const AMBER        = '#C97B3D';
const CHICXULUB    = [-89.54, 21.3];

/* ---- GeoJSON helpers ---- */

function fixWinding(feature) {
  const a = d3.geoArea(feature);
  if (a > 2 * Math.PI) {
    feature.geometry.coordinates.forEach(r => r.reverse());
  }
  return feature;
}

function simplify(geo) {
  const feats = [];
  for (const f of (geo.features ?? [])) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon'      ? [g.coordinates]
                : g.type === 'MultiPolygon' ?  g.coordinates : [];
    for (const rings of polys) {
      const ring = rings[0];
      if (!ring || ring.length < 8) continue;
      const step = Math.max(1, Math.floor(ring.length / 240));
      const out  = [];
      for (let i = 0; i < ring.length; i += step) {
        out.push([Math.round(ring[i][0] * 100) / 100,
                  Math.round(ring[i][1] * 100) / 100]);
      }
      out.push(out[0].slice());
      const feat = { type: 'Feature', properties: {},
                     geometry: { type: 'Polygon', coordinates: [out] } };
      fixWinding(feat);
      if (d3.geoArea(feat) < 1e-4) continue;
      feats.push(feat);
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

function rgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---- Baked fallbacks (nearest-age selection) ---- */

function collectBaked() {
  const list = [];
  if (window.AE_BAKED_105) list.push({ ma: 105, data: window.AE_BAKED_105 });
  if (window.CRETACEOUS)   list.push({ ma: 90,  data: window.CRETACEOUS   });
  if (window.PANGAEA)      list.push({ ma: 220, data: window.PANGAEA       });
  list.forEach(b => b.data.features.forEach(fixWinding));
  return list;
}

/* ================================================================
   Globe class
   ================================================================ */

export class Globe {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {number} opts.startMa   — older bound (larger Ma)
   * @param {number} opts.endMa     — newer bound (smaller Ma)
   * @param {number} [opts.size]    — canvas size in px (default: auto from CSS)
   */
  constructor({ canvas, startMa, endMa, size }) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.startMa  = startMa;
    this.endMa    = endMa;

    const mid = Math.round((startMa + endMa) / 2);
    this.opts = {
      time:      Math.max(endMa, Math.min(startMa, mid)),
      speed:     1,
      ink:       '#26221E',
      land:      '#5B8A6B',
      ocean:     '#BFD8E4',
      landStyle: 'filled',
      graticule: true,
    };

    this._baked      = collectBaked();
    this._world      = this._fallbackFor(this.opts.time);
    this._loadedFor  = null;
    this._wantTime   = this.opts.time;
    this._loadTimer  = null;
    this._rafId      = null;
    this._last       = performance.now();

    // Rotation + drag state
    this._lambda   = 0;
    this._phi      = -16;
    this._vLambda  = 0;
    this._vPhi     = 0;
    this._dragging = false;
    this._lastX    = 0;
    this._lastY    = 0;
    this._lastMove = 0;

    // Impact easter egg
    this._impactGeo   = [-71, 22];
    this._impactClock = 0;

    this._initProjection(size);
    this._initDrag();
    this._reconstructImpact();
    this._load(this.opts.time);
  }

  /* ---- setup ---- */

  _initProjection(size) {
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const S    = size || Math.max(this.canvas.offsetWidth, 320);
    this._dpr  = dpr;
    this._S    = S;
    this._C    = S / 2;
    this._R    = S * 0.42;
    this._U    = S / 200;

    this.canvas.width        = S * dpr;
    this.canvas.height       = S * dpr;
    this.canvas.style.width  = S + 'px';
    this.canvas.style.height = S + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._proj   = d3.geoOrthographic().clipAngle(90).precision(0.3)
                     .translate([this._C, this._C]).scale(this._R);
    this._path   = d3.geoPath(this._proj, this.ctx);
    this._grat   = d3.geoGraticule().step([15, 15])();
    this._sphere = { type: 'Sphere' };
  }

  _initDrag() {
    const onDown = (e) => {
      this._dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this._lastX    = e.clientX;
      this._lastY    = e.clientY;
      this._lastMove = performance.now();
      this._vLambda  = 0;
      this._vPhi     = 0;
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!this._dragging) return;
      const now = performance.now();
      const dx  = e.clientX - this._lastX;
      const dy  = e.clientY - this._lastY;
      const dms = Math.max(now - this._lastMove, 1);
      const k   = 90 / this._R;
      this._lambda    += dx * k;
      this._phi        = Math.max(-90, Math.min(90, this._phi - dy * k));
      this._vLambda    = (dx * k) / dms;
      this._vPhi       = (-dy * k) / dms;
      this._lastX      = e.clientX;
      this._lastY      = e.clientY;
      this._lastMove   = now;
    };

    const onEnd = () => {
      if (!this._dragging) return;
      this._dragging = false;
      this.canvas.style.cursor = 'grab';
      if (performance.now() - this._lastMove > 120) { this._vLambda = 0; this._vPhi = 0; }
      this._vLambda = Math.max(-0.4, Math.min(0.4, this._vLambda));
      this._vPhi    = Math.max(-0.4, Math.min(0.4, this._vPhi));
    };

    this._onDown = onDown;
    this._onMove = onMove;
    this._onEnd  = onEnd;
    this.canvas.addEventListener('pointerdown',   onDown);
    this.canvas.addEventListener('pointermove',   onMove);
    this.canvas.addEventListener('pointerup',     onEnd);
    this.canvas.addEventListener('pointercancel', onEnd);
    this.canvas.style.cursor      = 'grab';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.userSelect  = 'none';
  }

  /* ---- data loading ---- */

  _fallbackFor(ma) {
    if (!this._baked.length) return { type: 'FeatureCollection', features: [] };
    return this._baked.reduce((best, b) =>
      Math.abs(b.ma - ma) < Math.abs(best.ma - ma) ? b : best
    ).data;
  }

  _evictOldCaches() {
    const mine = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CACHE_PREFIX)) mine.push(k);
    }
    mine.slice(0, Math.max(mine.length - 6, 0))
        .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
  }

  _load(ma) {
    if (this._loadedFor === ma) return;
    const key = CACHE_PREFIX + MODEL + '-' + ma;
    try {
      const cached = localStorage.getItem(key);
      if (cached) { this._world = JSON.parse(cached); this._loadedFor = ma; return; }
    } catch (_) {}

    this._world = this._fallbackFor(ma);
    const ctrl   = window.AbortController ? new AbortController() : null;
    const killer = ctrl && setTimeout(() => ctrl.abort(), 12000);

    fetch(GWS + '?time=' + ma + '&model=' + MODEL,
          ctrl ? { signal: ctrl.signal } : {})
      .then(r  => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(geo => {
        const simple = simplify(geo);
        if (!simple.features.length) throw new Error('empty');
        this._world     = simple;
        this._loadedFor = ma;
        try { localStorage.setItem(key, JSON.stringify(simple)); }
        catch (_) {
          this._evictOldCaches();
          try { localStorage.setItem(key, JSON.stringify(simple)); } catch (_2) {}
        }
      })
      .catch(() => { /* keep fallback */ })
      .finally(() => { if (killer) clearTimeout(killer); });
  }

  _scheduleLoad(ma) {
    clearTimeout(this._loadTimer);
    this._loadTimer = setTimeout(() => this._load(ma), 350);
  }

  _reconstructImpact() {
    const key = 'ae-impact-v1-' + MODEL + '-66';
    try {
      const c = localStorage.getItem(key);
      if (c) { this._impactGeo = JSON.parse(c); return; }
    } catch (_) {}
    fetch(`https://gws.gplates.org/reconstruct/reconstruct_points/` +
          `?points=${CHICXULUB[0]},${CHICXULUB[1]}&time=66&model=${MODEL}`)
      .then(r   => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(geo => {
        const c = geo?.coordinates?.[0];
        if (c && isFinite(c[0]) && isFinite(c[1])) {
          this._impactGeo = c;
          try { localStorage.setItem(key, JSON.stringify(c)); } catch (_) {}
        }
      })
      .catch(() => {});
  }

  /* ---- drawing ---- */

  _drawImpact() {
    const { ctx, opts, _impactGeo: site, _impactClock: ph, _U: U } = this;
    if (d3.geoDistance(site, [-this._lambda, -this._phi]) > 1.35) return;
    const p = this._proj(site);
    if (!p) return;
    const [x, y] = p;

    if (ph < 0.18) {
      const k  = (ph / 0.18) ** 2;
      const ox = 36 * U * (1 - k), oy = -48 * U * (1 - k);
      const mx = x + ox,           my = y + oy;
      const g  = ctx.createLinearGradient(mx + ox * 0.5, my + oy * 0.5, mx, my);
      g.addColorStop(0, rgba(AMBER, 0));
      g.addColorStop(1, rgba(AMBER, 0.85));
      ctx.beginPath(); ctx.moveTo(mx + ox * 0.5, my + oy * 0.5); ctx.lineTo(mx, my);
      ctx.strokeStyle = g; ctx.lineWidth = 1.6 * U; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.arc(mx, my, 2.2 * U, 0, Math.PI * 2);
      ctx.fillStyle = rgba(opts.ink, 0.92); ctx.fill();

    } else if (ph < 0.55) {
      const e = (ph - 0.18) / 0.37;
      if (e < 0.3) {
        ctx.beginPath(); ctx.arc(x, y, 7 * U * (e / 0.3), 0, Math.PI * 2);
        ctx.fillStyle = rgba(AMBER, 0.85 * (1 - e / 0.3)); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(x, y, (3 + 24 * e) * U, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(AMBER, 0.75 * (1 - e)); ctx.lineWidth = 1.6 * U; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, (2 + 16 * e) * U, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(opts.ink, 0.4 * (1 - e)); ctx.lineWidth = U; ctx.stroke();
      ctx.strokeStyle = rgba(AMBER, 0.8 * (1 - e));
      ctx.lineWidth = 1.2 * U; ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const ang = i * Math.PI / 4 + 0.3;
        const r1  = (5 + 18 * e) * U;
        const r2  = r1 + (2 + 7 * (1 - e)) * U;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * r1, y + Math.sin(ang) * r1);
        ctx.lineTo(x + Math.cos(ang) * r2, y + Math.sin(ang) * r2);
        ctx.stroke();
      }
    } else {
      const q = (ph - 0.55) / 0.45;
      ctx.beginPath(); ctx.arc(x, y, (4 + 12 * q) * U, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(opts.ink, 0.22 * (1 - q)); ctx.lineWidth = U; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 1.9 * U, 0, Math.PI * 2);
      ctx.fillStyle = rgba(AMBER, 0.9 - 0.5 * q); ctx.fill();
    }
  }

  _draw() {
    const { ctx, opts } = this;
    const { _S: S, _U: U } = this;
    ctx.clearRect(0, 0, S, S);

    ctx.beginPath(); this._path(this._sphere);
    ctx.fillStyle = opts.ocean; ctx.fill();

    if (opts.graticule) {
      ctx.beginPath(); this._path(this._grat);
      ctx.strokeStyle = rgba(opts.ink, 0.12);
      ctx.lineWidth   = 0.5 * Math.max(U, 1);
      ctx.stroke();
    }

    ctx.beginPath(); this._path(this._world);
    if (opts.landStyle === 'outline') {
      ctx.fillStyle   = rgba(opts.land, 0.30);
      ctx.fill();
      ctx.strokeStyle = opts.land;
      ctx.lineWidth   = Math.max(1.1 * U * 0.75, 1);
      ctx.lineJoin    = 'round';
      ctx.stroke();
    } else {
      ctx.fillStyle = opts.land;
      ctx.fill();
    }

    ctx.beginPath(); this._path(this._sphere);
    ctx.strokeStyle = rgba(opts.ink, 0.85);
    ctx.lineWidth   = 1.25 * U;
    ctx.stroke();

    if (opts.time === 66) this._drawImpact();
  }

  _tick(now) {
    const dt = Math.min(now - this._last, 100);
    this._last = now;

    // Pick up time changes from setTime()
    if (this.opts.time !== this._wantTime) {
      this._wantTime = this.opts.time;
      this._scheduleLoad(this.opts.time);
    }

    // Auto-spin: positive lambda = globe rotates right (west-to-east as seen by viewer)
    const autoV = 0.020 * this.opts.speed;
    if (!this._dragging) {
      const blend   = 1 - Math.exp(-dt / 700);
      this._vLambda += (autoV  - this._vLambda) * blend;
      this._vPhi    += (0      - this._vPhi)    * blend;
      this._lambda  += this._vLambda * dt;
      this._phi      = Math.max(-90, Math.min(90, this._phi + this._vPhi * dt));
    }

    if (this.opts.time === 66) {
      this._impactClock = (this._impactClock +
        dt * 0.00022 * Math.max(this.opts.speed, 0.4)) % 1;
    }

    this._proj.rotate([this._lambda, this._phi]);
    this._draw();
  }

  /* ---- public API ---- */

  start() {
    if (this._rafId) return;
    this._wantTime = this.opts.time;
    this._last     = performance.now();
    const frame    = (now) => { this._rafId = requestAnimationFrame(frame); this._tick(now); };
    this._rafId    = requestAnimationFrame(frame);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    clearTimeout(this._loadTimer);
    this.canvas.removeEventListener('pointerdown',   this._onDown);
    this.canvas.removeEventListener('pointermove',   this._onMove);
    this.canvas.removeEventListener('pointerup',     this._onEnd);
    this.canvas.removeEventListener('pointercancel', this._onEnd);
  }

  setTime(ma) {
    this.opts.time = Math.max(this.endMa, Math.min(this.startMa, Math.round(ma)));
    this._scheduleLoad(this.opts.time);
  }

  setOption(key, value) {
    this.opts[key] = value;
  }
}
