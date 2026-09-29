/* util.js — shared helpers. Every module attaches to the SB namespace so the
   same files run in the browser (classic <script>) and in Node (require). */
(function (SB) {
  'use strict';
  const DEG = Math.PI / 180;
  SB.DEG = DEG;
  SB.RAD = 1 / DEG;
  SB.G0 = 9.80665;

  SB.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  SB.lerp = function (a, b, t) { return a + (b - a) * t; };
  SB.wrapPi = function (a) {
    a = a % (2 * Math.PI);
    if (a > Math.PI) a -= 2 * Math.PI;
    else if (a < -Math.PI) a += 2 * Math.PI;
    return a;
  };

  /* smoothstep and its first two derivatives w.r.t. s (s in [0,1]) */
  SB.smoothstep = function (s) {
    s = SB.clamp(s, 0, 1);
    return { v: s * s * (3 - 2 * s), d1: 6 * s * (1 - s), d2: 6 - 12 * s };
  };

  /* Deterministic hash of integer arguments -> [0,1). Used for relight rolls so
     a given plan always replays the same way (the hardware is what it is). */
  SB.hash01 = function () {
    let h = 0x811c9dc5 | 0;
    for (let i = 0; i < arguments.length; i++) {
      let v = arguments[i] | 0;
      for (let k = 0; k < 4; k++) {
        h ^= v & 0xff; v >>>= 8;
        h = Math.imul(h, 0x01000193);
      }
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  SB.strHash = function (s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  };

  SB.fmt = {
    t: function (s) {
      const sign = s < 0 ? '-' : '+';
      s = Math.abs(s);
      const m = Math.floor(s / 60);
      const r = s - m * 60;
      return 'T' + sign + (m > 0 ? m + ':' + (r < 10 ? '0' : '') : '') + r.toFixed(1);
    },
    n: function (v, d) { return (v === undefined || v === null || isNaN(v)) ? '—' : v.toFixed(d === undefined ? 0 : d); },
    sn: function (v, d) { const s = SB.fmt.n(v, d); return (v > 0 ? '+' : '') + s; },
    km: function (m) { return Math.abs(m) >= 10000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; },
    pct: function (f) { return Math.round(f * 100) + '%'; },
    uid: (function () { let n = 1; return function () { return 'a' + (n++); }; })(),
  };
})(globalThis.SB = globalThis.SB || {});
