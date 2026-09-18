import * as THREE from 'three';
import type { Dem } from '../core/types';
import { cellHeight } from '../dem/dem';
import { CHUNK_SIZE, LOD_DISTANCE_FACTORS, LOD_STEPS } from '../core/config';
import type { ThreeContext } from './scene';

function chunkGeometry(dem: Dem, c0: number, c1: number, r0: number, r1: number, s: number, cx: number, cz: number, zb: number, ex: number): THREE.BufferGeometry {
  const cols: number[] = [];
  for (let c = c0; c < c1; c += s) cols.push(c);
  cols.push(c1);
  const rows: number[] = [];
  for (let r = r0; r < r1; r += s) rows.push(r);
  rows.push(r1);
  const nc = cols.length, nr = rows.length;
  const nSk = 2 * nc + 2 * nr;
  const nv = nc * nr + nSk;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  let k = 0;
  const nrm = (c: number, r: number): [number, number, number] => {
    const cl = Math.max(c - s, 0), cr = Math.min(c + s, dem.w - 1), ru = Math.max(r - s, 0), rd = Math.min(r + s, dem.h - 1);
    const gx = (cellHeight(dem, cr, r) - cellHeight(dem, cl, r)) / ((cr - cl) * dem.cell) * ex;
    const gz = (cellHeight(dem, c, rd) - cellHeight(dem, c, ru)) / ((rd - ru) * dem.cell) * ex;
    const l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  };
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const c = cols[i], r = rows[j];
      pos[k * 3] = c * dem.cell - cx;
      pos[k * 3 + 1] = (cellHeight(dem, c, r) - zb) * ex;
      pos[k * 3 + 2] = r * dem.cell - cz;
      const n = nrm(c, r);
      nor[k * 3] = n[0]; nor[k * 3 + 1] = n[1]; nor[k * 3 + 2] = n[2];
      k++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i, b = a + 1, c = a + nc, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
  }
  // bordini verticali per nascondere le fessure tra livelli di dettaglio
  const drop = s * dem.cell * ex * 1.2 + 0.5;
  const edge = (list: number[]) => {
    const start = k;
    list.forEach((v) => {
      pos[k * 3] = pos[v * 3]; pos[k * 3 + 1] = pos[v * 3 + 1] - drop; pos[k * 3 + 2] = pos[v * 3 + 2];
      nor[k * 3] = nor[v * 3]; nor[k * 3 + 1] = nor[v * 3 + 1]; nor[k * 3 + 2] = nor[v * 3 + 2];
      k++;
    });
    for (let t = 0; t < list.length - 1; t++) idx.push(list[t], start + t, list[t + 1], list[t + 1], start + t, start + t + 1);
  };
  edge([...Array(nc).keys()]);
  edge([...Array(nc).keys()].map((i) => (nr - 1) * nc + i));
  edge([...Array(nr).keys()].map((j) => j * nc));
  edge([...Array(nr).keys()].map((j) => j * nc + nc - 1));

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(new (nv > 65535 ? Uint32Array : Uint16Array)(idx), 1));
  g.computeBoundingSphere();
  return g;
}

/** Ricostruisce il terreno (chunk + LOD) per il Dem e l'esagerazione correnti. */
export function buildTerrain(ctx: ThreeContext, dem: Dem, exag: number): void {
  if (ctx.terrainGroup) {
    ctx.terrainGroup.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    ctx.scene.remove(ctx.terrainGroup);
  }
  const group = new THREE.Group();
  const zb = dem.zmin;
  ctx.uniforms.uZBase.value = zb;
  ctx.uniforms.uExag.value = exag;
  ctx.uniforms.uZmin.value = dem.zmin;
  ctx.uniforms.uZmax.value = dem.zmax;

  const steps = LOD_STEPS;
  for (let r0 = 0; r0 < dem.h - 1; r0 += CHUNK_SIZE) {
    for (let c0 = 0; c0 < dem.w - 1; c0 += CHUNK_SIZE) {
      const c1 = Math.min(c0 + CHUNK_SIZE, dem.w - 1);
      const r1 = Math.min(r0 + CHUNK_SIZE, dem.h - 1);
      const cx = ((c0 + c1) / 2) * dem.cell;
      const cz = ((r0 + r1) / 2) * dem.cell;
      const lod = new THREE.LOD();
      lod.position.set(cx, 0, cz);
      const span = Math.max(c1 - c0, r1 - r0) * dem.cell;
      steps.forEach((s, li) => {
        if (li > 0 && s >= Math.max(c1 - c0, r1 - r0)) return;
        const mesh = new THREE.Mesh(chunkGeometry(dem, c0, c1, r0, r1, s, cx, cz, zb, exag), ctx.terrainMat);
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        const factor = li === 1 ? LOD_DISTANCE_FACTORS[1] : LOD_DISTANCE_FACTORS[2];
        lod.addLevel(mesh, li === 0 ? 0 : span * factor);
      });
      group.add(lod);
    }
  }
  ctx.scene.add(group);
  ctx.terrainGroup = group;
}

export function setWire(ctx: ThreeContext, on: boolean): void {
  ctx.terrainMat.wireframe = on;
}
