// Three procedurally drawn sample facades for laptop / no-camera testing.
// Ornaments are placed where the matching mock scenario's bboxes point, so overlay
// alignment (incl. object-fit: cover cropping) can be verified by eye.

const W = 960;
const H = 1280;

function base(ctx, { sky, wall, wallDark }) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const wg = ctx.createLinearGradient(0, 0, W, 0);
  wg.addColorStop(0, wallDark);
  wg.addColorStop(0.5, wall);
  wg.addColorStop(1, wallDark);
  ctx.fillStyle = wg;
  ctx.fillRect(W * 0.04, H * 0.08, W * 0.92, H * 0.92);
  // street
  ctx.fillStyle = '#2b2b30';
  ctx.fillRect(0, H * 0.95, W, H * 0.05);
}

const R = (x, y, w, h) => [x * W, y * H, w * W, h * H];

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(...R(x, y, w, h));
}

function archWindow(ctx, x, y, w, h, { frame, glass }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  ctx.fillStyle = frame;
  ctx.beginPath();
  ctx.moveTo(px - 8, py + ph + 6);
  ctx.lineTo(px - 8, py + pw / 2);
  ctx.arc(px + pw / 2, py + pw / 2, pw / 2 + 8, Math.PI, 0);
  ctx.lineTo(px + pw + 8, py + ph + 6);
  ctx.closePath();
  ctx.fill();
  const gg = ctx.createLinearGradient(px, py, px + pw, py + ph);
  gg.addColorStop(0, glass[0]);
  gg.addColorStop(1, glass[1]);
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.moveTo(px, py + ph);
  ctx.lineTo(px, py + pw / 2);
  ctx.arc(px + pw / 2, py + pw / 2, pw / 2, Math.PI, 0);
  ctx.lineTo(px + pw, py + ph);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = frame;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(px + pw / 2, py);
  ctx.lineTo(px + pw / 2, py + ph);
  ctx.moveTo(px, py + ph * 0.55);
  ctx.lineTo(px + pw, py + ph * 0.55);
  ctx.stroke();
}

function rectWindow(ctx, x, y, w, h, { frame, glass, pediment }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  ctx.fillStyle = frame;
  ctx.fillRect(px - 10, py - 10, pw + 20, ph + 24);
  if (pediment) {
    ctx.beginPath();
    ctx.moveTo(px - 18, py - 12);
    ctx.lineTo(px + pw / 2, py - 46);
    ctx.lineTo(px + pw + 18, py - 12);
    ctx.closePath();
    ctx.fill();
  }
  const gg = ctx.createLinearGradient(px, py, px + pw, py + ph);
  gg.addColorStop(0, glass[0]);
  gg.addColorStop(1, glass[1]);
  ctx.fillStyle = gg;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = frame;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(px + pw / 2, py);
  ctx.lineTo(px + pw / 2, py + ph);
  ctx.moveTo(px, py + ph / 3);
  ctx.lineTo(px + pw, py + ph / 3);
  ctx.stroke();
}

