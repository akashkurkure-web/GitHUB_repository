'use strict';
// Draws the demo catalog's product pictures as SVG studio shots (public/img/products/*.svg).
// Run: node scripts/draw-products.js   Each picture is 800x800 with a soft backdrop and floor shadow.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'products');
const SANS = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

let uid = 0;
const id = (p) => `${p}${++uid}`;
const defs = [];
function lin(stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  const g = id('l');
  defs.push(`<linearGradient id="${g}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
  return `url(#${g})`;
}
function rad(stops, cx = 0.5, cy = 0.5, r = 0.5) {
  const g = id('r');
  defs.push(`<radialGradient id="${g}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
  return `url(#${g})`;
}
const shadow = (cx, cy, rx, ry = rx * 0.12, a = 0.28) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${rad([[0, '#000', a], [1, '#000', 0]])}"/>`;
const text = (x, y, s, size, fill, { w = 600, f = SANS, a = 'middle', ls = 0, extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-family="${f}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${a}" letter-spacing="${ls}" ${extra}>${s}</text>`;

function page(bg, body) {
  const back = rad([[0, '#ffffff'], [0.55, bg], [1, shade(bg, -0.08)]], 0.5, 0.38, 0.75);
  const floor = lin([[0, '#000', 0], [1, '#000', 0.06]]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-134 0 1068 800" width="1068" height="800">
<defs>${defs.join('')}</defs>
<rect x="-134" width="1068" height="800" fill="${back}"/>
<rect x="-134" y="560" width="1068" height="240" fill="${floor}"/>
${body}
</svg>`;
  defs.length = 0;
  return svg;
}
// Lighten (+) or darken (-) a hex colour.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// ---------- Reusable shapes ----------
function phone({ x, y, w = 230, h = 470, body, screen, rot = 0, back = false, cams = 'triple' }) {
  const r = w * 0.13;
  let s = `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})">`;
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${lin([[0, shade(body, 0.25)], [0.5, body], [1, shade(body, -0.3)]], 0, 0, 1, 1)}"/>`;
  s += `<rect x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 4}" rx="${r - 2}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>`;
  if (!back) {
    s += `<rect x="${x + 9}" y="${y + 9}" width="${w - 18}" height="${h - 18}" rx="${r - 8}" fill="${screen}"/>`;
    s += `<circle cx="${x + w / 2}" cy="${y + 26}" r="6" fill="#0b0b12"/>`;
    s += text(x + w / 2, y + 110, '10:08', w * 0.24, '#fff', { w: 300 });
    s += text(x + w / 2, y + 140, 'Wednesday, 8 October', w * 0.06, '#fff', { w: 500, extra: 'opacity=".85"' });
    s += `<rect x="${x + w * 0.35}" y="${y + h - 26}" width="${w * 0.3}" height="5" rx="2.5" fill="#fff" opacity=".7"/>`;
    s += `<path d="M${x + 9} ${y + h * 0.55} Q ${x + w / 2} ${y + h * 0.42} ${x + w - 9} ${y + h * 0.6} L ${x + w - 9} ${y + h - 9 - r} Q ${x + w - 9} ${y + h - 9} ${x + w - 9 - r} ${y + h - 9} L ${x + 9 + r} ${y + h - 9} Q ${x + 9} ${y + h - 9} ${x + 9} ${y + h - 9 - r} Z" fill="#fff" opacity=".08"/>`;
  } else {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${lin([[0, '#fff', 0.18], [0.4, '#fff', 0], [1, '#fff', 0.05]], 0, 0, 1, 1)}"/>`;
    const lens = (cx, cy, rr) => `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="#15161b"/><circle cx="${cx}" cy="${cy}" r="${rr * 0.62}" fill="${rad([[0, '#3d4a6b'], [0.7, '#0c0d12']], 0.35, 0.35, 0.7)}"/><circle cx="${cx - rr * 0.25}" cy="${cy - rr * 0.25}" r="${rr * 0.18}" fill="#fff" opacity=".55"/>`;
    if (cams === 'bar') {
      s += `<rect x="${x}" y="${y + 70}" width="${w}" height="70" fill="${shade(body, -0.45)}"/>`;
      s += `<rect x="${x + 30}" y="${y + 84}" width="${w - 60}" height="42" rx="21" fill="#0d0e12"/>`;
      s += lens(x + 62, y + 105, 16) + lens(x + 108, y + 105, 16) + lens(x + 154, y + 105, 12);
    } else {
      const n = cams === 'dual' ? 2 : 3;
      s += `<rect x="${x + 22}" y="${y + 22}" width="${w * 0.42}" height="${n === 3 ? 150 : 104}" rx="26" fill="${shade(body, -0.2)}" stroke="#fff" stroke-opacity=".2"/>`;
      for (let i = 0; i < n; i++) s += lens(x + 22 + w * 0.21, y + 52 + i * 46, 18);
    }
    s += text(x + w / 2, y + h - 60, '', 14, '#fff');
  }
  return s + '</g>';
}

function bookCover({ x, y, w, h, color, spine, title, sub, author, motif = '' }) {
  const d = 34;
  let s = shadow(x + w / 2 + 20, y + h + 8, w * 0.75, 18, 0.35);
  s += `<path d="M${x} ${y} L${x - d} ${y + 14} L${x - d} ${y + h + 14} L${x} ${y + h} Z" fill="${spine}"/>`;
  s += `<path d="M${x - d} ${y + h + 14} L${x} ${y + h} L${x + w} ${y + h} L${x + w - 8} ${y + h + 10} Z" fill="#f4efe6"/>`;
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${color}"/>`;
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${lin([[0, '#fff', 0.18], [0.12, '#fff', 0], [0.9, '#000', 0], [1, '#000', 0.15]], 0, 0, 1, 0)}"/>`;
  s += motif;
  title.forEach((line, i) => { s += text(x + w / 2, y + 120 + i * 50, line, 44, '#fff', { w: 800, f: SERIF }); });
  if (sub) sub.forEach((line, i) => { s += text(x + w / 2, y + 140 + title.length * 50 + i * 26, line, 20, '#fff', { w: 500, extra: 'opacity=".9"' }); });
  s += text(x + w / 2, y + h - 40, author, 18, '#fff', { w: 700, ls: 3, extra: 'opacity=".9"' });
  return s;
}

// ---------- Products (in seed order) ----------
const ART = [];
const add = (file, bg, body) => ART.push([file, bg, body]);

add('nova-x5', '#dbe7ff', () => {
  const scr = lin([[0, '#5b7cff'], [0.5, '#3a2f9e'], [1, '#0d1240']], 0, 0, 1, 1);
  return shadow(400, 650, 230) + phone({ x: 300, y: 120, body: '#1d2a5c', back: true, rot: -9 }) + phone({ x: 410, y: 150, body: '#1d2a5c', screen: scr, rot: 6 });
});
add('pixelon-9-pro', '#e5e5e5', () => {
  const scr = lin([[0, '#9fb8c9'], [0.6, '#4b5d6b'], [1, '#1d252c']], 0, 0, 1, 1);
  return shadow(400, 655, 230) + phone({ x: 290, y: 125, body: '#5b5e66', back: true, cams: 'bar', rot: -8 }) + phone({ x: 410, y: 150, body: '#3c3f45', screen: scr, rot: 7 });
});
add('volt-lite', '#dff5e1', () => {
  const scr = lin([[0, '#c6f3a6'], [0.5, '#2f9d6a'], [1, '#0f3b2c']], 0, 0, 1, 1);
  return shadow(400, 650, 220) + phone({ x: 300, y: 130, body: '#3f8f5f', back: true, cams: 'dual', rot: -8 }) + phone({ x: 405, y: 155, body: '#2e6e49', screen: scr, rot: 6 });
});
add('fast-charger-65w', '#fff3d6', () => {
  const white = lin([[0, '#ffffff'], [1, '#d9dce3']], 0, 0, 1, 1);
  return shadow(400, 600, 240) +
    `<path d="M420 470 C 560 520, 620 620, 520 640 C 420 660, 300 640, 260 600 C 220 560, 300 520, 380 540" fill="none" stroke="#f3f4f7" stroke-width="22" stroke-linecap="round"/>` +
    `<path d="M420 470 C 560 520, 620 620, 520 640 C 420 660, 300 640, 260 600 C 220 560, 300 520, 380 540" fill="none" stroke="#c9ccd6" stroke-width="22" stroke-linecap="round" opacity=".35" stroke-dasharray="1 0"/>` +
    `<rect x="372" y="526" width="40" height="30" rx="6" fill="#d7dae2"/>` +
    `<rect x="270" y="210" width="260" height="260" rx="46" fill="${white}" stroke="#c8ccd6"/>` +
    `<rect x="270" y="210" width="260" height="70" rx="46" fill="#fff" opacity=".7"/>` +
    `<rect x="372" y="330" width="56" height="20" rx="10" fill="#2b2e36"/><rect x="380" y="336" width="40" height="8" rx="4" fill="#666b78"/>` +
    text(400, 420, '65W', 40, '#2b2e36', { w: 800 }) + text(400, 446, 'GaN · ChargeUp', 16, '#7b8090', { w: 600 }) +
    `<rect x="330" y="186" width="16" height="34" rx="4" fill="#b9bdc8"/><rect x="454" y="186" width="16" height="34" rx="4" fill="#b9bdc8"/>`;
});
add('airbeat-pro', '#f0e6ff', () => {
  const caseFill = lin([[0, '#ffffff'], [1, '#ddd6ea']], 0, 0, 0, 1);
  const bud = (x, y, flip) => `<g transform="translate(${x} ${y}) scale(${flip ? -1 : 1} 1)"><ellipse cx="0" cy="0" rx="46" ry="52" fill="${lin([[0, '#ffffff'], [1, '#cfc8de']], 0, 0, 1, 1)}"/><rect x="-14" y="30" width="28" height="110" rx="14" fill="${lin([[0, '#ffffff'], [1, '#d4cde3']], 0, 0, 1, 0)}"/><ellipse cx="-14" cy="-6" rx="22" ry="26" fill="#3b3550"/><ellipse cx="-20" cy="-14" rx="6" ry="8" fill="#fff" opacity=".4"/></g>`;
  return shadow(400, 640, 250) +
    `<path d="M250 420 Q250 380 290 380 L510 380 Q550 380 550 420 L550 560 Q550 620 490 620 L310 620 Q250 620 250 560 Z" fill="${caseFill}" stroke="#cdc5dc"/>` +
    `<rect x="250" y="410" width="300" height="6" fill="#bdb4cf"/>` +
    `<path d="M262 300 Q262 250 300 250 L500 250 Q538 250 538 300 L538 380 L262 380 Z" fill="#f6f3fb" stroke="#cdc5dc" transform="rotate(-12 262 380)"/>` +
    `<circle cx="400" cy="520" r="6" fill="#7bd88f"/>` + text(400, 590, 'AirBeat', 22, '#8b84a0', { w: 700, ls: 2 }) +
    bud(330, 330, false) + bud(470, 330, true);
});
add('ultrabook-14', '#e8eef5', () => {
  const lid = lin([[0, '#c9d2dd'], [1, '#8e99a8']], 0, 0, 1, 1);
  const scr = lin([[0, '#ffb36b'], [0.4, '#e2547a'], [1, '#2b2a6b']], 0, 0, 1, 1);
  return shadow(400, 600, 330, 30) +
    `<rect x="160" y="170" width="480" height="320" rx="16" fill="${lid}"/><rect x="172" y="182" width="456" height="290" rx="6" fill="#0d0f14"/>` +
    `<rect x="180" y="190" width="440" height="270" rx="3" fill="${scr}"/>` +
    `<path d="M180 400 Q330 330 470 380 T620 350 L620 460 L180 460 Z" fill="#1b1a4a" opacity=".55"/><circle cx="520" cy="250" r="34" fill="#ffe2a8" opacity=".8"/>` +
    `<path d="M120 500 L680 500 L640 470 L160 470 Z" fill="${lin([[0, '#dfe5ec'], [1, '#aeb8c5']], 0, 0, 0, 1)}"/>` +
    `<path d="M120 500 L680 500 L676 516 Q674 524 664 524 L136 524 Q126 524 124 516 Z" fill="#8994a3"/>` +
    `<rect x="350" y="502" width="100" height="8" rx="4" fill="#77808e"/>` + text(400, 485, 'STELLAR', 10, '#7c8696', { w: 700, ls: 4 });
});
add('fitora-watch-3', '#ffe3e3', () => {
  const strap = lin([[0, '#f07c7c'], [1, '#c94d55']], 0, 0, 1, 0);
  return shadow(400, 650, 170) +
    `<rect x="335" y="90" width="130" height="220" rx="36" fill="${strap}"/><rect x="335" y="490" width="130" height="190" rx="36" fill="${strap}"/>` +
    [0, 1, 2, 3].map((i) => `<circle cx="400" cy="${560 + i * 28}" r="6" fill="#a83c45"/>`).join('') +
    `<rect x="275" y="230" width="250" height="290" rx="64" fill="${lin([[0, '#4a4d57'], [1, '#17181d']], 0, 0, 1, 1)}"/>` +
    `<rect x="292" y="247" width="216" height="256" rx="50" fill="#050507"/>` +
    `<rect x="525" y="330" width="14" height="60" rx="6" fill="#2b2d34"/>` +
    `<circle cx="400" cy="345" r="62" fill="none" stroke="#3a1515" stroke-width="12"/><circle cx="400" cy="345" r="62" fill="none" stroke="#ff5b6e" stroke-width="12" stroke-dasharray="290 400" stroke-linecap="round" transform="rotate(-90 400 345)"/>` +
    `<circle cx="400" cy="345" r="44" fill="none" stroke="#123a2b" stroke-width="10"/><circle cx="400" cy="345" r="44" fill="none" stroke="#3ddc97" stroke-width="10" stroke-dasharray="180 400" stroke-linecap="round" transform="rotate(-90 400 345)"/>` +
    text(400, 357, '98%', 30, '#fff', { w: 700 }) + text(400, 450, '10:08', 40, '#fff', { w: 300 }) + text(400, 476, 'SpO2 · 8,412 steps', 14, '#aaa', { w: 500 });
});
add('visionex-43-tv', '#dde9f0', () => {
  const scr = lin([[0, '#5ec2ff'], [0.45, '#2a7bd1'], [1, '#0c2a52']], 0, 0, 0, 1);
  return shadow(400, 600, 300, 22) +
    `<rect x="90" y="160" width="620" height="370" rx="10" fill="#111317"/><rect x="100" y="170" width="600" height="345" rx="3" fill="${scr}"/>` +
    `<path d="M100 420 L230 300 L330 390 L450 270 L700 470 L700 515 L100 515 Z" fill="#183d2e"/><path d="M100 450 L260 350 L400 450 L520 360 L700 500 L700 515 L100 515 Z" fill="#1f5e3c"/>` +
    `<circle cx="590" cy="240" r="40" fill="#fff4c4" opacity=".9"/>` +
    `<rect x="100" y="170" width="600" height="345" fill="${lin([[0, '#fff', 0.14], [0.35, '#fff', 0]], 0, 0, 1, 1)}"/>` +
    text(400, 528, 'VISIONEX', 9, '#666', { w: 700, ls: 4 }) +
    `<path d="M210 530 L180 590 L200 590 L232 530 Z" fill="#2a2c31"/><path d="M590 530 L620 590 L600 590 L568 530 Z" fill="#2a2c31"/>`;
});
add('boombox-speaker', '#d9f2f2', () => {
  const body = lin([[0, '#1d7f86'], [0.5, '#2bb3b1'], [1, '#13575e']], 0, 0, 1, 0);
  let dots = '';
  for (let r = 0; r < 9; r++) for (let c = 0; c < 13; c++) dots += `<circle cx="${236 + c * 26 + (r % 2) * 13}" cy="${300 + r * 26}" r="4" fill="#0c4a50" opacity=".55"/>`;
  return shadow(400, 600, 260, 26) +
    `<rect x="210" y="250" width="380" height="320" rx="150" fill="${body}"/>` + dots +
    `<rect x="230" y="232" width="340" height="40" rx="20" fill="#164b52"/>` +
    [0, 1, 2].map((i) => `<circle cx="${360 + i * 40}" cy="252" r="9" fill="#9fe7e2"/>`).join('') +
    `<path d="M210 410 Q170 410 170 370 L170 330" fill="none" stroke="#3a3a3a" stroke-width="14" stroke-linecap="round"/>` +
    `<rect x="210" y="250" width="380" height="320" rx="150" fill="${lin([[0, '#fff', 0.18], [0.3, '#fff', 0]], 0, 0, 0, 1)}"/>` +
    text(400, 545, 'BoomBox', 20, '#e8fffd', { w: 800, ls: 1 });
});
add('optiq-camera', '#efe9e1', () => {
  const body = lin([[0, '#3b3d43'], [1, '#141518']], 0, 0, 0, 1);
  return shadow(400, 600, 290, 26) +
    `<path d="M170 300 L310 300 L340 250 L470 250 L500 300 L630 300 Q660 300 660 330 L660 540 Q660 570 630 570 L170 570 Q140 570 140 540 L140 330 Q140 300 170 300 Z" fill="${body}"/>` +
    `<rect x="140" y="330" width="90" height="240" rx="20" fill="#25272c"/>` + `<rect x="540" y="270" width="70" height="24" rx="8" fill="#55585f"/>` +
    `<circle cx="420" cy="440" r="130" fill="#1b1c20"/><circle cx="420" cy="440" r="112" fill="${lin([[0, '#5e6168'], [1, '#26282d']], 0, 0, 1, 1)}"/>` +
    `<circle cx="420" cy="440" r="88" fill="#0b0c10"/><circle cx="420" cy="440" r="66" fill="${rad([[0, '#4c5f8f'], [0.5, '#1c2238'], [1, '#05060a']], 0.38, 0.35, 0.7)}"/>` +
    `<circle cx="395" cy="412" r="16" fill="#fff" opacity=".45"/><circle cx="446" cy="470" r="7" fill="#9be0ff" opacity=".35"/>` +
    text(420, 548, '18-55mm', 14, '#b7bac2', { w: 600, ls: 1 }) + text(250, 285, 'OPTIQ', 14, '#d7d9de', { w: 800, ls: 4 });
});
add('urbanthread-shirt', '#e1ecf7', () => {
  const cloth = lin([[0, '#a9cbef'], [1, '#6f9fd6']], 0, 0, 1, 1);
  let checks = '';
  for (let i = 0; i < 14; i++) checks += `<rect x="${230 + i * 26}" y="200" width="6" height="420" fill="#fff" opacity=".18"/><rect x="220" y="${215 + i * 30}" width="360" height="5" fill="#fff" opacity=".15"/>`;
  return shadow(400, 660, 230) +
    `<path d="M400 110 L380 160 L420 160 Z" fill="#9aa1ab"/><path d="M400 110 Q400 92 414 92" fill="none" stroke="#9aa1ab" stroke-width="6"/>` +
    `<path d="M330 170 L250 200 L160 360 L220 395 L265 320 L265 630 L535 630 L535 320 L580 395 L640 360 L550 200 L470 170 Q400 205 330 170 Z" fill="${cloth}"/>` +
    `<clipPath id="shirtclip"><path d="M330 170 L250 200 L160 360 L220 395 L265 320 L265 630 L535 630 L535 320 L580 395 L640 360 L550 200 L470 170 Q400 205 330 170 Z"/></clipPath><g clip-path="url(#shirtclip)">${checks}</g>` +
    `<path d="M330 170 L400 215 L470 170 L455 160 L400 192 L345 160 Z" fill="#e9f2fc"/><path d="M330 170 L372 240 L400 215 Z M470 170 L428 240 L400 215 Z" fill="#cfe1f5"/>` +
    `<rect x="394" y="215" width="12" height="415" fill="#89b2e0"/>` + [0, 1, 2, 3, 4, 5].map((i) => `<circle cx="400" cy="${250 + i * 64}" r="6" fill="#f5f8fc" stroke="#7d9cc2"/>`).join('') +
    `<path d="M285 260 L345 260 L345 300 L285 300 Z" fill="none" stroke="#5f8cc4" stroke-width="3"/>`;
});
add('desi-weaves-kurta', '#fbe1ec', () => {
  const cloth = lin([[0, '#e8578c'], [0.55, '#c9356c'], [1, '#9c2453']], 0, 0, 1, 1);
  const gold = '#f3c969';
  const outline = 'M345 150 L272 178 L212 342 L262 360 L292 282 L274 640 L526 640 L508 282 L538 360 L588 342 L528 178 L455 150 Q400 200 345 150 Z';
  const buti = (x, y, k) => `<g transform="translate(${x} ${y}) rotate(${k % 2 ? 25 : -25}) scale(.9)"><path d="M0 -16 Q14 -4 8 10 Q2 18 -6 12 Q-14 4 -6 -4 Q2 -10 0 -16 Z" fill="${gold}"/><circle cx="1" cy="6" r="3.5" fill="#fff4d6"/></g>`;
  let motif = '';
  let k = 0;
  for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) motif += buti(300 + c * 42 + (r % 2) * 21, 270 + r * 50, k++);
  const border = (y) => `<rect x="250" y="${y}" width="300" height="26" fill="#7d1c43"/><path d="M250 ${y + 13} ${Array.from({ length: 15 }, (_, i) => `L${260 + i * 20} ${y + (i % 2 ? 5 : 21)}`).join(' ')} L550 ${y + 13}" fill="none" stroke="${gold}" stroke-width="3"/>`;
  return shadow(400, 690, 220) +
    `<path d="M400 58 Q424 58 424 80 Q424 96 404 102 L400 118" fill="none" stroke="#8a919b" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M300 150 L400 116 L500 150" fill="none" stroke="#a9744a" stroke-width="12" stroke-linecap="round"/>` +
    `<path d="${outline}" fill="${cloth}"/>` +
    `<clipPath id="kclip"><path d="${outline}"/></clipPath><g clip-path="url(#kclip)">${motif}${border(608)}` +
    `<path d="M212 342 L262 360 L268 342 L220 322 Z M588 342 L538 360 L532 342 L580 322 Z" fill="#7d1c43"/>` +
    `<path d="M220 322 L268 342 M580 322 L532 342" stroke="${gold}" stroke-width="3"/>` +
    `<path d="M400 140 L400 640" stroke="#000" stroke-opacity=".08" stroke-width="40"/></g>` +
    `<path d="M345 150 Q400 200 455 150 L470 168 Q400 228 330 168 Z" fill="#7d1c43"/>` +
    `<path d="M338 162 Q400 214 462 162" fill="none" stroke="${gold}" stroke-width="4" stroke-dasharray="2 7" stroke-linecap="round"/>` +
    `<path d="M400 190 L400 300" stroke="#7d1c43" stroke-width="16" stroke-linecap="round"/>` +
    [215, 245, 275].map((y) => `<circle cx="400" cy="${y}" r="5" fill="${gold}"/>`).join('');
});
add('stride-running-shoes', '#e6f4ea', () => {
  const upper = lin([[0, '#4cc985'], [0.6, '#22a062'], [1, '#157a48']], 0, 0, 1, 1);
  const knit = lin([[0, '#ffffff', 0.16], [1, '#ffffff', 0]], 0, 0, 1, 0);
  let mesh = '';
  for (let i = 0; i < 14; i++) mesh += `<path d="M${250 + i * 26} 470 Q${262 + i * 26} 420 ${258 + i * 26} 360" stroke="#fff" stroke-opacity=".12" stroke-width="3" fill="none"/>`;
  let tread = '';
  for (let i = 0; i < 18; i++) tread += `<rect x="${150 + i * 31}" y="532" width="16" height="10" rx="3" fill="#1d2722"/>`;
  let laces = '';
  for (let i = 0; i < 5; i++) {
    const x = 352 + i * 30, y = 318 + i * 14;
    laces += `<path d="M${x - 14} ${y + 26} L${x + 22} ${y - 2}" stroke="#ffffff" stroke-width="9" stroke-linecap="round"/>` +
      `<circle cx="${x - 16}" cy="${y + 30}" r="5" fill="#0f5b35"/><circle cx="${x + 24}" cy="${y - 4}" r="5" fill="#0f5b35"/>`;
  }
  const shoe = 'M128 488 L132 372 Q136 330 176 318 Q214 334 262 336 Q314 334 344 306 L378 274 Q400 254 428 266 L446 290 Q520 356 626 394 Q704 420 708 470 L708 490 Z';
  return shadow(410, 572, 320, 24) +
    `<path d="${shoe}" fill="${upper}"/>` +
    `<clipPath id="shoeclip"><path d="${shoe}"/></clipPath><g clip-path="url(#shoeclip)">${mesh}<rect x="120" y="250" width="600" height="250" fill="${knit}"/>` +
    `<path d="M120 500 L120 360 Q170 340 214 352 Q236 420 226 500 Z" fill="#0f5b35"/>` +
    `<path d="M560 386 Q676 408 712 470 L712 500 L548 500 Q530 440 560 386 Z" fill="#7fe0aa"/></g>` +
    `<path d="M176 318 Q214 334 262 336 Q314 334 344 306 Q300 316 262 318 Q210 318 176 318 Z" fill="#0b3d24"/>` +
    `<path d="M146 330 L132 286 Q130 272 144 272 L166 278 Q174 296 176 318 Z" fill="#157a48"/>` +
    `<path d="M384 270 Q402 236 428 246 L446 290 L428 266 Q404 256 384 270 Z" fill="#0f5b35"/>` +
    `<path d="M262 468 Q390 388 590 358 Q630 352 640 360 Q470 400 300 482 Z" fill="#ffffff"/>` +
    laces +
    `<path d="M108 488 Q100 548 150 550 L668 546 Q724 540 722 492 L716 466 Q706 486 660 490 Z" fill="${lin([[0, '#ffffff'], [1, '#d9e2dc']], 0, 0, 0, 1)}"/>` +
    `<path d="M150 512 Q400 520 712 500" fill="none" stroke="#22a062" stroke-width="5" opacity=".7"/>` +
    `<path d="M104 528 Q110 552 150 552 L668 548 Q712 546 722 516 L722 528 Q716 560 668 562 L150 566 Q106 566 104 540 Z" fill="#2b3a33"/>` + tread +
    `<path d="M210 360 Q240 352 270 356" stroke="#fff" stroke-opacity=".35" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    text(186, 430, 'STRIDE', 16, '#ffffff', { w: 800, ls: 3, extra: 'transform="rotate(-84 186 430)" opacity=".85"' });
});
add('suncraft-aviators', '#f3f0e6', () => {
  const lens = lin([[0, '#2e3b4e'], [0.55, '#5d6f8a'], [1, '#c7a96a']], 0, 0, 0.3, 1);
  const lensShape = (dx) => `<path d="M${dx} 330 Q${dx + 10} 300 ${dx + 70} 300 L${dx + 150} 300 Q${dx + 200} 300 ${dx + 190} 360 Q${dx + 175} 450 ${dx + 105} 455 Q${dx + 30} 458 ${dx + 8} 390 Q${dx - 5} 355 ${dx} 330 Z"`;
  return shadow(400, 560, 260, 20) +
    `<path d="M150 330 L90 310 Q70 306 70 326 L70 420" fill="none" stroke="#b08d4c" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M650 330 L710 310 Q730 306 730 326 L730 420" fill="none" stroke="#b08d4c" stroke-width="7" stroke-linecap="round"/>` +
    lensShape(160) + ` fill="${lens}" stroke="#c9a65e" stroke-width="7"/>` +
    `<g transform="translate(800 0) scale(-1 1)">${lensShape(160)} fill="${lens}" stroke="#c9a65e" stroke-width="7"/></g>` +
    `<path d="M350 318 Q400 296 450 318" fill="none" stroke="#c9a65e" stroke-width="7"/><path d="M335 300 L465 300" stroke="#c9a65e" stroke-width="5"/>` +
    `<path d="M190 330 Q230 316 280 330" stroke="#fff" stroke-opacity=".55" stroke-width="10" fill="none" stroke-linecap="round"/>` +
    `<path d="M610 330 Q570 316 520 330" stroke="#fff" stroke-opacity=".55" stroke-width="10" fill="none" stroke-linecap="round"/>`;
});
add('hideworks-wallet', '#efe4d9', () => {
  const leather = lin([[0, '#9a5b32'], [1, '#5b3219']], 0, 0, 1, 1);
  return shadow(400, 600, 270, 26) +
    `<path d="M190 300 Q190 270 220 270 L580 270 Q610 270 610 300 L610 560 Q610 590 580 590 L220 590 Q190 590 190 560 Z" fill="${leather}"/>` +
    `<path d="M206 286 L594 286 L594 574 L206 574 Z" fill="none" stroke="#e8c49a" stroke-width="3" stroke-dasharray="10 8" rx="20"/>` +
    `<rect x="400" y="270" width="6" height="320" fill="#3e2211" opacity=".45"/>` +
    `<path d="M190 300 Q190 270 220 270 L580 270 Q610 270 610 300 L610 340 L190 340 Z" fill="#fff" opacity=".07"/>` +
    `<rect x="240" y="232" width="120" height="70" rx="6" fill="#2f5aa8" transform="rotate(-6 300 267)"/><rect x="262" y="250" width="34" height="24" rx="4" fill="#e3c26b" transform="rotate(-6 300 267)"/>` +
    text(500, 450, 'HIDEWORKS', 18, '#e8c49a', { w: 700, ls: 4, extra: 'opacity=".8"' });
});
add('chefnest-cookware', '#fdebd3', () => {
  const pan = rad([[0, '#4a4a50'], [0.8, '#1b1b1f'], [1, '#0e0e11']], 0.45, 0.4, 0.6);
  const rim = '#b8463a';
  return shadow(400, 640, 320, 32) +
    `<ellipse cx="250" cy="430" rx="190" ry="70" fill="${rim}"/><ellipse cx="250" cy="425" rx="176" ry="60" fill="${pan}"/>` +
    `<path d="M60 430 Q60 560 250 560 Q440 560 440 430" fill="${lin([[0, '#c95a4b'], [1, '#8e2e24']], 0, 0, 0, 1)}"/>` +
    `<path d="M40 420 Q20 410 26 395 L70 410 Z M460 420 Q480 410 474 395 L430 410 Z" fill="#2a2a2e"/>` +
    `<ellipse cx="560" cy="300" rx="170" ry="60" fill="${rim}"/><ellipse cx="560" cy="296" rx="158" ry="52" fill="${pan}"/>` +
    `<rect x="700" y="270" width="110" height="24" rx="12" fill="#2a2a2e" transform="rotate(-14 700 282)"/>` +
    `<ellipse cx="560" cy="560" rx="170" ry="52" fill="#2a2a2e"/><ellipse cx="560" cy="555" rx="160" ry="46" fill="${pan}"/>` +
    `<path d="M220 400 Q260 380 320 395" stroke="#fff" stroke-opacity=".25" stroke-width="8" fill="none" stroke-linecap="round"/>` +
    `<path d="M530 280 Q570 266 620 276" stroke="#fff" stroke-opacity=".25" stroke-width="7" fill="none" stroke-linecap="round"/>`;
});
add('hydrasteel-bottles', '#e3f1f9', () => {
  const steel = lin([[0, '#8c949e'], [0.25, '#f4f7fa'], [0.5, '#c2c9d1'], [0.8, '#eef2f6'], [1, '#7f8892']], 0, 0, 1, 0);
  const btl = (x, h, cap) => `<rect x="${x}" y="${640 - h}" width="140" height="${h}" rx="40" fill="${steel}"/><rect x="${x + 25}" y="${600 - h}" width="90" height="60" rx="14" fill="${cap}"/><rect x="${x + 25}" y="${600 - h}" width="90" height="14" rx="7" fill="#fff" opacity=".25"/><rect x="${x + 10}" y="${640 - h * 0.55}" width="120" height="70" fill="${cap}" opacity=".9"/>` + text(x + 70, 640 - h * 0.55 + 45, 'HYDRA', 18, '#fff', { w: 800, ls: 3 });
  return shadow(400, 645, 240, 22) + btl(240, 430, '#2a6f97') + btl(420, 400, '#e86a5c');
});
add('sleepwell-bedsheet', '#ece6f7', () => {
  const fold = (y, c1, c2, w) => `<path d="M${400 - w} ${y} L${400 + w} ${y} Q${410 + w} ${y} ${410 + w} ${y + 16} L${410 + w} ${y + 60} Q${410 + w} ${y + 76} ${400 + w} ${y + 76} L${400 - w} ${y + 76} Q${390 - w} ${y + 76} ${390 - w} ${y + 60} L${390 - w} ${y + 16} Q${390 - w} ${y} ${400 - w} ${y} Z" fill="${lin([[0, c1], [1, c2]], 0, 0, 0, 1)}"/>`;
  let flowers = '';
  for (let i = 0; i < 6; i++) flowers += `<g transform="translate(${250 + i * 60} ${530})"><circle r="11" fill="#9b7fd1"/><circle r="5" fill="#f7d36b"/></g>`;
  return shadow(400, 640, 280, 26) +
    fold(500, '#d9cdf3', '#b9a6e4', 230) + flowers + fold(420, '#f6f2fd', '#ddd3f2', 220) + fold(340, '#b49ae0', '#8f71cc', 210) +
    `<path d="M240 260 Q240 220 280 220 L520 220 Q560 220 560 260 L560 320 Q560 340 540 340 L260 340 Q240 340 240 320 Z" fill="${lin([[0, '#ffffff'], [1, '#e7e0f5']], 0, 0, 0, 1)}"/>` +
    `<path d="M260 236 L540 236 L540 324 L260 324 Z" fill="none" stroke="#c9b9ea" stroke-width="3" stroke-dasharray="8 6"/>` +
    `<rect x="380" y="340" width="40" height="236" fill="#fff" opacity=".35"/>`;
});
add('lumio-desk-lamp', '#fff8cf', () => {
  const metal = lin([[0, '#3c4250'], [1, '#1b1e26']], 0, 0, 1, 1);
  return shadow(360, 640, 200, 22) +
    `<path d="M430 300 L680 600 L470 600 Z" fill="${lin([[0, '#fff5b0', 0.85], [1, '#fff5b0', 0]], 0, 0, 0, 1)}"/>` +
    `<ellipse cx="360" cy="620" rx="120" ry="26" fill="${metal}"/><rect x="250" y="600" width="220" height="20" fill="${metal}"/>` +
    `<path d="M355 605 L300 400 L420 230" fill="none" stroke="#2a2f3a" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="300" cy="400" r="18" fill="#454c5c"/><circle cx="420" cy="230" r="16" fill="#454c5c"/>` +
    `<path d="M410 240 L560 300 L520 360 L380 290 Z" fill="${metal}"/><path d="M520 360 L560 300 L570 316 L532 372 Z" fill="#fff9d9"/>` +
    `<rect x="300" y="600" width="40" height="8" rx="4" fill="#7ce0a3"/>`;
});
add('atomic-discipline', '#e3ecff', () => bookCover({ x: 260, y: 140, w: 300, h: 440, color: '#1f3c88', spine: '#152b63',
  title: ['Atomic', 'Discipline'], sub: ['Small Habits,', 'Big Results'], author: 'LIGHTHOUSE PRESS',
  motif: [0, 1, 2, 3, 4].map((i) => `<rect x="${300 + i * 48}" y="${470 - i * 36}" width="34" height="${36 + i * 36}" rx="3" fill="#f5b941" opacity="${0.5 + i * 0.12}"/>`).join('') }));
add('indian-kitchen-book', '#ffe1d6', () => bookCover({ x: 260, y: 140, w: 300, h: 440, color: '#b6382a', spine: '#842519',
  title: ['The Indian', 'Kitchen'], sub: ['500 Home Recipes'], author: 'SAFFRON BOOKS',
  motif: `<circle cx="410" cy="430" r="70" fill="#f7d36b"/><circle cx="410" cy="430" r="54" fill="#e9893a"/><circle cx="392" cy="418" r="8" fill="#5c8a3a"/><circle cx="425" cy="440" r="7" fill="#5c8a3a"/><circle cx="410" cy="410" r="5" fill="#fff6dd"/>` }));
add('coding-interview-book', '#e2f5e2', () => bookCover({ x: 260, y: 140, w: 300, h: 440, color: '#1d6b45', spine: '#134a30',
  title: ['Crack the', 'Coding', 'Interview'], sub: ['2026 Edition'], author: 'TECHREADS',
  motif: text(410, 500, '{ ; }', 64, '#9ff0c4', { w: 700, f: 'Consolas, Menlo, monospace', extra: 'opacity=".55"' }) }));
add('glowlab-vitamin-c', '#fff1d9', () => {
  const glass = lin([[0, '#c56a12'], [0.4, '#f0a53c'], [1, '#9a4d07']], 0, 0, 1, 0);
  return shadow(400, 650, 170, 20) +
    `<circle cx="560" cy="560" r="44" fill="#ffb347"/><circle cx="560" cy="560" r="36" fill="#ffcf73"/><path d="M560 524 L560 596 M524 560 L596 560 M535 535 L585 585 M585 535 L535 585" stroke="#ffb347" stroke-width="4"/>` +
    `<rect x="320" y="300" width="160" height="340" rx="40" fill="${glass}"/>` +
    `<rect x="356" y="250" width="88" height="60" fill="#d9a35a"/><rect x="350" y="180" width="100" height="80" rx="14" fill="#1f1f24"/><path d="M370 180 Q370 120 400 120 Q430 120 430 180 Z" fill="#2b2b31"/>` +
    `<rect x="330" y="400" width="140" height="170" rx="6" fill="#fffaf0"/>` +
    text(400, 440, 'GLOWLAB', 16, '#c56a12', { w: 800, ls: 3 }) + text(400, 492, 'Vitamin C', 26, '#3a2b18', { w: 700, f: SERIF }) +
    text(400, 522, '10% serum', 16, '#7a6347', { w: 600 }) + text(400, 552, '30 ml', 14, '#7a6347', { w: 500 }) +
    `<rect x="334" y="310" width="16" height="320" rx="8" fill="#fff" opacity=".3"/>`;
});
add('velvet-muse-lipstick', '#ffd9de', () => {
  const gold = lin([[0, '#a8823c'], [0.4, '#f6dc9a'], [0.7, '#c99e4b'], [1, '#7d5c22']], 0, 0, 1, 0);
  return shadow(400, 650, 210, 22) +
    `<rect x="450" y="280" width="120" height="360" rx="14" fill="#1d1416"/><rect x="450" y="280" width="120" height="30" fill="${gold}"/>` +
    text(510, 480, 'VELVET MUSE', 13, '#e7c27a', { w: 700, ls: 2, extra: 'transform="rotate(-90 510 480)"' }) +
    `<rect x="250" y="440" width="130" height="200" rx="12" fill="#1d1416"/><rect x="262" y="350" width="106" height="100" fill="${gold}"/>` +
    `<path d="M276 350 L276 230 Q276 200 300 190 L354 160 L354 350 Z" fill="${lin([[0, '#8e0f22'], [0.5, '#d0263f'], [1, '#6e0a19']], 0, 0, 1, 0)}"/>` +
    `<path d="M290 340 L290 236 Q292 214 304 206" stroke="#fff" stroke-opacity=".35" stroke-width="7" fill="none" stroke-linecap="round"/>`;
});
add('groomsmith-kit', '#e6e6ea', () => {
  return shadow(400, 650, 300, 26) +
    `<rect x="210" y="200" width="110" height="420" rx="50" fill="${lin([[0, '#2b2d33'], [0.5, '#4b4e56'], [1, '#17181c']], 0, 0, 1, 0)}"/>` +
    `<rect x="220" y="170" width="90" height="50" rx="8" fill="#b8bcc6"/>` + [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${226 + i * 12}" y="160" width="6" height="22" fill="#d9dce3"/>`).join('') +
    `<circle cx="265" cy="330" r="16" fill="#e2b04a"/><rect x="250" y="380" width="30" height="80" rx="15" fill="#3c3f47"/>` +
    `<rect x="400" y="360" width="120" height="260" rx="18" fill="${lin([[0, '#6b3b12'], [0.5, '#a65d1e'], [1, '#4d2a0c']], 0, 0, 1, 0)}"/>` +
    `<rect x="430" y="310" width="60" height="56" rx="8" fill="#1d1d21"/><rect x="412" y="430" width="96" height="110" rx="6" fill="#f2ebe1"/>` +
    text(460, 476, 'BEARD', 15, '#4d2a0c', { w: 800, ls: 2 }) + text(460, 500, 'OIL', 15, '#4d2a0c', { w: 800, ls: 2 }) +
    `<rect x="560" y="420" width="70" height="200" rx="8" fill="#c58b4a"/>` + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<rect x="560" y="${428 + i * 19}" width="${i % 2 ? 40 : 56}" height="7" fill="#e6e6ea"/>`).join('');
});
add('boundary-cricket-bat', '#f6ecd9', () => {
  const willow = lin([[0, '#f6dcae'], [0.5, '#e8c27f'], [1, '#c99a55']], 0, 0, 1, 0);
  return shadow(420, 680, 160, 18) +
    `<g transform="rotate(-18 400 400)">` +
    `<rect x="380" y="70" width="40" height="230" rx="18" fill="#232428"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="380" y="${86 + i * 26}" width="40" height="6" fill="#d23a3a"/>`).join('') +
    `<path d="M370 300 Q400 280 430 300 L470 340 L470 690 Q470 720 440 720 L360 720 Q330 720 330 690 L330 340 Z" fill="${willow}"/>` +
    [0, 1, 2, 3, 4, 5].map((i) => `<path d="M${345 + i * 22} 360 L${345 + i * 22} 700" stroke="#c99a55" stroke-opacity=".5" stroke-width="2"/>`).join('') +
    `<rect x="330" y="420" width="140" height="70" fill="#1e3a6e"/>` + text(400, 465, 'BOUNDARY', 18, '#fff', { w: 800, ls: 2 }) +
    `<rect x="330" y="600" width="140" height="18" fill="#1e3a6e"/></g>`;
});
add('asana-yoga-mat', '#dff3ef', () => {
  const mat = lin([[0, '#5fc2b0'], [1, '#2f8f80']], 0, 0, 0, 1);
  return shadow(400, 600, 300, 26) +
    `<path d="M230 600 L640 600 L700 640 L170 640 Z" fill="#7fd1c2"/>` +
    `<rect x="170" y="330" width="460" height="240" rx="120" fill="${mat}"/>` +
    `<ellipse cx="630" cy="450" rx="70" ry="120" fill="#2a7f72"/><ellipse cx="630" cy="450" rx="54" ry="100" fill="#6dd1bf"/><ellipse cx="630" cy="450" rx="38" ry="76" fill="#2a7f72"/><ellipse cx="630" cy="450" rx="20" ry="44" fill="#6dd1bf"/>` +
    `<rect x="300" y="320" width="34" height="260" fill="#253447"/><rect x="460" y="320" width="34" height="260" fill="#253447"/>` +
    `<path d="M317 320 Q400 200 477 320" fill="none" stroke="#253447" stroke-width="16"/>` +
    `<rect x="170" y="350" width="440" height="30" rx="15" fill="#fff" opacity=".18"/>`;
});
add('ironcore-dumbbells', '#e5e5e5', () => {
  const chrome = lin([[0, '#6f757e'], [0.3, '#f4f6f8'], [0.6, '#9aa1aa'], [1, '#e1e5ea']], 0, 0, 0, 1);
  const plate = lin([[0, '#3a3d44'], [1, '#141518']], 0, 0, 1, 1);
  const db = (y, s) => `<g transform="translate(400 ${y}) scale(${s})"><rect x="-200" y="-12" width="400" height="24" rx="10" fill="${chrome}"/>` +
    [-190, -150, 110, 150].map((x) => `<rect x="${x}" y="-80" width="36" height="160" rx="10" fill="${plate}"/><rect x="${x + 6}" y="-74" width="6" height="148" rx="3" fill="#fff" opacity=".18"/>`).join('') +
    `<rect x="-60" y="-14" width="120" height="28" rx="8" fill="#2a2c31"/>` + [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${-54 + i * 17}" y="-14" width="4" height="28" fill="#444851"/>`).join('') + `</g>`;
  return shadow(400, 630, 300, 28) + db(540, 1) + db(360, 0.82);
});
add('bricktown-blocks', '#ffe9c7', () => {
  const brick = (x, y, w, c, k = 2) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="60" rx="6" fill="${c}"/><rect x="${x}" y="${y + 44}" width="${w}" height="16" rx="6" fill="#000" opacity=".15"/>`;
    for (let i = 0; i < k; i++) s += `<rect x="${x + 14 + i * (w - 28) / Math.max(1, k - 1) - 16 + (k === 1 ? (w - 28) / 2 : 0)}" y="${y - 14}" width="32" height="18" rx="6" fill="${c}"/><rect x="${x + 14 + i * (w - 28) / Math.max(1, k - 1) - 16 + (k === 1 ? (w - 28) / 2 : 0)}" y="${y - 14}" width="32" height="6" rx="3" fill="#fff" opacity=".35"/>`;
    return s;
  };
  return shadow(400, 640, 300, 26) +
    brick(170, 560, 160, '#e53935', 4) + brick(330, 560, 160, '#1e88e5', 4) + brick(490, 560, 120, '#43a047', 3) +
    brick(220, 486, 120, '#fbc02d', 3) + brick(340, 486, 200, '#fb8c00', 5) +
    brick(270, 412, 160, '#8e24aa', 4) + brick(430, 412, 80, '#00acc1', 2) +
    brick(320, 338, 120, '#e53935', 3) + brick(360, 264, 80, '#1e88e5', 2) +
    brick(560, 470, 80, '#43a047', 2);
});
add('turbotoys-rc-car', '#dde8ff', () => {
  const tire = (cx) => `<circle cx="${cx}" cy="520" r="90" fill="#17181c"/>` + Array.from({ length: 16 }, (_, i) => `<rect x="${cx - 8}" y="430" width="16" height="22" rx="3" fill="#2b2d33" transform="rotate(${i * 22.5} ${cx} 520)"/>`).join('') + `<circle cx="${cx}" cy="520" r="48" fill="#c9cdd6"/><circle cx="${cx}" cy="520" r="18" fill="#6c717c"/>`;
  return shadow(400, 615, 330, 26) +
    `<path d="M140 470 L170 380 L300 360 L360 290 L520 290 L590 360 L670 380 L690 470 Z" fill="${lin([[0, '#ff5a3c'], [1, '#c4271a']], 0, 0, 0, 1)}"/>` +
    `<path d="M375 305 L505 305 L560 360 L330 360 Z" fill="#9fd4ff"/><rect x="438" y="305" width="10" height="55" fill="#c4271a"/>` +
    `<rect x="190" y="410" width="460" height="16" rx="8" fill="#ffd34d"/>` + text(420, 455, 'TURBO', 26, '#fff', { w: 900, ls: 2 }) +
    `<rect x="560" y="250" width="10" height="70" fill="#333"/>` + tire(230) + tire(590);
});
add('funfamily-board-game', '#f0e1ff', () => {
  let squares = '';
  const cols = ['#e53935', '#1e88e5', '#43a047', '#fbc02d', '#8e24aa', '#fb8c00'];
  for (let i = 0; i < 9; i++) squares += `<rect x="${190 + i * 46}" y="230" width="46" height="46" fill="${cols[i % 6]}" stroke="#fff" stroke-width="2"/><rect x="${190 + i * 46}" y="598" width="46" height="46" fill="${cols[(i + 3) % 6]}" stroke="#fff" stroke-width="2"/>`;
  for (let i = 1; i < 8; i++) squares += `<rect x="190" y="${230 + i * 46}" width="46" height="46" fill="${cols[(i + 1) % 6]}" stroke="#fff" stroke-width="2"/><rect x="558" y="${230 + i * 46}" width="46" height="46" fill="${cols[(i + 4) % 6]}" stroke="#fff" stroke-width="2"/>`;
  const die = (x, y, r, pips) => `<g transform="rotate(${r} ${x} ${y})"><rect x="${x - 34}" y="${y - 34}" width="68" height="68" rx="12" fill="#fff" stroke="#ddd"/>${pips.map(([a, b]) => `<circle cx="${x + a * 20}" cy="${y + b * 20}" r="7" fill="#222"/>`).join('')}</g>`;
  return shadow(400, 670, 320, 26) +
    `<rect x="170" y="210" width="460" height="460" rx="10" fill="#fff7e6"/>` + squares +
    text(397, 430, 'BUSINESS', 40, '#6a1b9a', { w: 900, ls: 2 }) + text(397, 470, 'EDITION', 20, '#6a1b9a', { w: 700, ls: 6 }) +
    die(620, 640, 14, [[-1, -1], [0, 0], [1, 1]]) + die(700, 600, -10, [[-1, -1], [1, -1], [-1, 1], [1, 1]]);
});
add('royal-harvest-basmati', '#f6f3e8', () => {
  const sack = lin([[0, '#fbf6e8'], [0.5, '#efe3c4'], [1, '#d8c69c']], 0, 0, 1, 0);
  let grains = '';
  const rnd = mulberry(7);
  for (let i = 0; i < 60; i++) {
    const x = 470 + rnd() * 260, y = 570 + rnd() * 70, r = rnd() * 180;
    grains += `<ellipse cx="${x}" cy="${y}" rx="11" ry="3.2" fill="#fffdf6" stroke="#e2d6b8" stroke-width="1" transform="rotate(${r} ${x} ${y})"/>`;
  }
  let window = '';
  for (let i = 0; i < 70; i++) {
    const x = 270 + rnd() * 160, y = 430 + rnd() * 70, r = rnd() * 180;
    window += `<ellipse cx="${x}" cy="${y}" rx="10" ry="3" fill="#fffdf6" stroke="#e8dcc0" stroke-width="1" transform="rotate(${r} ${x} ${y})"/>`;
  }
  return shadow(400, 660, 300, 30) +
    `<path d="M210 170 Q350 150 490 170 L520 640 Q350 665 180 640 Z" fill="${sack}"/>` +
    `<path d="M210 170 Q350 150 490 170 L494 210 Q350 192 206 210 Z" fill="#7a1f2b"/>` + text(350, 200, 'ROYAL HARVEST', 16, '#f5d27a', { w: 800, ls: 3 }) +
    `<path d="M230 240 L470 240 L474 300 L226 300 Z" fill="#7a1f2b"/>` + text(350, 282, 'BASMATI', 38, '#f5d27a', { w: 800, f: SERIF, ls: 2 }) +
    text(350, 330, 'Premium · Extra Long Grain', 15, '#6b4a2b', { w: 600 }) + text(350, 356, 'Aged 2 Years', 15, '#6b4a2b', { w: 600 }) +
    `<rect x="262" y="420" width="176" height="90" rx="45" fill="#f7f0dc" stroke="#c9b48a" stroke-width="3"/><clipPath id="win"><rect x="262" y="420" width="176" height="90" rx="45"/></clipPath><g clip-path="url(#win)">${window}</g>` +
    `<circle cx="350" cy="570" r="34" fill="#7a1f2b"/>` + text(350, 580, '5kg', 22, '#f5d27a', { w: 800 }) +
    `<path d="M300 120 Q350 150 400 120" fill="none" stroke="#c9b48a" stroke-width="6"/>` +
    `<path d="M540 540 Q600 620 660 540 Z" fill="#fff"/>` +
    `<path d="M500 520 L700 520 Q690 610 600 620 Q510 610 500 520 Z" fill="${lin([[0, '#2f6f8f'], [1, '#1b4a62']], 0, 0, 0, 1)}"/>` +
    `<ellipse cx="600" cy="520" rx="100" ry="22" fill="#fffdf4"/>` + Array.from({ length: 40 }, () => { const x = 515 + rnd() * 170, y = 505 + rnd() * 26, r = rnd() * 180; return `<ellipse cx="${x}" cy="${y}" rx="10" ry="3" fill="#fffdf6" stroke="#e4d8bb" stroke-width="1" transform="rotate(${r} ${x} ${y})"/>`; }).join('') +
    `<path d="M470 640 L520 600" stroke="#5b8a3a" stroke-width="4"/><ellipse cx="530" cy="595" rx="20" ry="9" fill="#6ba34a" transform="rotate(-30 530 595)"/>` + grains;
});
add('farm-pure-groundnut-oil', '#fff4c9', () => {
  const oil = lin([[0, '#c98a0e'], [0.4, '#f6c23a'], [1, '#b0760a']], 0, 0, 1, 0);
  const nut = (x, y, r) => `<g transform="rotate(${r} ${x} ${y})"><path d="M${x - 40} ${y} Q${x - 40} ${y - 26} ${x - 18} ${y - 24} Q${x} ${y - 10} ${x + 18} ${y - 24} Q${x + 40} ${y - 26} ${x + 40} ${y} Q${x + 40} ${y + 26} ${x + 18} ${y + 24} Q${x} ${y + 10} ${x - 18} ${y + 24} Q${x - 40} ${y + 26} ${x - 40} ${y} Z" fill="#d7a868" stroke="#b07d3e" stroke-width="2"/></g>`;
  return shadow(400, 650, 240, 24) +
    `<path d="M340 150 L460 150 L460 220 Q520 250 520 320 L520 610 Q520 640 490 640 L310 640 Q280 640 280 610 L280 320 Q280 250 340 220 Z" fill="${oil}" opacity=".95"/>` +
    `<rect x="345" y="105" width="110" height="55" rx="10" fill="#2e7d32"/>` +
    `<rect x="290" y="380" width="220" height="180" rx="8" fill="#fffaf0"/>` +
    text(400, 420, 'FARM PURE', 16, '#2e7d32', { w: 800, ls: 3 }) + text(400, 466, 'Groundnut', 28, '#5a3a10', { w: 700, f: SERIF }) + text(400, 496, 'Oil', 28, '#5a3a10', { w: 700, f: SERIF }) +
    text(400, 528, 'Cold pressed · 1 L', 14, '#7a5a2a', { w: 600 }) +
    `<rect x="298" y="240" width="18" height="380" rx="9" fill="#fff" opacity=".28"/>` +
    nut(600, 610, -20) + nut(660, 580, 30) + nut(200, 615, 15);
});
add('tea-valley-assam', '#eadfd4', () => {
  return shadow(400, 650, 300, 26) +
    `<rect x="170" y="190" width="260" height="440" rx="10" fill="${lin([[0, '#1f5133'], [1, '#0f2f1d']], 0, 0, 1, 0)}"/>` +
    `<rect x="170" y="190" width="260" height="40" fill="#c9a24a"/>` + text(300, 217, 'TEA VALLEY', 16, '#1f5133', { w: 800, ls: 3 }) +
    `<path d="M240 330 Q300 260 360 330 Q300 400 240 330 Z" fill="#6fae5a"/><path d="M250 330 L350 330" stroke="#2e6b2a" stroke-width="3"/>` +
    text(300, 450, 'ASSAM', 46, '#f3d58a', { w: 800, f: SERIF, ls: 2 }) + text(300, 488, 'TEA', 30, '#f3d58a', { w: 700, ls: 8 }) +
    text(300, 560, 'Strong CTC · 1 kg', 15, '#d9c78f', { w: 600 }) +
    `<path d="M440 470 L640 470 Q640 600 540 610 Q440 600 440 470 Z" fill="#fff"/><path d="M640 500 Q690 500 690 540 Q690 580 630 575" fill="none" stroke="#fff" stroke-width="16"/>` +
    `<ellipse cx="540" cy="472" rx="100" ry="16" fill="${lin([[0, '#a0521d'], [1, '#6e3510']], 0, 0, 1, 0)}"/>` +
    `<ellipse cx="540" cy="620" rx="130" ry="18" fill="#f3efe9"/>` +
    `<path d="M510 440 Q490 400 515 370 M560 440 Q540 395 565 360" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>`;
});
add('kitchenpro-mixer', '#e3f0f7', () => {
  const steel = lin([[0, '#8c949e'], [0.3, '#f4f7fa'], [0.6, '#bfc6ce'], [1, '#8a929b']], 0, 0, 1, 0);
  return shadow(400, 650, 300, 28) +
    `<path d="M240 420 L560 420 L590 630 L210 630 Z" fill="${lin([[0, '#ffffff'], [1, '#d2d7df']], 0, 0, 1, 1)}"/>` +
    `<circle cx="400" cy="540" r="40" fill="#2a2e36"/><circle cx="400" cy="540" r="30" fill="#4a5060"/><rect x="396" y="512" width="8" height="22" rx="4" fill="#d9dde4"/>` +
    text(400, 610, 'KitchenPro 750W', 15, '#5a6170', { w: 700 }) +
    `<path d="M290 160 L510 160 L490 410 L310 410 Z" fill="${steel}"/><rect x="280" y="140" width="240" height="30" rx="10" fill="#2a2e36"/>` +
    `<path d="M510 200 Q570 210 560 300 Q550 360 500 360" fill="none" stroke="#2a2e36" stroke-width="20"/>` +
    `<rect x="300" y="400" width="200" height="26" rx="6" fill="#2a2e36"/>` +
    `<path d="M600 470 L700 470 L692 610 L608 610 Z" fill="${steel}"/><rect x="595" y="456" width="110" height="20" rx="6" fill="#2a2e36"/>` +
    `<path d="M120 500 L200 500 L194 620 L126 620 Z" fill="${steel}"/><rect x="115" y="486" width="90" height="18" rx="6" fill="#2a2e36"/>`;
});
add('coolbreeze-split-ac', '#dff1fb', () => {
  return shadow(400, 560, 320, 24) +
    `<path d="M90 230 Q90 200 120 200 L680 200 Q710 200 710 230 L710 380 Q710 420 670 420 L130 420 Q90 420 90 380 Z" fill="${lin([[0, '#ffffff'], [1, '#dfe6ee']], 0, 0, 0, 1)}"/>` +
    `<path d="M110 360 L690 360 L680 400 Q675 410 660 410 L140 410 Q125 410 120 400 Z" fill="#cbd5df"/>` +
    [0, 1, 2, 3].map((i) => `<rect x="130" y="${372 + i * 8}" width="540" height="3" fill="#aab6c2"/>`).join('') +
    `<rect x="560" y="250" width="90" height="34" rx="6" fill="#0f2233"/>` + text(605, 275, '24°C', 20, '#6fd0ff', { w: 700 }) +
    text(160, 270, 'CoolBreeze', 22, '#5a6a7a', { w: 800, a: 'start' }) + `<circle cx="140" cy="320" r="6" fill="#4caf50"/>` +
    [0, 1, 2].map((i) => `<path d="M${250 + i * 140} 440 Q${270 + i * 140} 490 ${240 + i * 140} 540" fill="none" stroke="#7cc8f0" stroke-width="6" stroke-linecap="round" opacity="${0.8 - i * 0.15}"/>`).join('') +
    `<rect x="560" y="470" width="80" height="170" rx="20" fill="#f7f9fb" stroke="#ccd5de"/><rect x="574" y="490" width="52" height="34" rx="4" fill="#0f2233"/>` +
    [0, 1, 2].map((r) => [0, 1].map((c) => `<circle cx="${586 + c * 28}" cy="${550 + r * 26}" r="8" fill="#cfd8e1"/>`).join('')).join('');
});
add('washmate-front-load', '#e7ecf3', () => {
  return shadow(400, 690, 260, 26) +
    `<rect x="200" y="130" width="400" height="540" rx="24" fill="${lin([[0, '#ffffff'], [1, '#d7dde6']], 0, 0, 1, 1)}"/>` +
    `<rect x="200" y="130" width="400" height="110" rx="24" fill="#eef2f7"/><rect x="200" y="225" width="400" height="6" fill="#cfd6e0"/>` +
    `<rect x="225" y="160" width="110" height="50" rx="8" fill="#e1e6ee"/><circle cx="500" cy="185" r="32" fill="#cfd6e0"/><circle cx="500" cy="185" r="22" fill="#eef2f7"/>` +
    `<rect x="380" y="168" width="70" height="34" rx="5" fill="#13212e"/>` + text(415, 192, '1:20', 18, '#7fe0ff', { w: 700 }) +
    `<circle cx="400" cy="450" r="160" fill="#c7ced8"/><circle cx="400" cy="450" r="140" fill="#9aa5b3"/>` +
    `<circle cx="400" cy="450" r="120" fill="${rad([[0, '#bfe3ff'], [0.6, '#4f86b8'], [1, '#22476b']], 0.4, 0.35, 0.7)}"/>` +
    `<path d="M300 480 Q350 440 400 480 T500 480 L500 530 Q450 570 400 570 Q350 570 300 530 Z" fill="#fff" opacity=".35"/>` +
    `<path d="M320 390 Q360 350 420 350" stroke="#fff" stroke-opacity=".6" stroke-width="10" fill="none" stroke-linecap="round"/>` +
    text(400, 640, 'WashMate 7kg', 16, '#7a8696', { w: 700 });
});
add('crispair-air-fryer', '#f2e4dc', () => {
  const body = lin([[0, '#3a3c42'], [0.5, '#1d1e22'], [1, '#0e0f12']], 0, 0, 1, 0);
  const fry = (x, y, r) => `<rect x="${x}" y="${y}" width="16" height="70" rx="4" fill="#f2b84b" stroke="#d58f1e" transform="rotate(${r} ${x} ${y})"/>`;
  return shadow(400, 660, 260, 26) +
    `<path d="M240 200 Q240 140 300 140 L500 140 Q560 140 560 200 L580 600 Q580 640 540 640 L260 640 Q220 640 220 600 Z" fill="${body}"/>` +
    `<rect x="290" y="180" width="220" height="90" rx="14" fill="#0b0c0e"/>` + text(400, 232, '200°C', 30, '#ff8a3d', { w: 700 }) + text(400, 256, '15 min', 14, '#aaa', { w: 600 }) +
    `<path d="M236 360 L564 360 L578 600 Q578 630 548 630 L252 630 Q222 630 222 600 Z" fill="#2a2c31"/>` +
    `<rect x="340" y="440" width="120" height="44" rx="22" fill="#4a4d55"/>` +
    `<path d="M250 340 L550 340" stroke="#000" stroke-opacity=".5" stroke-width="4"/>` +
    text(400, 600, 'CrispAir', 18, '#9a9ca3', { w: 800, ls: 2 }) +
    `<rect x="252" y="160" width="14" height="440" rx="7" fill="#fff" opacity=".08"/>` +
    `<path d="M590 640 Q600 590 680 590 L700 640 Z" fill="#e7d5c5"/>` + fry(610, 520, 18) + fry(640, 515, -8) + fry(668, 525, 24) + fry(625, 540, -20);
});

// Small seeded random so the scattered rice is the same on every run.
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FILES = ART.map(([file]) => file);
module.exports = { FILES };

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [file, bg, body] of ART) {
    const inner = body();
    fs.writeFileSync(path.join(OUT, `${file}.svg`), page(bg, inner));
  }
  console.log(`Drew ${ART.length} product pictures in ${path.relative(process.cwd(), OUT)}`);
}
