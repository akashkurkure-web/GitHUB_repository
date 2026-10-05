/** STL parsing and mesh metrics. Runs in the browser and on the server. */
export type MeshMetrics = {
  volume_cm3: number;
  surface_area_cm2: number;
  bbox_mm: [number, number, number];
  triangles: number;
  watertight: boolean | null;
  open_edges: number;
};

export function parseSTL(buf: ArrayBuffer): Float32Array {
  const dv = new DataView(buf);
  if (buf.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === buf.byteLength) {
      const p = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let j = 0; j < 9; j++) p[i * 9 + j] = dv.getFloat32(o + j * 4, true);
      }
      return p;
    }
  }
  const txt = new TextDecoder().decode(new Uint8Array(buf));
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const a: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) a.push(+m[1], +m[2], +m[3]);
  if (a.length < 9 || a.length % 9) throw new Error("This file has no readable triangles. Export it again as an STL from your CAD tool.");
  return new Float32Array(a);
}

export function analyse(pos: Float32Array, unitScale = 1): MeshMetrics {
  let vol = 0, area = 0;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const n = pos.length / 9;
  const check = n <= 400_000;
  const edges = new Map<string, number>();
  const key = (i: number) => `${Math.round(pos[i] * 1e3)},${Math.round(pos[i + 1] * 1e3)},${Math.round(pos[i + 2] * 1e3)}`;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2], bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5], cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    for (let k = 0; k < 9; k += 3) for (let a = 0; a < 3; a++) {
      const v = pos[o + k + a];
      if (v < mn[a]) mn[a] = v;
      if (v > mx[a]) mx[a] = v;
    }
    if (check) {
      const ka = key(o), kb = key(o + 3), kc = key(o + 6);
      for (const [p, q] of [[ka, kb], [kb, kc], [kc, ka]]) {
        if (p === q) continue;
        const e = p < q ? p + "|" + q : q + "|" + p;
        edges.set(e, (edges.get(e) || 0) + 1);
      }
    }
  }
  let open = 0;
  if (check) edges.forEach((c) => { if (c !== 2) open++; });
  const s = unitScale;
  return {
    volume_cm3: (Math.abs(vol) * s ** 3) / 1000,
    surface_area_cm2: (area * s ** 2) / 100,
    bbox_mm: [(mx[0] - mn[0]) * s, (mx[1] - mn[1]) * s, (mx[2] - mn[2]) * s],
    triangles: n,
    watertight: check ? open === 0 : null,
    open_edges: open,
  };
}
