// Astronomy math. Low-precision but plenty accurate for a naked-eye sky map.
// Based on the well-known algorithms of Paul Schlyter (stjarnhimlen.se).

const RAD = Math.PI / 180;
const rev = (x) => ((x % 360) + 360) % 360;     // normalise to 0..360
const sind = (d) => Math.sin(d * RAD);
const cosd = (d) => Math.cos(d * RAD);
const atan2d = (y, x) => Math.atan2(y, x) / RAD;
const asind = (v) => Math.asin(v) / RAD;

// Day number (and fractional day) since 2000 Jan 0.0 TT, from a JS Date (uses UTC).
export function dayNumber(date) {
  const Y = date.getUTCFullYear(), M = date.getUTCMonth() + 1, D = date.getUTCDate();
  const UT = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const d = 367 * Y
    - Math.floor((7 * (Y + Math.floor((M + 9) / 12))) / 4)
    + Math.floor((275 * M) / 9) + D - 730530;
  return d + UT / 24;
}

// Local sidereal time in hours, given longitude (deg, east positive).
export function localSiderealTime(date, lonDeg) {
  const d = dayNumber(date);
  const UT = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Sun's mean longitude
  const w = 282.9404 + 4.70935e-5 * d;
  const M = rev(356.0470 + 0.9856002585 * d);
  const Ls = rev(w + M);
  const GMST0 = (Ls + 180) / 15;            // hours
  const LST = GMST0 + UT + lonDeg / 15;
  return ((LST % 24) + 24) % 24;
}

// Equatorial (RA hours, Dec deg) -> horizontal (alt deg, az deg from N through E).
export function eqToHorizon(raHours, decDeg, latDeg, lstHours) {
  const ha = rev((lstHours - raHours) * 15);  // hour angle in degrees
  const alt = asind(sind(decDeg) * sind(latDeg) + cosd(decDeg) * cosd(latDeg) * cosd(ha));
  let az = atan2d(sind(ha), cosd(ha) * sind(latDeg) - Math.tan(decDeg * RAD) * cosd(latDeg));
  az = rev(az + 180);                          // measured from North, through East
  return { alt, az };
}

const obliquity = (d) => 23.4393 - 3.563e-7 * d;

// Solve Kepler, return ecliptic rectangular heliocentric coords + distance.
function orbit(N, i, w, a, e, M) {
  M = rev(M);
  let E = M + (180 / Math.PI) * e * sind(M) * (1 + e * cosd(M));
  for (let k = 0; k < 8; k++) {
    E = E - (E - (180 / Math.PI) * e * sind(E) - M) / (1 - e * cosd(E));
  }
  const xv = a * (cosd(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * sind(E));
  const v = rev(atan2d(yv, xv));
  const r = Math.sqrt(xv * xv + yv * yv);
  const xh = r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i));
  const yh = r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i));
  const zh = r * (sind(v + w) * sind(i));
  return { xh, yh, zh, r, v };
}

// Sun: returns {ra (hours), dec (deg), lon (deg), r, xs, ys}
function sunPos(d) {
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = rev(356.0470 + 0.9856002585 * d);
  let E = M + (180 / Math.PI) * e * sind(M) * (1 + e * cosd(M));
  const xv = cosd(E) - e;
  const yv = Math.sqrt(1 - e * e) * sind(E);
  const v = rev(atan2d(yv, xv));
  const r = Math.sqrt(xv * xv + yv * yv);
  const lon = rev(v + w);
  const xs = r * cosd(lon), ys = r * sind(lon);
  const ecl = obliquity(d);
  const xe = xs, ye = ys * cosd(ecl), ze = ys * sind(ecl);
  const ra = rev(atan2d(ye, xe)) / 15;
  const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
  return { ra, dec, lon, r, xs, ys };
}

export function getSun(date) {
  const d = dayNumber(date);
  const s = sunPos(d);
  return { id: "sun", n: "Sun", type: "sun", ra: s.ra, dec: s.dec, mag: -26.7 };
}

