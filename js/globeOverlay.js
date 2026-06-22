/**
 * globeOverlay.js — "View 3D Map" overlay panel.
 * Builds its DOM inside the #globe-overlay element, creates a Globe instance
 * when shown, and tears it down when hidden.
 */

import { Globe } from './globe.js';

const LAND_PRESETS  = ['#5B8A6B', '#42704F', '#86A37C', '#71875A', '#000000'];
const OCEAN_PRESETS = ['#BFD8E4', '#A3C4D6', '#85AEC6', '#1a2a38', '#ffffff'];

export class GlobeOverlay {
  constructor(overlayEl) {
    this.overlay = overlayEl;
    this._globe  = null;
    this._build();
  }

  _build() {
    const e = (tag, cls) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      return n;
    };

    const modal = e('div', 'globe-modal');

    /* -- header -- */
    const header   = e('div', 'globe-modal-header');
    this._titleEl  = e('h3',  'globe-modal-title');
    const closeBtn = e('button', 'globe-close');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close 3D map');
    closeBtn.addEventListener('click', () => this.hide());
    header.append(this._titleEl, closeBtn);

    /* -- canvas -- */
    this._canvas = e('canvas', 'globe-canvas');

    /* -- controls -- */
    const controls = e('div', 'globe-controls');

    // Time slider
    this._timeDisplay = e('span', 'globe-ctrl-val');
    this._timeSlider  = e('input');
    Object.assign(this._timeSlider, { type: 'range', className: 'globe-slider', step: '1' });
    this._timeSlider.addEventListener('input', () => {
      const ma = Number(this._timeSlider.value);
      this._timeDisplay.textContent = ma + ' Ma';
      this._globe?.setTime(ma);
    });
    controls.appendChild(
      this._ctrlRow('Time', [this._timeSlider, this._timeDisplay])
    );

    // Speed slider
    this._speedSlider = e('input');
    Object.assign(this._speedSlider, { type: 'range', className: 'globe-slider',
      min: '0', max: '3', step: '0.1', value: '1' });
    this._speedSlider.addEventListener('input', () => {
      this._globe?.setOption('speed', Number(this._speedSlider.value));
    });
    controls.appendChild(this._ctrlRow('Speed', [this._speedSlider]));

    // Land color
    this._landSwatches = this._swatchGroup(LAND_PRESETS, '#5B8A6B', color => {
      this._globe?.setOption('land', color);
    });
    controls.appendChild(this._ctrlRow('Land', [this._landSwatches]));

    // Ocean color
    this._oceanSwatches = this._swatchGroup(OCEAN_PRESETS, '#BFD8E4', color => {
      this._globe?.setOption('ocean', color);
    });
    controls.appendChild(this._ctrlRow('Ocean', [this._oceanSwatches]));

    // Land style
    this._styleSegment = this._segControl(['filled', 'outline'], 'filled', style => {
      this._globe?.setOption('landStyle', style);
    });
    controls.appendChild(this._ctrlRow('Style', [this._styleSegment]));

    // Graticule toggle
    let gratOn = true;
    this._gratBtn = e('button', 'globe-toggle active');
    this._gratBtn.textContent = 'On';
    this._gratBtn.addEventListener('click', () => {
      gratOn = !gratOn;
      this._globe?.setOption('graticule', gratOn);
      this._gratBtn.textContent = gratOn ? 'On' : 'Off';
      this._gratBtn.classList.toggle('active', gratOn);
    });
    controls.appendChild(this._ctrlRow('Grid', [this._gratBtn]));

    /* -- credits -- */
    const credits = e('div', 'globe-credits');
    const gplates = e('a');
    Object.assign(gplates, {
      href: 'https://gws.gplates.org/',
      target: '_blank',
      rel: 'noopener noreferrer',
      textContent: 'GPlates Web Service',
    });
    const earthbyte = e('a');
    Object.assign(earthbyte, {
      href: 'https://www.earthbyte.org/',
      target: '_blank',
      rel: 'noopener noreferrer',
      textContent: 'EarthByte Group',
    });
    const merdith = e('a');
    Object.assign(merdith, {
      href: 'https://doi.org/10.1016/j.earscirev.2020.103477',
      target: '_blank',
      rel: 'noopener noreferrer',
      textContent: 'MERDITH2021 model',
    });
    credits.append(
      document.createTextNode('Coastline data: '),
      gplates, document.createTextNode(' · '),
      earthbyte, document.createTextNode(' · '),
      merdith,
    );

    modal.append(header, this._canvas, controls, credits);
    this.overlay.appendChild(modal);

    // Close on backdrop click or Escape
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && !this.overlay.hidden) this.hide(); });
  }

  _ctrlRow(label, nodes) {
    const e   = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };
    const row = e('div', 'globe-ctrl-row');
    const lbl = e('span', 'globe-ctrl-label');
    lbl.textContent = label;
    row.appendChild(lbl);
    nodes.forEach(n => row.appendChild(n));
    return row;
  }

  _swatchGroup(presets, activeColor, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'globe-swatches';
    presets.forEach(color => {
      const btn = document.createElement('button');
      btn.className = 'globe-swatch' + (color === activeColor ? ' active' : '');
      btn.style.background = color;
      btn.title = color === '#000000' ? 'Black'
                : color.toLowerCase() === '#ffffff' ? 'White'
                : color;
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('.globe-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(color);
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  _segControl(options, active, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'globe-seg';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'globe-seg-btn' + (opt === active ? ' active' : '');
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('.globe-seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(opt);
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  show(period) {
    this._titleEl.textContent =
      `${period.name} · Paleogeographic Map`;

    // Time slider bounds + step
    const span = period.startMa - period.endMa;
    const step = Math.max(1, Math.round(span / 200));
    const mid  = Math.round((period.startMa + period.endMa) / 2);
    this._timeSlider.min   = String(period.endMa);
    this._timeSlider.max   = String(period.startMa);
    this._timeSlider.step  = String(step);
    this._timeSlider.value = String(mid);
    this._timeDisplay.textContent = mid + ' Ma';

    // Reset speed slider
    this._speedSlider.value = '1';

    // Reset graticule toggle
    this._gratBtn.textContent = 'On';
    this._gratBtn.classList.add('active');

    // Compute canvas size: fill available space minus chrome
    const maxW = window.innerWidth  - 64;
    const maxH = window.innerHeight - 320;
    const size = Math.max(280, Math.min(maxW, maxH, 520));

    // Show overlay before sizing so layout is live
    this.overlay.hidden = false;
    document.body.style.overflow = 'hidden';

    // Destroy previous globe
    this._globe?.destroy();
    this._globe = null;

    // Build new globe
    this._globe = new Globe({
      canvas:  this._canvas,
      startMa: period.startMa,
      endMa:   period.endMa,
      size,
    });
    this._globe.start();
  }

  hide() {
    this.overlay.hidden = true;
    document.body.style.overflow = '';
    this._globe?.destroy();
    this._globe = null;
  }
}
