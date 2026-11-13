// JARVIS is a continuous Canvas hologram. The shared sidekick supplies poses, presence and sizes;
// paths are drawn directly in CSS coordinates on its Retina-scaled canvas, without an LED grid.
(() => {
  const R = window.Roamie;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

  // HUD glyphs for the blob's moments, drawn as read-outs beside the globe: heart, bolt, alarm, anger, flame.
  const GLYPH = {
    heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
    bolt: ['...##', '..##.', '.##..', '#####', '..##.', '.##..', '##...'],
    excl: ['##', '##', '##', '##', '..', '##'],
    clock: ['..###..', '.#...#.', '#..#..#', '#..##.#', '#.....#', '.#...#.', '..###..'],
    anger: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
    flame: ['..#...', '..##..', '.###.#', '.#####', '######', '##.###', '#...##', '.####.'],
  };

  R.jarvis = {
    // Voice level: rises while it talks or hears you, settles to a slow breath otherwise.
    level(st) {
      const t = st.t;
      if (st.mode === 'talk' && st.voice != null) return clamp(0.3 + st.voice * 0.9, 0, 1); // the real voice
      if (st.mode === 'talk') return clamp(0.45 + 0.35 * Math.abs(Math.sin(t * 11.3)) * Math.abs(Math.sin(t * 2.9 + 1)) + 0.2 * Math.sin(t * 23), 0, 1);
      if (st.mode === 'listen') return clamp(st.heard ?? 0.35 + 0.3 * Math.abs(Math.sin(t * 4.1)), 0, 1);
      if (st.mode === 'think') return 0.25;
      return 0.12 + 0.05 * Math.sin(t * 1.4);
    },

    // No time advances during drawing: sprite capture and multiple paints share exactly one pose.
    // Motion preferences arrive from core.js's live prefers-reduced-motion media query.
    draw(ctx, cx, cy, radius, st, cursor = false, hx = cx, hy = cy) {
      const still = st.reduced || st.quiet, t = still ? 0 : st.t;
      const busy = st.mode === 'talk' || st.mode === 'listen';
      const v = still ? (busy ? 0.35 : 0.12) : this.level(st);
      const spin = still ? 0 : (st.spin ?? 0), sleepy = st.sleepy > 0.5;
      const accent = st.act === 'upset' ? '#f6a897' : st.act === 'remind' ? '#f4ce8a' : st.mode === 'think' ? '#9dc7ff' : '#95f5e7';
      const breath = still ? 1 : 1 + Math.sin(t * 1.4) * 0.012;
      const r = radius * breath * (1 + (busy ? v * 0.045 : 0));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(r, r);
      const alpha = ctx.globalAlpha;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.018, 0.9 / radius);
      const halo = ctx.createRadialGradient(0, 0, 0.45, 0, 0, 1.5);
      halo.addColorStop(0, 'rgba(27,151,162,0.12)');
      halo.addColorStop(0.6, st.quiet ? 'rgba(44,191,189,0.08)' : 'rgba(44,191,189,0.2)');
      halo.addColorStop(1, 'rgba(44,191,189,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, TAU); ctx.fill();
      // A dark translucent body stays legible on white windows as well as dark desktops.
      const shell = ctx.createRadialGradient(-0.3, -0.4, 0.08, 0, 0, 1);
      shell.addColorStop(0, 'rgba(35,100,116,0.82)');
      shell.addColorStop(0.65, 'rgba(8,43,58,0.9)');
      shell.addColorStop(1, 'rgba(4,24,34,0.96)');
      ctx.fillStyle = shell;
      ctx.beginPath(); ctx.arc(0, 0, 0.96, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#235768'; ctx.lineWidth *= 2.2; ctx.stroke();
      ctx.lineWidth /= 2.2;
      ctx.strokeStyle = accent; ctx.globalAlpha *= sleepy ? 0.35 : 0.7;
      if (!cursor) {
        // Latitudes and rotating meridians imply depth with eight paths, not hundreds of cells.
        for (let i = -1; i <= 1; i++) {
          const y = i * 0.4, w = Math.sqrt(0.9 * 0.9 - y * y);
          ctx.beginPath(); ctx.ellipse(0, y, w, 0.23, -0.22, 0, TAU); ctx.stroke();
        }
        for (let i = 0; i < 3; i++) {
          const width = 0.12 + Math.abs(Math.cos(spin + i * TAU / 3)) * 0.76;
          ctx.beginPath(); ctx.ellipse(0, 0, width, 0.9, -0.22, 0, TAU); ctx.stroke();
        }
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = accent;
      const ring = cursor ? 1.08 : 1.12;
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3 + spin * (st.mode === 'think' ? 1.4 : 0.3);
        ctx.beginPath(); ctx.arc(0, 0, ring, a, a + TAU / 3 - 0.28); ctx.stroke();
      }
      // The core closes on a blink, and responds to actual voice energy without a strobe.
      const open = still ? 1 : clamp(st.open, 0.08, 1);
      const x = still ? 0 : st.look[0] * 0.12, y = still ? 0 : st.look[1] * 0.1;
      ctx.fillStyle = sleepy ? '#448e9b' : '#d8fff7';
      ctx.beginPath(); ctx.ellipse(x, y, 0.13 + v * 0.045, (0.13 + v * 0.045) * open, 0, 0, TAU); ctx.fill();
      if (st.mode === 'think' || st.act) {
        ctx.strokeStyle = accent; ctx.lineWidth *= 1.8;
        ctx.beginPath(); ctx.arc(0, 0, 1.24, spin, spin + (st.act ? 1.7 : 0.75)); ctx.stroke();
      }
      ctx.restore();
      if (cursor) {
        ctx.save(); ctx.strokeStyle = '#c6fff3'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        const dx = cx - hx, dy = cy - hy, n = Math.hypot(dx, dy) || 1;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + dx / n * 5, hy + dy / n * 5); ctx.stroke();
        ctx.restore();
      }
    },

    // The blob's moments as HUD read-outs: a bracketed panel with the glyph, a pulsing ring and a short label.
    // Returns nothing; draws with put. gx, gy: the panel's bottom-centre cell.
    readout(k, gx, gy, icon, a, dur, small) {
      const { put, L } = k;
      const rows = GLYPH[icon];
      if (!rows) return;
      const sc = small ? 1 : 2, w = rows[0].length * sc, h = rows.length * sc;
      // Brackets fly out from the glyph and settle; they close again at the end.
      const open = smooth(a / 0.22) * (1 - smooth((a - (dur - 0.2)) / 0.2));
      if (open < 0.02) return;
      const pad = Math.round(2 + 2 * open), x0 = gx - Math.ceil(w / 2) - pad, x1 = gx + Math.floor(w / 2) + pad, y0 = gy - h - pad * 2, y1 = gy;
      const arm = Math.max(1, Math.round(3 * open));
      for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
        for (let i = 0; i <= arm; i++) { put(x + dx * i, y, L - 1); put(x, y + dy * i, L - 1); }
      }
      // A scan line drops through the panel as it opens.
      if (a < 0.4) { const sy = Math.round(y0 + (y1 - y0) * (a / 0.4)); for (let x = x0 + 1; x < x1; x++) put(x, sy, 2); }
      // The glyph: hot cells, flickering in like a projector for its first moment.
      if (a > 0.12) rows.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) if (row[i] === '#') {
          if (a < 0.3 && ((i * 7 + j * 3 + Math.floor(a * 40)) % 3) === 0) continue;
          for (let p = 0; p < sc; p++) for (let q = 0; q < sc; q++) put(gx - Math.ceil(w / 2) + i * sc + q, y0 + pad + j * sc + p, L);
        }
      });
      // A small bar under the panel fills over the moment, like a HUD timer.
      const fill = Math.round((x1 - x0 - 2) * clamp(a / dur, 0, 1));
      for (let x = 0; x <= x1 - x0 - 2; x++) put(x0 + 1 + x, y1 + 2, x <= fill ? 2 : 1);
    },
  };
})();