// Moon with the principal perturbation terms (so phase & position are good).
export function getMoon(date) {
  const d = dayNumber(date);
  const N = rev(125.1228 - 0.0529538083 * d);
  const i = 5.1454;
  const w = rev(318.0634 + 0.1643573223 * d);
  const a = 60.2666;
  const e = 0.054900;
  const M = rev(115.3654 + 13.0649929509 * d);
  const o = orbit(N, i, w, a, e, M);
  // ecliptic lon/lat of the Moon
  let lon = rev(atan2d(o.yh, o.xh));
  let lat = atan2d(o.zh, Math.sqrt(o.xh * o.xh + o.yh * o.yh));
  let r = o.r;
  // Sun elements for perturbations
  const Ms = rev(356.0470 + 0.9856002585 * d);
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ls = rev(ws + Ms);
  const Lm = rev(N + w + M);
  const D = rev(Lm - Ls);
  const F = rev(Lm - N);
  lon += -1.274 * sind(M - 2 * D);
  lon += 0.658 * sind(2 * D);
  lon += -0.186 * sind(Ms);
  lon += -0.059 * sind(2 * M - 2 * D);
  lon += -0.057 * sind(M - 2 * D + Ms);
  lon += 0.053 * sind(M + 2 * D);
  lon += 0.046 * sind(2 * D - Ms);
  lon += 0.041 * sind(M - Ms);
  lon += -0.035 * sind(D);
  lon += -0.031 * sind(M + Ms);
  lon += -0.015 * sind(2 * F - 2 * D);
  lon += 0.011 * sind(M - 4 * D);
  lat += -0.173 * sind(F - 2 * D);
  lat += -0.055 * sind(M - F - 2 * D);
  lat += -0.046 * sind(M + F - 2 * D);
  lat += 0.033 * sind(F + 2 * D);
  lat += 0.017 * sind(2 * M + F);
  lon = rev(lon);
  // ecliptic -> equatorial (geocentric)
  const ecl = obliquity(d);
  const xg = r * cosd(lon) * cosd(lat);
  const yg = r * sind(lon) * cosd(lat);
  const zg = r * sind(lat);
  const xe = xg;
  const ye = yg * cosd(ecl) - zg * sind(ecl);
  const ze = yg * sind(ecl) + zg * cosd(ecl);
  const ra = rev(atan2d(ye, xe)) / 15;
  const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
  // phase: elongation from Sun
  const s = sunPos(d);
  const elong = rev(lon - s.lon);
  const illum = (1 - cosd(elong)) / 2;       // 0 new .. 1 full
  const waxing = elong < 180;
  return { id: "moon", n: "Moon", type: "moon", ra, dec, mag: -10, illum, waxing, phaseName: moonPhaseName(elong) };
}

function moonPhaseName(elong) {
  if (elong < 22.5 || elong >= 337.5) return "New Moon";
  if (elong < 67.5) return "Waxing Crescent";
  if (elong < 112.5) return "First Quarter";
  if (elong < 157.5) return "Waxing Gibbous";
  if (elong < 202.5) return "Full Moon";
  if (elong < 247.5) return "Waning Gibbous";
  if (elong < 292.5) return "Last Quarter";
  return "Waning Crescent";
}

const PLANETS = {
  Mercury: { N: [48.3313, 3.24587e-5], i: [7.0047, 5.00e-8], w: [29.1241, 1.01444e-5], a: [0.387098, 0], e: [0.205635, 5.59e-10], M: [168.6562, 4.0923344368] , col:"#c8b39a", mag:-0.4},
  Venus:   { N: [76.6799, 2.46590e-5], i: [3.3946, 2.75e-8], w: [54.8910, 1.38374e-5], a: [0.723330, 0], e: [0.006773, -1.302e-9], M: [48.0052, 1.6021302244], col:"#e8d9a8", mag:-4.4},
  Mars:    { N: [49.5574, 2.11081e-5], i: [1.8497, -1.78e-8], w: [286.5016, 2.92961e-5], a: [1.523688, 0], e: [0.093405, 2.516e-9], M: [18.6021, 0.5240207766], col:"#d2674a", mag:0.9},
  Jupiter: { N: [100.4542, 2.76854e-5], i: [1.3030, -1.557e-7], w: [273.8777, 1.64505e-5], a: [5.20256, 0], e: [0.048498, 4.469e-9], M: [19.8950, 0.0830853001], col:"#d9c5a0", mag:-2.3},
  Saturn:  { N: [113.6634, 2.38980e-5], i: [2.4886, -1.081e-7], w: [339.3939, 2.97661e-5], a: [9.55475, 0], e: [0.055546, -9.499e-9], M: [316.9670, 0.0334442282], col:"#e0d2a0", mag:0.7},
  Uranus:  { N: [74.0005, 1.3978e-5], i: [0.7733, 1.9e-8], w: [96.6612, 3.0565e-5], a: [19.18171, -1.55e-8], e: [0.047318, 7.45e-9], M: [142.5905, 0.011725806], col:"#9fd6d2", mag:5.7},
  Neptune: { N: [131.7806, 3.0173e-5], i: [1.7700, -2.55e-7], w: [272.8461, -6.027e-6], a: [30.05826, 3.313e-8], e: [0.008606, 2.15e-9], M: [260.2471, 0.005995147], col:"#6f8fe0", mag:7.8},
};

export function getPlanets(date) {
  const d = dayNumber(date);
  const ecl = obliquity(d);
  const s = sunPos(d);
  const out = [];
  for (const [name, p] of Object.entries(PLANETS)) {
    const N = p.N[0] + p.N[1] * d;
    const i = p.i[0] + p.i[1] * d;
    const w = p.w[0] + p.w[1] * d;
    const a = p.a[0] + p.a[1] * d;
    const e = p.e[0] + p.e[1] * d;
    const M = p.M[0] + p.M[1] * d;
    const o = orbit(N, i, w, a, e, M);
    // geocentric ecliptic rectangular (add Sun's coords)
    const xg = o.xh + s.xs;
    const yg = o.yh + s.ys;
    const zg = o.zh;
    const xe = xg;
    const ye = yg * cosd(ecl) - zg * sind(ecl);
    const ze = yg * sind(ecl) + zg * cosd(ecl);
    const ra = rev(atan2d(ye, xe)) / 15;
    const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));
    out.push({ id: name, n: name, type: "planet", ra, dec, mag: p.mag, col: p.col });
  }
  return out;
}

