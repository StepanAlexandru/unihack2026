// Three procedurally drawn sample facades for laptop / no-camera testing.
// Ornaments are placed where the matching mock scenario's bboxes point, so overlay
// alignment (incl. object-fit: cover cropping) can be verified by eye.
// Drawn as lit stucco (soft shadows, plaster texture, relief ornament) so the demo
// reads as architecture rather than clip art.

const W = 960;
const H = 1280;

const R = (x, y, w, h) => [x * W, y * H, w * W, h * H];

/** Deterministic PRNG: the samples look identical on every load. */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/** Run draw() with a soft cast shadow (light from the top-left). */
function shadowed(ctx, draw, { color = 'rgba(48, 32, 16, 0.42)', blur = 10, dx = 4, dy = 6 } = {}) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx;
  ctx.shadowOffsetY = dy;
  draw();
  ctx.restore();
}

function base(ctx, { sky, wall, wallDark, seed, rusticateFrom = 0.58 }) {
  // sky
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.35);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // wall, lit from the top-left
  const [wx, wy, ww, wh] = R(0.04, 0.08, 0.92, 0.87);
  const wg = ctx.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh);
  wg.addColorStop(0, wall);
  wg.addColorStop(1, wallDark);
  ctx.fillStyle = wg;
  ctx.fillRect(wx, wy, ww, wh);

  // the facade edges recede
  const side = ctx.createLinearGradient(wx, 0, wx + ww, 0);
  side.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
  side.addColorStop(0.07, 'rgba(0, 0, 0, 0)');
  side.addColorStop(0.93, 'rgba(0, 0, 0, 0)');
  side.addColorStop(1, 'rgba(0, 0, 0, 0.26)');
  ctx.fillStyle = side;
  ctx.fillRect(wx, wy, ww, wh);

  // plaster grain
  const rand = rng(seed);
  for (let i = 0; i < 9000; i++) {
    const a = rand() * 0.07;
    ctx.fillStyle = rand() < 0.5 ? `rgba(255, 255, 255, ${a})` : `rgba(60, 40, 20, ${a})`;
    ctx.fillRect(wx + rand() * ww, wy + rand() * wh, 1 + rand() * 2.2, 1 + rand() * 2.2);
  }

  // rusticated ground floor: horizontal joints with a lit lower lip
  for (let y = rusticateFrom; y < 0.945; y += 0.03) {
    ctx.fillStyle = 'rgba(60, 40, 20, 0.22)';
    ctx.fillRect(wx, y * H, ww, 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(wx, y * H + 2, ww, 1);
  }

  // pavement + street
  ctx.fillStyle = '#8d8a85';
  ctx.fillRect(0, H * 0.95, W, H * 0.014);
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(0, H * 0.964, W, H * 0.036);
  const foot = ctx.createLinearGradient(0, H * 0.9, 0, H * 0.95);
  foot.addColorStop(0, 'rgba(0, 0, 0, 0)');
  foot.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = foot;
  ctx.fillRect(wx, H * 0.9, ww, H * 0.05);
}

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(...R(x, y, w, h));
}

/** Projecting cornice with a lit top edge, dentils and a soft shadow on the wall below. */
function cornice(ctx, y, { color, light }) {
  const [x, py, w, h] = R(0.03, y, 0.94, 0.018);
  const sg = ctx.createLinearGradient(0, py + h, 0, py + h + 26);
  sg.addColorStop(0, 'rgba(40, 26, 12, 0.38)');
  sg.addColorStop(1, 'rgba(40, 26, 12, 0)');
  ctx.fillStyle = sg;
  ctx.fillRect(x, py + h, w, 26);
  ctx.fillStyle = color;
  ctx.fillRect(x, py, w, h);
  ctx.fillStyle = light;
  ctx.fillRect(x, py, w, h * 0.32);
  ctx.fillStyle = 'rgba(40, 26, 12, 0.28)';
  for (let dx = x + 8; dx < x + w - 8; dx += 20) ctx.fillRect(dx, py + h * 0.6, 10, h * 0.4);
}

