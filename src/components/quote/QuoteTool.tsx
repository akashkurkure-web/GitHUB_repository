"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as THREE from "three";
import { analyse, parseSTL, type MeshMetrics } from "@/lib/stl";
import {
  colorsFor, GSTIN_RE, LAYERS, fits, gstSplit, priceItem, recommend, round2,
  type ItemConfig, type Material, type Tier,
} from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";
import { addToCart } from "@/lib/cart";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function samplePart(): Float32Array {
  const s = new THREE.Shape(), w = 72, h = 40, r = 6;
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  [[-26, 0], [26, 0]].forEach(([x, y]) => { const c = new THREE.Path(); c.absarc(x, y, 3.2, 0, Math.PI * 2, true); s.holes.push(c); });
  const sl = new THREE.Path(); sl.moveTo(-10, -4); sl.lineTo(-10, 4); sl.lineTo(10, 4); sl.lineTo(10, -4); sl.lineTo(-10, -4); s.holes.push(sl);
  const g = new THREE.ExtrudeGeometry(s, { depth: 8, bevelEnabled: false, curveSegments: 18 }).toNonIndexed();
  return new Float32Array(g.attributes.position.array as ArrayLike<number>);
}

export default function QuoteTool({ materials, tiers, fees = { shipping: 90, express: 249, expressOn: true, expressHours: 6 } }: { materials: Material[]; tiers: Tier[]; fees?: { shipping: number; express: number; expressOn: boolean; expressHours: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const three = useRef<{ r: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; grp: THREE.Group; mesh?: THREE.Mesh; rx: number; ry: number } | null>(null);
  const fileBuf = useRef<Float32Array | null>(null);
  const [fileName, setFileName] = useState("sensor-mount-sample.stl");
  const [sample, setSample] = useState(true);
  const [metrics, setMetrics] = useState<MeshMetrics | null>(null);
  const [unit, setUnit] = useState(1);
  const [upload, setUpload] = useState<{ state: "idle" | "uploading" | "ready" | "error"; path?: string; assetId?: string; msg?: string }>({ state: "idle" });
  const [mode, setMode] = useState<ItemConfig["selection_mode"]>("manual_user");
  const [env, setEnv] = useState("indoor");
  const [stress, setStress] = useState("display");
  const [mat, setMat] = useState("pla");
  const [color, setColor] = useState(5);
  const [infill, setInfill] = useState(25);
  const [layer, setLayer] = useState(0.2);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [gstin, setGstin] = useState("");
  const [express, setExpress] = useState(false);
  const [toast, setToast] = useState<{ t: string; ok: boolean } | null>(null);
  const [over, setOver] = useState(false);

  const effMat = mode === "manual_user" ? mat : recommend(env, stress).code;
  const m = materials.find((x) => x.material_code === effMat) ?? materials[0];
  const cols = colorsFor(m);
  const colorIdx = color < cols.length ? color : 0;

  // keep layer valid for tech
  useEffect(() => {
    const ok = LAYERS[m.technology].some(([v]) => v === layer);
    if (!ok) setLayer(m.technology === "fdm" ? 0.2 : 0.05);
  }, [m.technology]); // eslint-disable-line react-hooks/exhaustive-deps

  // viewer
  useEffect(() => {
    const cv = canvas.current!;
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { return; }
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.95));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7); dl.position.set(1, 2, 3); scene.add(dl);
    const grp = new THREE.Group(); scene.add(grp);
    three.current = { r, scene, cam, grp, rx: -0.9, ry: 0.6 };
    let drag: [number, number] | null = null;
    const down = (e: PointerEvent) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (!drag || !three.current) return; three.current.ry += (e.clientX - drag[0]) * 0.01; three.current.rx += (e.clientY - drag[1]) * 0.01; drag = [e.clientX, e.clientY]; draw(); };
    const up = () => (drag = null);
    cv.addEventListener("pointerdown", down); cv.addEventListener("pointermove", move); cv.addEventListener("pointerup", up);
    const ro = new ResizeObserver(size); ro.observe(cv);
    const pos = samplePart(); fileBuf.current = pos; setMetrics(analyse(pos)); show(pos);
    return () => { ro.disconnect(); r.dispose(); three.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function size() {
    const t = three.current, cv = canvas.current; if (!t || !cv) return;
    const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
    t.r.setPixelRatio(Math.min(devicePixelRatio, 2)); t.r.setSize(w, h, false); t.cam.aspect = w / h; t.cam.updateProjectionMatrix(); draw();
  }
  function draw() { const t = three.current; if (!t) return; t.grp.rotation.set(t.rx, t.ry, 0); t.r.render(t.scene, t.cam); }
  function show(pos: Float32Array) {
    const t = three.current; if (!t) return;
    if (t.mesh) { t.grp.remove(t.mesh); t.mesh.geometry.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals(); g.computeBoundingSphere(); g.center();
    t.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: cols[colorIdx][1], roughness: 0.5, metalness: 0.05, flatShading: true }));
    t.grp.add(t.mesh);
    const rad = g.boundingSphere?.radius || 1; t.cam.position.set(0, 0, rad * 3.4); t.cam.near = rad / 50; t.cam.far = rad * 20; t.cam.updateProjectionMatrix(); draw();
  }
  useEffect(() => { const t = three.current; if (t?.mesh) { (t.mesh.material as THREE.MeshStandardMaterial).color.set(cols[colorIdx][1]); draw(); } }, [colorIdx, m.technology]); // eslint-disable-line

  async function register(path: string, name: string, scale: number) {
    const res = await fetch("/api/cad/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, fileName: name, unitScale: scale }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Upload failed.");
    return j.asset.id as string;
  }

  async function onFile(f?: File | null) {
    if (!f) return;
    setToast(null);
    if (!/\.stl$/i.test(f.name)) { setToast({ t: "The instant quote reads .stl files. Export an STL from your CAD tool and try again.", ok: false }); return; }
    if (f.size > 50 * 1024 * 1024) { setToast({ t: "Files must be under 50 MB. Reduce the mesh resolution and export again.", ok: false }); return; }
    let pos: Float32Array;
    try { pos = parseSTL(await f.arrayBuffer()); } catch (e: any) { setToast({ t: e.message, ok: false }); return; }
    fileBuf.current = pos; setFileName(f.name); setSample(false); setMetrics(analyse(pos, unit)); show(pos);
    setUpload({ state: "uploading" });
    try {
      const r1 = await fetch("/api/cad/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: f.name, size: f.size }) });
      const j1 = await r1.json(); if (!r1.ok) throw new Error(j1.error);
      const { error } = await createClient().storage.from("cad-files").uploadToSignedUrl(j1.path, j1.token, f, { contentType: "model/stl" });
      if (error) throw new Error("Upload interrupted. Check your connection and try again.");
      const id = await register(j1.path, f.name, unit);
      setUpload({ state: "ready", path: j1.path, assetId: id });
    } catch (e: any) {
      setUpload({ state: "error", msg: e.message || "Upload failed." });
    }
  }

  async function onUnit(v: number) {
    setUnit(v);
    if (fileBuf.current) setMetrics(analyse(fileBuf.current, v));
    if (upload.state === "ready" && upload.path) {
      setUpload({ ...upload, state: "uploading" });
      try { setUpload({ state: "ready", path: upload.path, assetId: await register(upload.path, fileName, v) }); }
      catch (e: any) { setUpload({ state: "error", msg: e.message }); }
    }
  }

  const cfg: ItemConfig = { material: m.material_code, color: cols[colorIdx][0], infill, layer, quantity: qty, selection_mode: mode, environment: env, stress, notes };
  const q = useMemo(() => (metrics ? priceItem(metrics.volume_cm3, m, cfg, tiers) : null), [metrics, m, infill, layer, qty, mode, env, stress]); // eslint-disable-line
  const gOk = !gstin || GSTIN_RE.test(gstin.toUpperCase());
  const est = useMemo(() => {
    if (!q) return null;
    let sub = q.line; const top = sub < m.minimum_order_value_inr ? m.minimum_order_value_inr - sub : 0; sub += top;
    const ship = express ? fees.express : fees.shipping; const taxable = round2(sub + ship); const g = gstSplit(taxable, gOk ? gstin.toUpperCase() : null);
    return { top, ship, taxable, g, total: round2(taxable + g.tax) };
  }, [q, express, gstin, gOk, m.minimum_order_value_inr]);

  const chips: [string, string, string][] = [];
  if (metrics) {
    chips.push(fits(metrics.bbox_mm, m.technology) ? ["ok", "FITS", `Fits the ${m.technology === "fdm" ? "FDM" : "resin"} build volume.`] : ["bad", "TOO BIG", "Larger than our build volume. Raise a support ticket and we'll split it."]);
    if (metrics.watertight === true) chips.push(["ok", "CLOSED", "Mesh is watertight, so the price is reliable."]);
    else if (metrics.watertight === false) chips.push(["warn", "OPEN", `${metrics.open_edges.toLocaleString("en-IN")} open edges. We repair before printing; price may change slightly.`]);
    if (Math.min(...metrics.bbox_mm) < 1) chips.push(["warn", "THIN", "One dimension is under 1 mm. Check the file units."]);
    if (express && q && q.hours * q.qty > fees.expressHours) chips.push(["warn", "EXPRESS", `Over ${fees.expressHours} h of print time, so same-day isn't possible.`]);
  }

  function add() {
    if (sample || upload.state !== "ready" || !upload.assetId || !metrics) { setToast({ t: "Upload your own STL first. The part shown is a sample.", ok: false }); return; }
    if (!fits(metrics.bbox_mm, m.technology)) { setToast({ t: "This part is larger than the build volume.", ok: false }); return; }
    addToCart({ key: crypto.randomUUID(), cad_asset_id: upload.assetId, file_name: fileName, volume_cm3: metrics.volume_cm3, bbox_mm: metrics.bbox_mm, watertight: metrics.watertight, config: cfg });
    setToast({ t: `${fileName} added to your cart.`, ok: true });
  }

  return (
    <div className="tool">
      <div className="viewer">
        <span className={`vtag${sample ? " sample" : ""}`}>{sample ? "Sample part · sensor mount" : fileName}</span>
        <canvas ref={canvas} className="stage" aria-label="3D preview. Drag to rotate." />
        <div className="dims">
          <div><span>X × Y × Z mm</span><b>{metrics ? metrics.bbox_mm.map((v) => v.toFixed(1)).join(" × ") : "–"}</b></div>
          <div><span>Volume</span><b>{metrics ? metrics.volume_cm3.toFixed(2) + " cm³" : "–"}</b></div>
          <div><span>Surface</span><b>{metrics ? metrics.surface_area_cm2.toFixed(1) + " cm²" : "–"}</b></div>
          <div><span>Triangles</span><b>{metrics ? metrics.triangles.toLocaleString("en-IN") : "–"}</b></div>
        </div>
        <div className={`drop${over ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}>
          <label htmlFor="stl">Choose an STL file</label> or drop it here · up to 50 MB
          <input id="stl" type="file" accept=".stl,model/stl" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} onChange={(e) => onFile(e.target.files?.[0])} />
          {upload.state === "uploading" && <div style={{ marginTop: 8 }}><div className="prog"><i style={{ width: "70%" }} /></div><span className="muted">Uploading to your private vault…</span></div>}
          {upload.state === "ready" && <div className="toast ok" style={{ marginTop: 6 }}>Saved securely. Ready to order.</div>}
          {upload.state === "error" && <div className="toast bad" style={{ marginTop: 6 }}>{upload.msg}</div>}
        </div>
      </div>

      <div className="config">
        <div className="field" style={{ display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: ".74rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>Who picks the material</span>
          <div className="seg">
            {([["manual_user", "I choose"], ["ai_recommended", "Recommend one"], ["manufacturer_decides", "Engineer decides"]] as const).map(([k, t]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{t}</button>
            ))}
          </div>
        </div>
        {mode !== "manual_user" && (
          <>
            <div className="row2">
              <label className="f">Where it&apos;s used<select id="env" value={env} onChange={(e) => setEnv(e.target.value)}><option value="indoor">Indoor / desk</option><option value="outdoor">Outdoor / sunlight</option><option value="heat">Near heat (60–90 °C)</option><option value="automotive">Automotive</option></select></label>
              <label className="f">Mechanical load<select id="stress" value={stress} onChange={(e) => setStress(e.target.value)}><option value="display">Display / fit check</option><option value="moderate">Snap fits</option><option value="high">Load bearing</option><option value="flex">Needs to flex</option><option value="detail">Fine detail</option></select></label>
            </div>
            <div className="ai-pick">{mode === "ai_recommended" ? "Recommended" : "Likely material"}: <b>{m.display_name}</b>. {recommend(env, stress).why}{mode === "manufacturer_decides" && " A print engineer confirms before printing."}</div>
          </>
        )}
        <div className="row2">
          <label className="f">Material<select id="mat" value={m.material_code} disabled={mode !== "manual_user"} onChange={(e) => setMat(e.target.value)}>{materials.map((x) => <option key={x.material_code} value={x.material_code}>{x.display_name}</option>)}</select></label>
          <label className="f">Layer height<select id="layer" value={layer} onChange={(e) => setLayer(Number(e.target.value))}>{LAYERS[m.technology].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <span className="f">Colour · <span className="mono">{cols[colorIdx][0]}</span></span>
          <div className="swatches">{cols.map(([n, hex], i) => <button key={n} type="button" className="sw" style={{ background: hex }} aria-label={n} aria-pressed={i === colorIdx} onClick={() => setColor(i)} />)}</div>
        </div>
        {m.technology === "fdm" && <label className="f">Infill · <span className="mono">{infill}%</span><input id="infill" type="range" min={20} max={100} step={5} value={infill} onChange={(e) => setInfill(Number(e.target.value))} style={{ accentColor: "var(--accent)" }} /></label>}
        <div className="row2">
          <label className="f">Quantity<input id="qty" type="number" min={1} max={5000} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></label>
          <label className="f">File units<select id="unit" value={unit} onChange={(e) => onUnit(Number(e.target.value))}><option value={1}>Millimetres</option><option value={25.4}>Inches</option></select></label>
        </div>
        <label className="f">Notes for the print engineer (optional)<textarea id="notes" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Which faces are cosmetic, threads, tolerances…" /></label>
        <label className="f">GSTIN for price preview (optional)<input id="gstin" value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27ABCDE1234F1Z5" />
          <span style={{ fontWeight: 400, color: gOk ? "var(--muted)" : "var(--bad)" }}>{!gstin ? "Without a GSTIN we bill as intra-state (CGST + SGST)." : !gOk ? "This doesn't match the 15-character GSTIN format." : gstin.startsWith("27") ? "Maharashtra: 9% CGST + 9% SGST." : `State ${gstin.slice(0, 2)}: 18% IGST.`}</span>
        </label>
        {fees.expressOn && <label className="row" style={{ background: "var(--teal-soft)", borderRadius: 10, padding: "10px 12px", alignItems: "flex-start", fontSize: ".88rem", gap: 10 }}>
          <input id="express" type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} style={{ width: "auto", marginTop: 4 }} />
          <span><b>MMR same-day express</b><br /><span className="muted">Mumbai, Thane, Navi Mumbai. Under {fees.expressHours} h print time, ordered before 11:00 AM.</span></span>
        </label>}
        <div style={{ display: "grid", gap: 6 }}>{chips.map(([c, t, x]) => <div key={t} className={`chip ${c}`}><i>{t}</i><span>{x}</span></div>)}</div>
        {q && est && (
          <div className="bill">
            <div className="ln"><span>Est. mass · print time</span><span>{q.mass.toFixed(1)} g · {q.hours.toFixed(1)} h each</span></div>
            <div className="ln"><span>Unit price × {q.qty}</span><span>{inr(q.unit)} × {q.qty}</span></div>
            <div className="ln"><span>Setup (once per design)</span><span>{inr(q.setup)}</span></div>
            {q.discount > 0 && <div className="ln minus"><span>{q.tier.tier_badge_label} −{q.discountPct}%</span><span>− {inr(q.discount)}</span></div>}
            {est.top > 0 && <div className="ln"><span>Top-up to minimum order</span><span>{inr(est.top)}</span></div>}
            <div className="ln"><span>{express ? "MMR same-day express" : "Shipping (pan-India)"}</span><span>{inr(est.ship)}</span></div>
            <div className="ln"><span>Taxable value</span><span>{inr(est.taxable)}</span></div>
            {est.g.intra ? <><div className="ln"><span>CGST 9%</span><span>{inr(est.g.cgst)}</span></div><div className="ln"><span>SGST 9%</span><span>{inr(est.g.sgst)}</span></div></> : <div className="ln"><span>IGST 18%</span><span>{inr(est.g.igst)}</span></div>}
            <div className="total"><span><span className="eyebrow">Estimate incl. GST</span><br /><span className="mono" style={{ fontSize: ".72rem", color: "var(--blue)" }}>{q.tier.tier_badge_label} · HSN 39269099</span></span><b>{inr(est.total)}</b></div>
          </div>
        )}
        <div className="row">
          <button className="btn lg" type="button" onClick={add} disabled={upload.state === "uploading"}>{upload.state === "uploading" ? "Uploading…" : "Add to cart"}</button>
          <Link className="btn lg ghost" href="/cart">View cart</Link>
        </div>
        {toast && <p className={`toast ${toast.ok ? "ok" : "bad"}`} aria-live="polite">{toast.t} {toast.ok && <Link href="/cart">Go to cart →</Link>}</p>}
      </div>
    </div>
  );
}