// Approximate altitude of the Sun -> used for twilight shading.
export function sunAltitude(date, latDeg, lonDeg) {
  const sun = getSun(date);
  const lst = localSiderealTime(date, lonDeg);
  return eqToHorizon(sun.ra, sun.dec, latDeg, lst).alt;
}

/* ================= observing helpers (telescope toolkit) ================= */

// Angular separation between two equatorial positions (RA in hours, Dec in deg),
// in degrees. Spherical law of cosines, clamped against rounding.
export function angularSep(ra1, dec1, ra2, dec2) {
  const cosSep =
    sind(dec1) * sind(dec2) +
    cosd(dec1) * cosd(dec2) * cosd((ra1 - ra2) * 15);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) / RAD;
}

// Altitude of a fixed equatorial position at a given instant.
function altAt(ra, dec, date, latDeg, lonDeg) {
  return eqToHorizon(ra, dec, latDeg, localSiderealTime(date, lonDeg)).alt;
}

/**
 * Next rise / transit / set for an object over the coming 24 h.
 * `obj` needs {ra, dec} (fine for stars/DSOs; planets/Moon move slowly enough
 * for chart-grade times). Returns
 *   { rise:Date|null, riseAz, set:Date|null, setAz, transit:Date, transitAlt,
 *     circumpolar:boolean, neverUp:boolean }
 */
export function riseTransitSet(obj, date, latDeg, lonDeg) {
  const STEP = 10 * 60 * 1000; // 10-min scan
  const t0 = date.getTime();
  let rise = null, set = null;
  let best = { t: t0, alt: -90 };
  let prevAlt = altAt(obj.ra, obj.dec, new Date(t0), latDeg, lonDeg);
  let anyUp = prevAlt > 0, anyDown = prevAlt <= 0;

  for (let t = t0 + STEP; t <= t0 + 24 * 3600 * 1000; t += STEP) {
    const alt = altAt(obj.ra, obj.dec, new Date(t), latDeg, lonDeg);
    if (alt > best.alt) best = { t, alt };
    if (alt > 0) anyUp = true; else anyDown = true;
    if (!rise && prevAlt <= 0 && alt > 0) rise = bisectHorizon(obj, t - STEP, t, latDeg, lonDeg);
    if (!set && prevAlt > 0 && alt <= 0) set = bisectHorizon(obj, t - STEP, t, latDeg, lonDeg);
    prevAlt = alt;
  }

  // Refine the transit around the best 10-min sample with 1-min steps.
  for (let t = best.t - STEP; t <= best.t + STEP; t += 60 * 1000) {
    const alt = altAt(obj.ra, obj.dec, new Date(t), latDeg, lonDeg);
    if (alt > best.alt) best = { t, alt };
  }

  const azOf = (d) => {
    const lst = localSiderealTime(d, lonDeg);
    return eqToHorizon(obj.ra, obj.dec, latDeg, lst).az;
  };
  return {
    rise, riseAz: rise ? azOf(rise) : null,
    set, setAz: set ? azOf(set) : null,
    transit: new Date(best.t), transitAlt: best.alt,
    circumpolar: anyUp && !anyDown,
    neverUp: anyDown && !anyUp,
  };
}

function bisectHorizon(obj, tLo, tHi, latDeg, lonDeg) {
  // ~30 s accuracy — plenty for planning an observing session.
  for (let k = 0; k < 12; k++) {
    const mid = (tLo + tHi) / 2;
    const altLo = altAt(obj.ra, obj.dec, new Date(tLo), latDeg, lonDeg);
    const altMid = altAt(obj.ra, obj.dec, new Date(mid), latDeg, lonDeg);
    if ((altLo <= 0) === (altMid <= 0)) tLo = mid; else tHi = mid;
  }
  return new Date((tLo + tHi) / 2);
}

/**
 * Best viewing window tonight: the object's highest moment while the sky is
 * astronomically dark (sun below -12°), scanning the next 24 h.
 * Returns { time:Date, alt } or null if it's never up in darkness.
 */
export function bestWindow(obj, date, latDeg, lonDeg) {
  const STEP = 10 * 60 * 1000;
  const t0 = date.getTime();
  let best = null;
  for (let t = t0; t <= t0 + 24 * 3600 * 1000; t += STEP) {
    const d = new Date(t);
    if (sunAltitude(d, latDeg, lonDeg) > -12) continue;
    const alt = altAt(obj.ra, obj.dec, d, latDeg, lonDeg);
    if (alt > 0 && (!best || alt > best.alt)) best = { time: d, alt };
  }
  return best;
}