function mask(ctx, cx, cy, r, { skin, shade }) {
  const [x, y] = [cx * W, cy * H];
  const rad = r * W;
  // hair / leaves
  ctx.fillStyle = shade;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(x + i * rad * 0.32, y - rad * 0.75, rad * 0.28, rad * 0.5, i * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(x, y, rad * 0.78, rad, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(x - rad * 0.3, y - rad * 0.15, rad * 0.14, rad * 0.08, 0, 0, Math.PI * 2);
  ctx.ellipse(x + rad * 0.3, y - rad * 0.15, rad * 0.14, rad * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - rad * 0.05, y - rad * 0.1, rad * 0.1, rad * 0.35);
  ctx.beginPath();
  ctx.ellipse(x, y + rad * 0.5, rad * 0.25, rad * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
}

function lionHead(ctx, cx, cy, r, { mane, face, shade }) {
  const [x, y] = [cx * W, cy * H];
  const rad = r * W;
  ctx.fillStyle = mane;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * rad * 0.7, y + Math.sin(a) * rad * 0.7, rad * 0.35, rad * 0.22, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(x, y, rad * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(x - rad * 0.22, y - rad * 0.12, rad * 0.08, 0, Math.PI * 2);
  ctx.arc(x + rad * 0.22, y - rad * 0.12, rad * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - rad * 0.15, y + rad * 0.1);
  ctx.lineTo(x + rad * 0.15, y + rad * 0.1);
  ctx.lineTo(x, y + rad * 0.28);
  ctx.fill();
}

function flowers(ctx, x, y, w, h, { stem, petal, center }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  ctx.strokeStyle = stem;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px, py + ph / 2);
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    ctx.lineTo(px + t * pw, py + ph / 2 + Math.sin(t * Math.PI * 6) * ph * 0.28);
  }
  ctx.stroke();
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const fx = px + t * pw;
    const fy = py + ph / 2 + Math.sin(t * Math.PI * 6) * ph * 0.28;
    ctx.fillStyle = petal;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(fx + Math.cos(a) * 14, fy + Math.sin(a) * 14, 12, 7, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = center;
    ctx.beginPath();
    ctx.arc(fx, fy, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function inscription(ctx, text, x, y, w, h, { plate, ink, font }) {
  const [px, py, pw, ph] = R(x, y, w, h);
  ctx.fillStyle = plate;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(px + 6, py + 6, pw - 12, ph - 12);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = ph * 0.55;
  ctx.font = `600 ${size}px ${font}`;
  while (ctx.measureText(text).width > pw * 0.88 && size > 8) {
    size -= 1;
    ctx.font = `600 ${size}px ${font}`;
  }
  ctx.fillText(text, px + pw / 2, py + ph / 2 + 2);
}

function cornice(ctx, y, color, light) {
  rect(ctx, color, 0.03, y, 0.94, 0.018);
  rect(ctx, light, 0.03, y, 0.94, 0.005);
}

// ---------- the three samples ----------

function drawSecession(ctx) {
  const pal = { frame: '#d7cbb2', glass: ['#38506a', '#1a2532'] };
  base(ctx, { sky: ['#9cc3dd', '#e9d8c2'], wall: '#e9dcc0', wallDark: '#cdbb98' });
  // curved Secession roofline
  ctx.fillStyle = '#e9dcc0';
  ctx.beginPath();
  ctx.moveTo(W * 0.04, H * 0.08);
  ctx.quadraticCurveTo(W * 0.5, H * -0.02, W * 0.96, H * 0.08);
  ctx.fill();
  cornice(ctx, 0.08, '#b8a47e', '#f4ead6');
  for (const wx of [0.1, 0.6, 0.78]) archWindow(ctx, wx, 0.18, 0.12, 0.17, pal);
  mask(ctx, 0.44, 0.285, 0.065, { skin: '#f1e6cf', shade: '#9f8a66' });
  flowers(ctx, 0.12, 0.43, 0.42, 0.1, { stem: '#7d8f5a', petal: '#d99a7e', center: '#c7a14a' });
  cornice(ctx, 0.55, '#b8a47e', '#f4ead6');
  for (const wx of [0.1, 0.3]) archWindow(ctx, wx, 0.6, 0.12, 0.17, pal);
  inscription(ctx, 'GYÓGYSZERTÁR', 0.56, 0.66, 0.3, 0.07, { plate: '#203a35', ink: '#e6c873', font: 'Georgia, serif' });
  rect(ctx, '#5a4632', 0.6, 0.76, 0.22, 0.19);
}

function drawBaroque(ctx) {
  const pal = { frame: '#efe2c4', glass: ['#3b4a5c', '#1c232c'], pediment: true };
  base(ctx, { sky: ['#a8c6dc', '#f0dcc0'], wall: '#e2b866', wallDark: '#c29a4c' });
  // central gable
  ctx.fillStyle = '#e2b866';
  ctx.beginPath();
  ctx.moveTo(W * 0.3, H * 0.08);
  ctx.quadraticCurveTo(W * 0.5, H * 0.0, W * 0.7, H * 0.08);
  ctx.fill();
  cornice(ctx, 0.08, '#a8823e', '#f7e8c6');
  // pilasters
  for (const px of [0.06, 0.32, 0.65, 0.9]) rect(ctx, '#d4a85a', px, 0.09, 0.04, 0.86);
  for (const wx of [0.14, 0.74]) rectWindow(ctx, wx, 0.2, 0.12, 0.16, pal);
  // coat of arms (cartouche)
  {
    const [x, y, w, h] = R(0.43, 0.24, 0.14, 0.15);
    ctx.fillStyle = '#f4ead2';
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8c2f2a';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + h * 0.22);
    ctx.lineTo(x + w * 0.75, y + h * 0.22);
    ctx.lineTo(x + w * 0.75, y + h * 0.55);
    ctx.quadraticCurveTo(x + w / 2, y + h * 0.9, x + w * 0.25, y + h * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e6c873';
    ctx.fillRect(x + w * 0.46, y + h * 0.26, w * 0.08, h * 0.42);
    ctx.fillRect(x + w * 0.32, y + h * 0.38, w * 0.36, h * 0.08);
  }
  cornice(ctx, 0.44, '#a8823e', '#f7e8c6');
  for (const wx of [0.14, 0.74]) rectWindow(ctx, wx, 0.6, 0.12, 0.16, pal);
  // portal
  {
    const [x, y, w, h] = R(0.38, 0.55, 0.24, 0.4);
    ctx.fillStyle = '#efe2c4';
    ctx.fillRect(x, y + w / 2, w, h - w / 2);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#4a3020';
    const iw = w * 0.7;
    const ix = x + (w - iw) / 2;
    ctx.fillRect(ix, y + w / 2 + 10, iw, h - w / 2 - 10);
    ctx.beginPath();
    ctx.arc(x + w / 2, y + w / 2 + 10, iw / 2, Math.PI, 0);
    ctx.fill();
  }
  lionHead(ctx, 0.5, 0.505, 0.04, { mane: '#c9a45c', face: '#efe2c4', shade: '#6b5330' });
}

function drawContractExample(ctx) {
  const pal = { frame: '#c9c2b8', glass: ['#3a4b58', '#192127'] };
  base(ctx, { sky: ['#b3c9d6', '#e0d6cc'], wall: '#d9d2c7', wallDark: '#b9b0a3' });
  cornice(ctx, 0.08, '#9e968a', '#f1ece4');
  for (const wx of [0.1, 0.62, 0.8]) rectWindow(ctx, wx, 0.18, 0.11, 0.16, pal);
  mask(ctx, 0.39, 0.26, 0.055, { skin: '#ece6dc', shade: '#8a8174' });
  cornice(ctx, 0.45, '#9e968a', '#f1ece4');
  for (const wx of [0.1, 0.8]) rectWindow(ctx, wx, 0.5, 0.11, 0.16, pal);
  inscription(ctx, 'ANNO 1910', 0.4, 0.62, 0.22, 0.06, { plate: '#cfc6b8', ink: '#4c4338', font: 'Georgia, serif' });
  rect(ctx, '#3f3a35', 0.42, 0.72, 0.18, 0.23);
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
