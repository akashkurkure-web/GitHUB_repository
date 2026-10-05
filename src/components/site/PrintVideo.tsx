// @ts-nocheck — canvas drawing code, intentionally untyped
"use client";
import { useEffect, useRef, useState } from "react";

type Kind = "fdm" | "fdm2" | "resin";
const SCENES = {
  fdm: { dur: 14, color: "#ff8a3d", shape: "vase", caps: [[0, "Heating nozzle to 215 °C"], [1.2, "Printing PLA+ vase · 0.20 mm layers"], [12, "Print complete · cooling"]] },
  fdm2: { dur: 14, color: "#2f9bff", shape: "bracket", caps: [[0, "Levelling the bed"], [1.2, "Printing PETG bracket · 25% infill"], [12, "Done · ready for QC weighing"]] },
  resin: { dur: 14, color: "#34d1c9", caps: [[0, "Lowering plate into resin vat"], [1, "UV exposure · 0.05 mm layers"], [12, "Lifted · next: IPA wash and UV cure"]] },
};
const iso = (x, y, z, cx, cy, s) => [cx + (x - z) * s * 0.866, cy + (x + z) * s * 0.5 - y * s];
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (c) => Math.max(0, Math.min(255, Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f))));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}
function bg(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "#0c2242"); g.addColorStop(1, "#06142a"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}
const vaseR = (t) => 0.55 + 0.18 * Math.sin(t * Math.PI * 1.6 + 0.4) + 0.12 * t;
const bracketW = (t) => (t < 0.25 ? 1 : t < 0.3 ? 1 - (t - 0.25) * 10 : 0.5);
function layer(ctx, shape, tt, y, cx, cy, s, fill, frac) {
  ctx.fillStyle = fill; ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1;
  let pts = [];
  if (shape === "vase") { const r = vaseR(tt) * 1.25; for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } }
  else { const wx = 1.6 * bracketW(tt); pts = [[-1.6, -1], [-1.6 + 2 * wx, -1], [-1.6 + 2 * wx, 1], [-1.6, 1], [-1.6, -1]]; }
  ctx.beginPath(); pts.forEach((p, i) => { const q = iso(p[0], y, p[1], cx, cy, s); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); ctx.fill(); ctx.stroke();
  let total = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
  let target = total * frac, acc = 0;
  for (let i = 0; i < seg.length; i++) { if (acc + seg[i] >= target) { const f = (target - acc) / seg[i]; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; } acc += seg[i]; }
  return pts[pts.length - 1];
}
function hud(ctx, w, h, items, prog) {
  const fs = Math.max(10, Math.min(13, w / 42)); ctx.font = `600 ${fs}px "JetBrains Mono",monospace`;
  let x = 14;
  items.forEach(([k, v]) => {
    const tw = ctx.measureText(`${k} ${v}`).width + 16;
    ctx.fillStyle = "rgba(6,20,42,.75)"; ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.beginPath(); ctx.rect(x, 12, tw, fs + 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffc15e"; ctx.fillText(k, x + 8, 12 + fs + 3); ctx.fillStyle = "#e7eef8"; ctx.fillText(v, x + 8 + ctx.measureText(k + " ").width, 12 + fs + 3);
    x += tw + 8;
  });
  ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(0, h - 4, w, 4); ctx.fillStyle = "#ff8a3d"; ctx.fillRect(0, h - 4, w * prog, 4);
}
function drawFDM(ctx, w, h, t, sc) {
  bg(ctx, w, h); const s = Math.min(w, h) / 7.2, cx = w / 2, cy = h * 0.62;
  const L = sc.shape === "vase" ? 60 : 48, prog = Math.max(0, Math.min(1, (t - 1.2) / 10.8)), done = prog * L, cur = Math.floor(done), lh = sc.shape === "vase" ? 0.045 : 0.04;
  const bed = [[-2.2, -2.2], [2.2, -2.2], [2.2, 2.2], [-2.2, 2.2]].map((p) => iso(p[0], 0, p[1], cx, cy, s));
  ctx.fillStyle = "#1d3a63"; ctx.beginPath(); bed.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
  for (let i = -2; i <= 2; i += 0.5) { let a = iso(i, 0, -2.2, cx, cy, s), b = iso(i, 0, 2.2, cx, cy, s); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); a = iso(-2.2, 0, i, cx, cy, s); b = iso(2.2, 0, i, cx, cy, s); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  for (let i = 0; i < cur; i++) layer(ctx, sc.shape, i / L, i * lh, cx, cy, s, shade(sc.color, (i % 2 ? -0.05 : 0.05) - 0.15 + (i / L) * 0.25), 1);
  let noz = null;
  if (prog > 0 && prog < 1) noz = layer(ctx, sc.shape, cur / L, cur * lh, cx, cy, s, shade(sc.color, 0.35), done - cur);
  const gy = (prog >= 1 ? L * lh + 0.5 : cur * lh + 0.32) + 0.1, np = noz || [0, 0];
  const a = iso(-2.4, gy + 0.25, np[1], cx, cy, s), b = iso(2.4, gy + 0.25, np[1], cx, cy, s);
  ctx.strokeStyle = "#8aa5cc"; ctx.lineWidth = Math.max(3, s * 0.09); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  const hp = iso(np[0], gy + 0.25, np[1], cx, cy, s);
  ctx.fillStyle = "#e7eef8"; ctx.fillRect(hp[0] - s * 0.28, hp[1] - s * 0.32, s * 0.56, s * 0.42);
  ctx.fillStyle = "#ff6b1a"; ctx.fillRect(hp[0] - s * 0.28, hp[1] - s * 0.32, s * 0.56, s * 0.08);
  ctx.fillStyle = "#c8d3e3"; ctx.beginPath(); ctx.moveTo(hp[0] - s * 0.1, hp[1] + s * 0.1); ctx.lineTo(hp[0] + s * 0.1, hp[1] + s * 0.1); ctx.lineTo(hp[0], hp[1] + s * 0.24); ctx.closePath(); ctx.fill();
  if (noz) { ctx.fillStyle = "rgba(255,170,90,.9)"; ctx.beginPath(); ctx.arc(hp[0], hp[1] + s * 0.26, s * 0.05, 0, 7); ctx.fill(); ctx.fillStyle = "rgba(255,140,60,.25)"; ctx.beginPath(); ctx.arc(hp[0], hp[1] + s * 0.26, s * 0.16, 0, 7); ctx.fill(); }
  hud(ctx, w, h, [["LAYER", `${Math.min(L, cur + (prog > 0 ? 1 : 0))} / ${L}`], ["NOZZLE", t < 1.2 ? `${Math.round(25 + (190 * t) / 1.2)} °C` : "215 °C"], ["BED", "60 °C"]], prog);
}
function drawResin(ctx, w, h, t) {
  bg(ctx, w, h); const s = Math.min(w, h) / 7, cx = w / 2, cy = h * 0.7;
  const L = 40, prog = Math.max(0, Math.min(1, (t - 1) / 11)), layers = Math.floor(prog * L), cycle = (prog * L) % 1;
  const lift = t < 1 ? (1 - t) * 2.2 : prog >= 1 ? Math.min(2.6, (t - 12) * 1.6 + 0.2) : cycle < 0.55 ? 0.02 : (cycle - 0.55) * 0.6;
  const vat = [[-2, -1.4], [2, -1.4], [2, 1.4], [-2, 1.4]], uv = prog > 0 && prog < 1 && cycle < 0.55;
  const v = vat.map((p) => iso(p[0], 0, p[1], cx, cy, s));
  ctx.fillStyle = uv ? "rgba(150,90,255,.55)" : "#1a2c4a"; ctx.beginPath(); v.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  if (uv) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 3); g.addColorStop(0, "rgba(170,110,255,.45)"); g.addColorStop(1, "rgba(170,110,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
  const lv = vat.map((p) => iso(p[0], 0.35, p[1], cx, cy, s));
  ctx.fillStyle = "rgba(52,209,201,.35)"; ctx.beginPath(); lv.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#7fa1cf"; ctx.lineWidth = 2;
  [vat[1], vat[2], vat[3]].forEach((p) => { const a = iso(p[0], 0, p[1], cx, cy, s), b = iso(p[0], 0.6, p[1], cx, cy, s); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
  const plateY = 0.05 + layers * 0.05 + lift;
  for (let i = 0; i < layers; i++) {
    const y = plateY - (i + 1) * 0.05, tt = i / L, r = tt < 0.2 ? 0.9 : tt < 0.8 ? 0.45 + 0.25 * Math.sin(tt * 9) : 0.75;
    ctx.fillStyle = shade("#34d1c9", -0.35 + tt * 0.3); ctx.beginPath();
    for (let k = 0; k <= 24; k++) { const a = (k / 24) * Math.PI * 2, q = iso(Math.cos(a) * r, y, Math.sin(a) * r * 0.8, cx, cy, s); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
    ctx.fill();
  }
  const pl = [[-1.4, -1], [1.4, -1], [1.4, 1], [-1.4, 1]].map((p) => iso(p[0], plateY, p[1], cx, cy, s));
  ctx.fillStyle = "#c9d4e4"; ctx.beginPath(); pl.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  const a1 = iso(0, plateY + 0.05, 0, cx, cy, s), a2 = iso(0, plateY + 2.6, 0, cx, cy, s);
  ctx.strokeStyle = "#9fb2cc"; ctx.lineWidth = Math.max(3, s * 0.12); ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();
  hud(ctx, w, h, [["LAYER", `${layers} / ${L}`], ["UV", uv ? "ON · 2.5 s" : "OFF"], ["LAYER H", "0.05 mm"]], prog);
}

export default function PrintVideo({ kind, autoplay = false, label }: { kind: Kind; autoplay?: boolean; label: string }) {
  const sc = SCENES[kind];
  const cv = useRef<HTMLCanvasElement>(null);
  const st = useRef({ t: sc.dur * 0.55, playing: false, last: 0 });
  const [playing, setPlaying] = useState(false);
  const [cap, setCap] = useState("Press play");
  const bar = useRef<HTMLElement>(null);

  const frame = () => {
    const c = cv.current; if (!c) return;
    const r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr); if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0);
    (kind === "resin" ? drawResin : drawFDM)(ctx, W, H, st.current.t, sc);
    if (bar.current) bar.current.style.width = `${(st.current.t / sc.dur) * 100}%`;
    let c2 = sc.caps[0][1]; sc.caps.forEach(([at, txt]) => { if (st.current.t >= at) c2 = txt; }); setCap(c2);
  };
  const loop = (ts) => {
    const p = st.current; if (!p.playing) return;
    const dt = p.last ? (ts - p.last) / 1000 : 0; p.last = ts; p.t += dt; if (p.t > sc.dur + 1.2) p.t = 0;
    frame(); requestAnimationFrame(loop);
  };
  const set = (on) => { st.current.playing = on; st.current.last = 0; setPlaying(on); if (on) requestAnimationFrame(loop); };

  useEffect(() => {
    const ro = new ResizeObserver(frame); if (cv.current) ro.observe(cv.current);
    frame();
    if (autoplay && !matchMedia("(prefers-reduced-motion: reduce)").matches) { st.current.t = 0; set(true); }
    return () => { st.current.playing = false; ro.disconnect(); };
  }, []);

  return (
    <div className="player">
      <canvas ref={cv} aria-label={label} />
      <div className="pbar">
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (!playing && st.current.t >= sc.dur) st.current.t = 0; set(!playing); }}>
          {playing ? <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="3" height="10" fill="currentColor" /><rect x="7" y="1" width="3" height="10" fill="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" fill="currentColor" /></svg>}
        </button>
        <div className="track" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); st.current.t = ((e.clientX - r.left) / r.width) * sc.dur; frame(); }}><i ref={bar} /></div>
        <span className="cap">{cap}</span>
      </div>
    </div>
  );
}