/** Glass pane clipped to `path`: dark gradient, sky reflection, shadow from the reveal. */
function glassPane(ctx, path, px, py, pw, ph, colors) {
  ctx.save();
  path();
  ctx.clip();
  const gg = ctx.createLinearGradient(px, py, px + pw * 0.3, py + ph);
  gg.addColorStop(0, colors[0]);
  gg.addColorStop(1, colors[1]);
  ctx.fillStyle = gg;
  ctx.fillRect(px, py, pw, ph);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#dff1ff';
  ctx.beginPath();
  ctx.moveTo(px + pw * 0.08, py + ph);
  ctx.lineTo(px + pw * 0.5, py);
  ctx.lineTo(px + pw * 0.7, py);
  ctx.lineTo(px + pw * 0.28, py + ph);
  ctx.fill();
  ctx.globalAlpha = 1;
  const rs = ctx.createLinearGradient(0, py, 0, py + 46);
  rs.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  rs.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = rs;
  ctx.fillRect(px, py, pw, 46);
  const ls = ctx.createLinearGradient(px, 0, px + 18, 0);
  ls.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
  ls.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = ls;
  ctx.fillRect(px, py, 18, ph);
  ctx.restore();
}

function sill(ctx, px, py, pw, color) {
  shadowed(ctx, () => {
    ctx.fillStyle = color;
    ctx.fillRect(px - 16, py, pw + 32, 12);
  }, { blur: 6, dy: 5 });
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(px - 16, py, pw + 32, 3);
}

function archWindow(ctx, x, y, w, h, { frame, glass }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  const archPath = (pad) => () => {
    ctx.beginPath();
    ctx.moveTo(px - pad, py + ph + pad * 0.6);
    ctx.lineTo(px - pad, py + pw / 2);
    ctx.arc(px + pw / 2, py + pw / 2, pw / 2 + pad, Math.PI, 0);
    ctx.lineTo(px + pw + pad, py + ph + pad * 0.6);
    ctx.closePath();
  };
  shadowed(ctx, () => {
    ctx.fillStyle = frame;
    archPath(12)();
    ctx.fill();
  });
  // keystone
  shadowed(ctx, () => {
    ctx.fillStyle = frame;
    ctx.beginPath();
    ctx.moveTo(px + pw / 2 - 14, py - 12);
    ctx.lineTo(px + pw / 2 + 14, py - 12);
    ctx.lineTo(px + pw / 2 + 9, py + 16);
    ctx.lineTo(px + pw / 2 - 9, py + 16);
    ctx.closePath();
    ctx.fill();
  }, { blur: 6, dx: 3, dy: 4 });
  glassPane(ctx, archPath(0), px, py, pw, ph, glass);
  ctx.strokeStyle = frame;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px + pw / 2, py);
  ctx.lineTo(px + pw / 2, py + ph);
  ctx.moveTo(px, py + ph * 0.42);
  ctx.lineTo(px + pw, py + ph * 0.42);
  ctx.stroke();
  sill(ctx, px, py + ph + 6, pw, frame);
}

function rectWindow(ctx, x, y, w, h, { frame, glass, pediment }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  shadowed(ctx, () => {
    ctx.fillStyle = frame;
    ctx.fillRect(px - 12, py - 12, pw + 24, ph + 24);
    if (pediment) {
      ctx.beginPath();
      ctx.moveTo(px - 22, py - 14);
      ctx.quadraticCurveTo(px + pw / 2, py - 70, px + pw + 22, py - 14);
      ctx.closePath();
      ctx.fill();
    }
  });
  if (pediment) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px - 20, py - 16);
    ctx.quadraticCurveTo(px + pw / 2, py - 66, px + pw + 20, py - 16);
    ctx.stroke();
  }
  const path = () => {
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
  };
  glassPane(ctx, path, px, py, pw, ph, glass);
  ctx.strokeStyle = frame;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px + pw / 2, py);
  ctx.lineTo(px + pw / 2, py + ph);
  ctx.moveTo(px, py + ph / 3);
  ctx.lineTo(px + pw, py + ph / 3);
  ctx.stroke();
  sill(ctx, px, py + ph + 12, pw, frame);
}

