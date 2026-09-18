import * as THREE from 'three';
import type { Dem } from '../core/types';
import { extent, sceneY } from './coords';
import type { ThreeContext } from './scene';

/** Vista in pianta (plan=true) o prospettica, inquadrando tutto il terreno. */
export function fitView(ctx: ThreeContext, dem: Dem, exag: number, plan: boolean): void {
  const { W, D, Y } = extent(dem, exag);
  const R = Math.max(W, D) * (ctx.camera.aspect < 1 ? 0.75 / ctx.camera.aspect : 1);
  const cx = W / 2, cz = D / 2, cy = sceneY(dem, exag, cx, cz);
  ctx.controls.target.set(cx, cy, cz);
  if (plan) {
    ctx.camera.position.set(cx, cy + R * 1.25 + Y, cz + 0.001 * R);
  } else {
    ctx.camera.position.set(cx - R * 0.55, cy + R * 0.6 + Y * 0.5, cz + R * 0.75);
  }
  ctx.camera.near = Math.max(0.2, R / 20000);
  ctx.camera.far = R * 10 + Y * 4;
  ctx.camera.updateProjectionMatrix();
  ctx.scene.fog = new THREE.Fog((ctx.scene.background as THREE.Color) ?? 0x000000, R * 1.8, R * 7);
  ctx.controls.setFromCamera();
  ctx.controls.update();
}

export interface WasdKeys {
  w?: boolean; a?: boolean; s?: boolean; d?: boolean; shift?: boolean;
}

const _f = new THREE.Vector3(), _r = new THREE.Vector3();

/** Volo libero WASD: il bersaglio dei controlli segue il terreno sotto di sé. */
export function moveWasd(ctx: ThreeContext, dem: Dem | null, exag: number, keys: WasdKeys, dt: number): void {
  const f = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
  const r = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  if (!f && !r) return;
  ctx.camera.getWorldDirection(_f);
  _f.y = 0; _f.normalize();
  _r.crossVectors(_f, ctx.camera.up).normalize();
  const dist = ctx.camera.position.distanceTo(ctx.controls.target);
  const sp = Math.max(dist * 0.6, 20) * (keys.shift ? 3 : 1) * dt;
  const mv = _f.multiplyScalar(f * sp).add(_r.multiplyScalar(r * sp));
  ctx.camera.position.add(mv);
  ctx.controls.target.add(mv);
  if (dem) {
    const { W, D } = extent(dem, exag);
    const tx = Math.min(Math.max(ctx.controls.target.x, 0), W);
    const tz = Math.min(Math.max(ctx.controls.target.z, 0), D);
    const ny = sceneY(dem, exag, tx, tz);
    const dy = ny - ctx.controls.target.y;
    ctx.controls.target.y += dy;
    ctx.camera.position.y += dy;
  }
}
