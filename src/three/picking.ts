import * as THREE from 'three';
import type { Dem, PickResult } from '../core/types';
import { sceneY } from './coords';
import type { ThreeContext } from './scene';

const raycaster = new THREE.Raycaster();

/** Interroga il terreno lungo il raggio dal punto schermo, marciando fino a incontrare la superficie. */
export function pick(ctx: ThreeContext, dem: Dem, exag: number, clientX: number, clientY: number): PickResult | null {
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, ctx.camera);
  const o = raycaster.ray.origin, v = raycaster.ray.direction;
  const W = (dem.w - 1) * dem.cell, D = (dem.h - 1) * dem.cell, Y = (dem.zmax - dem.zmin) * exag + 1;
  let t0 = 0, t1 = Infinity;
  for (const [oo, vv, mn, mx] of [[o.x, v.x, 0, W], [o.y, v.y, -1, Y], [o.z, v.z, 0, D]] as const) {
    if (Math.abs(vv) < 1e-9) { if (oo < mn || oo > mx) return null; continue; }
    let a = (mn - oo) / vv, b = (mx - oo) / vv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  const f = (t: number) => { const x = o.x + v.x * t, z = o.z + v.z * t; return o.y + v.y * t - sceneY(dem, exag, x, z); };
  const step = Math.max(dem.cell * 0.5, (t1 - t0) / 6000);
  let ta = t0, fa = f(ta);
  if (fa <= 0) return null;
  for (let t = t0 + step; t <= t1 + step; t += step) {
    const tt = Math.min(t, t1), fb = f(tt);
    if (fb <= 0) {
      let lo = ta, hi = tt;
      for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
      const x = o.x + v.x * hi, z = o.z + v.z * hi;
      return { x, z };
    }
    ta = tt;
    if (tt >= t1) break;
  }
  return null;
}