/** Secession maiden mascaron: serene closed-eyed face framed by flowing hair. */
function mask(ctx, cx, cy, r, { skin, shade, hair }) {
  const [x, y] = [cx * W, cy * H];
  const rad = r * W;
  shadowed(ctx, () => {
    ctx.fillStyle = hair;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath();
      ctx.ellipse(x + i * rad * 0.24, y - rad * 0.7 + Math.abs(i) * rad * 0.1, rad * 0.18, rad * 0.5, i * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * rad * 0.74, y + rad * 0.3, rad * 0.2, rad * 0.72, s * -0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  shadowed(ctx, () => {
    const fg = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.4, rad * 0.1, x, y, rad * 1.1);
    fg.addColorStop(0, '#fffaf0');
    fg.addColorStop(1, skin);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(x, y, rad * 0.66, rad * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = shade;
  ctx.fillStyle = shade;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  for (const s of [-1, 1]) {
    ctx.beginPath(); // brow
    ctx.arc(x + s * rad * 0.26, y - rad * 0.12, rad * 0.17, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
    ctx.beginPath(); // closed eye
    ctx.arc(x + s * rad * 0.26, y - rad * 0.1, rad * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.beginPath(); // nose
  ctx.moveTo(x + rad * 0.02, y - rad * 0.02);
  ctx.lineTo(x - rad * 0.06, y + rad * 0.27);
  ctx.lineTo(x + rad * 0.06, y + rad * 0.29);
  ctx.stroke();
  ctx.beginPath(); // lips
  ctx.ellipse(x, y + rad * 0.52, rad * 0.15, rad * 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'butt';
}

function lionHead(ctx, cx, cy, r, { mane, face, shade }) {
  const [x, y] = [cx * W, cy * H];
  const rad = r * W;
  shadowed(ctx, () => {
    ctx.fillStyle = mane;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * rad * 0.72, y + Math.sin(a) * rad * 0.72, rad * 0.36, rad * 0.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  shadowed(ctx, () => {
    const fg = ctx.createRadialGradient(x - rad * 0.2, y - rad * 0.25, rad * 0.05, x, y, rad * 0.7);
    fg.addColorStop(0, '#fff8e8');
    fg.addColorStop(1, face);
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }, { blur: 6, dx: 2, dy: 4 });
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x - rad * 0.22, y - rad * 0.12, rad * 0.07, 0, Math.PI * 2);
  ctx.arc(x + rad * 0.22, y - rad * 0.12, rad * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - rad * 0.14, y + rad * 0.08);
  ctx.lineTo(x + rad * 0.14, y + rad * 0.08);
  ctx.lineTo(x, y + rad * 0.26);
  ctx.fill();
  ctx.strokeStyle = shade; // ring held in the mouth (door-knocker motif)
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y + rad * 0.5, rad * 0.2, 0, Math.PI * 2);
  ctx.stroke();
}

/** Floral stucco frieze: recessed panel with a relief vine of lilies. */
function flowers(ctx, x, y, w, h, { stem, petal, center }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  // recessed panel
  ctx.fillStyle = 'rgba(70, 48, 24, 0.12)';
  ctx.fillRect(px, py, pw, ph);
  const inner = ctx.createLinearGradient(0, py, 0, py + 16);
  inner.addColorStop(0, 'rgba(40, 26, 12, 0.3)');
  inner.addColorStop(1, 'rgba(40, 26, 12, 0)');
  ctx.fillStyle = inner;
  ctx.fillRect(px, py, pw, 16);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.fillRect(px, py + ph - 2, pw, 2);

  const path = (t) => py + ph / 2 + Math.sin(t * Math.PI * 6) * ph * 0.26;
  shadowed(ctx, () => {
    ctx.strokeStyle = stem;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px + 8, path(0));
    for (let i = 1; i <= 60; i++) ctx.lineTo(px + 8 + (i / 60) * (pw - 16), path(i / 60));
    ctx.stroke();
    // leaves along the vine
    ctx.fillStyle = stem;
    for (let i = 0; i < 12; i++) {
      const t = (i + 0.25) / 12;
      const lx = px + 8 + t * (pw - 16);
      ctx.beginPath();
      ctx.ellipse(lx, path(t) + (i % 2 ? 12 : -12), 13, 5, i % 2 ? 0.6 : -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { blur: 5, dx: 2, dy: 3 });
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const fx = px + t * pw;
    const fy = path(t);
    shadowed(ctx, () => {
      ctx.fillStyle = petal;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(a) * 13, fy + Math.sin(a) * 13, 12, 6.5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { blur: 6, dx: 3, dy: 4 });
    ctx.fillStyle = center;
    ctx.beginPath();
    ctx.arc(fx, fy, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.arc(fx - 2, fy - 2, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}

function inscription(ctx, text, x, y, w, h, { plate, ink, font }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  shadowed(ctx, () => {
    ctx.fillStyle = plate;
    ctx.fillRect(px, py, pw, ph);
  });
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(px, py, pw, 3);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(px, py + ph - 3, pw, 3);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 7, py + 7, pw - 14, ph - 14);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = ph * 0.5;
  ctx.font = `600 ${size}px ${font}`;
  while (ctx.measureText(text).width > pw * 0.84 && size > 8) {
    size -= 1;
    ctx.font = `600 ${size}px ${font}`;
  }
  ctx.fillText(text, px + pw / 2, py + ph / 2 + 2);
}

/** Panelled wooden door (or shop door with glazed upper panels). */
function door(ctx, x, y, w, h, { wood, frame, glazed = false }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  shadowed(ctx, () => {
    ctx.fillStyle = frame;
    ctx.fillRect(px - 12, py - 12, pw + 24, ph + 12);
  });
  const wg = ctx.createLinearGradient(px, 0, px + pw, 0);
  wg.addColorStop(0, wood);
  wg.addColorStop(1, '#2c1d12');
  ctx.fillStyle = wg;
  ctx.fillRect(px, py, pw, ph);
  const cols = 2;
  for (let c = 0; c < cols; c++) {
    const cx = px + 12 + c * (pw / cols);
    const cw = pw / cols - 24;
    if (glazed) glassPane(ctx, () => { ctx.beginPath(); ctx.rect(cx, py + 14, cw, ph * 0.45); }, cx, py + 14, cw, ph * 0.45, ['#4a6276', '#1b2630']);
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, glazed ? py + ph * 0.55 : py + 14, cw, glazed ? ph * 0.38 : ph - 28);
  }
  ctx.fillStyle = '#c9a65a';
  ctx.beginPath();
  ctx.arc(px + pw / 2 + 10, py + ph * 0.55, 4, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- the three samples ----------

function drawSecession(ctx) {
  const pal = { frame: '#efe4cc', glass: ['#4d6a84', '#16212c'] };
  base(ctx, { sky: ['#8fb9d8', '#e7d6c0'], wall: '#efe1c4', wallDark: '#cdb791', seed: 11 });
  // curved Secession roofline
  shadowed(ctx, () => {
    ctx.fillStyle = '#efe1c4';
    ctx.beginPath();
    ctx.moveTo(W * 0.04, H * 0.081);
    ctx.quadraticCurveTo(W * 0.5, H * -0.03, W * 0.96, H * 0.081);
    ctx.fill();
  }, { color: 'rgba(30, 40, 60, 0.25)', blur: 14, dx: 0, dy: -2 });
  cornice(ctx, 0.08, { color: '#c2ad86', light: '#fbf3e2' });
  for (const wx of [0.1, 0.6, 0.78]) archWindow(ctx, wx, 0.18, 0.12, 0.17, pal);
  mask(ctx, 0.44, 0.285, 0.065, { skin: '#eadcc0', shade: '#7d6a4c', hair: '#dccaa6' });
  flowers(ctx, 0.12, 0.43, 0.42, 0.1, { stem: '#c8b38c', petal: '#f8eedb', center: '#c9a24e' });
  cornice(ctx, 0.55, { color: '#c2ad86', light: '#fbf3e2' });
  for (const wx of [0.1, 0.3]) archWindow(ctx, wx, 0.6, 0.12, 0.17, pal);
  inscription(ctx, 'GYÓGYSZERTÁR', 0.56, 0.66, 0.3, 0.07, { plate: '#1f3b36', ink: '#e8cb78', font: 'Georgia, serif' });
  door(ctx, 0.6, 0.76, 0.22, 0.19, { wood: '#6b4a2e', frame: '#efe4cc', glazed: true });
}

function drawBaroque(ctx) {
  const pal = { frame: '#f3e6c8', glass: ['#4a5d72', '#19212b'], pediment: true };
  base(ctx, { sky: ['#9cc0da', '#efdcc2'], wall: '#e9c272', wallDark: '#bf9447', seed: 23, rusticateFrom: 0.47 });
  // central gable
  shadowed(ctx, () => {
    ctx.fillStyle = '#e9c272';
    ctx.beginPath();
    ctx.moveTo(W * 0.28, H * 0.081);
    ctx.quadraticCurveTo(W * 0.5, H * -0.01, W * 0.72, H * 0.081);
    ctx.fill();
  }, { color: 'rgba(30, 40, 60, 0.25)', blur: 14, dx: 0, dy: -2 });
  cornice(ctx, 0.08, { color: '#b08a45', light: '#fbecc8' });
  // giant pilasters with lit edges
  for (const px of [0.06, 0.32, 0.65, 0.9]) {
    shadowed(ctx, () => rect(ctx, '#ddb262', px, 0.098, 0.04, 0.85), { blur: 8, dx: 4, dy: 0 });
    rect(ctx, 'rgba(255, 255, 255, 0.22)', px, 0.098, 0.006, 0.85);
  }
  for (const wx of [0.14, 0.74]) rectWindow(ctx, wx, 0.2, 0.12, 0.16, pal);
  // coat of arms (cartouche)
  {
    const [x, y, w, h] = R(0.43, 0.24, 0.14, 0.15);
    shadowed(ctx, () => {
      ctx.fillStyle = '#f6ecd5';
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = '#c9a65a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2 - 8, h / 2 - 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    shadowed(ctx, () => {
      ctx.fillStyle = '#8e2f2a';
      ctx.beginPath();
      ctx.moveTo(x + w * 0.27, y + h * 0.24);
      ctx.lineTo(x + w * 0.73, y + h * 0.24);
      ctx.lineTo(x + w * 0.73, y + h * 0.55);
      ctx.quadraticCurveTo(x + w / 2, y + h * 0.88, x + w * 0.27, y + h * 0.55);
      ctx.closePath();
      ctx.fill();
    }, { blur: 4, dx: 2, dy: 3 });
    ctx.fillStyle = '#e8cb78';
    ctx.fillRect(x + w * 0.465, y + h * 0.29, w * 0.07, h * 0.38);
    ctx.fillRect(x + w * 0.34, y + h * 0.4, w * 0.32, h * 0.07);
  }
  cornice(ctx, 0.44, { color: '#b08a45', light: '#fbecc8' });
  for (const wx of [0.14, 0.74]) rectWindow(ctx, wx, 0.6, 0.12, 0.16, pal);
  // portal
  {
    const [x, y, w, h] = R(0.38, 0.55, 0.24, 0.4);
    shadowed(ctx, () => {
      ctx.fillStyle = '#f3e6c8';
      ctx.fillRect(x, y + w / 2, w, h - w / 2);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
      ctx.fill();
    });
    const iw = w * 0.7;
    const ix = x + (w - iw) / 2;
    const dg = ctx.createLinearGradient(ix, 0, ix + iw, 0);
    dg.addColorStop(0, '#5a3b24');
    dg.addColorStop(1, '#2a1a10');
    ctx.fillStyle = dg;
    ctx.fillRect(ix, y + w / 2 + 10, iw, h - w / 2 - 10);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2 + 10, iw / 2, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 220, 170, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ix + 14, y + w / 2 + 70, iw / 2 - 20, h - w / 2 - 100);
    ctx.strokeRect(x + w / 2 + 6, y + w / 2 + 70, iw / 2 - 20, h - w / 2 - 100);
  }
  lionHead(ctx, 0.5, 0.505, 0.04, { mane: '#cfa95e', face: '#efe2c4', shade: '#5e4628' });
}

function drawContractExample(ctx) {
  const pal = { frame: '#e4ddd2', glass: ['#465a6a', '#172027'] };
  base(ctx, { sky: ['#a9c3d4', '#ddd3c8'], wall: '#e1dace', wallDark: '#b3a999', seed: 37 });
  cornice(ctx, 0.08, { color: '#a49b8e', light: '#f6f2ea' });
  for (const wx of [0.1, 0.62, 0.8]) rectWindow(ctx, wx, 0.18, 0.11, 0.16, pal);
  mask(ctx, 0.39, 0.26, 0.055, { skin: '#e2dbcf', shade: '#6f675b', hair: '#cfc6b6' });
  cornice(ctx, 0.45, { color: '#a49b8e', light: '#f6f2ea' });
  for (const wx of [0.1, 0.8]) rectWindow(ctx, wx, 0.5, 0.11, 0.16, pal);
  inscription(ctx, 'ANNO 1910', 0.4, 0.62, 0.22, 0.06, { plate: '#d6cdbf', ink: '#4c4338', font: 'Georgia, serif' });
  door(ctx, 0.42, 0.72, 0.18, 0.23, { wood: '#5a4232', frame: '#e4ddd2' });
}

export const SAMPLE_FACADES = [
  { id: 'secession', name: 'Secession sample', mockScenario: 'secession', draw: drawSecession },
  { id: 'baroque', name: 'Baroque sample', mockScenario: 'baroque', draw: drawBaroque },
  { id: 'contract', name: 'Contract example', mockScenario: 'contract_example', draw: drawContractExample },
];

export function drawSample(canvas, index) {
  const s = SAMPLE_FACADES[((index % SAMPLE_FACADES.length) + SAMPLE_FACADES.length) % SAMPLE_FACADES.length];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.save();
  s.draw(ctx);
  ctx.restore();
  return s;
}
