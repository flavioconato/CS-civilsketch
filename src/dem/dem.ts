import type { Dem } from '../core/types';
import { VALID_Z_MAX, VALID_Z_MIN } from '../core/config';

/** Quota della cella (colonna c, riga r). */
export function cellHeight(dem: Dem, c: number, r: number): number {
  return dem.data[r * dem.w + c];
}

/** Quota reale nel punto (x,z) in coordinate scena, per interpolazione bilineare sui 4 nodi più vicini. */
export function heightAt(dem: Dem, x: number, z: number): number {
  let fx = x / dem.cell;
  let fz = z / dem.cell;
  fx = Math.min(Math.max(fx, 0), dem.w - 1.0001);
  fz = Math.min(Math.max(fz, 0), dem.h - 1.0001);
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const tx = fx - c;
  const tz = fz - r;
  const a = cellHeight(dem, c, r);
  const b = cellHeight(dem, c + 1, r);
  const e = cellHeight(dem, c, r + 1);
  const f = cellHeight(dem, c + 1, r + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (e * (1 - tx) + f * tx) * tz;
}

/** Pendenza locale (m/m) per differenze finite centrate, un passo di cella in ogni direzione. */
export function slopeAt(dem: Dem, x: number, z: number): number {
  const c = dem.cell;
  const dx = (heightAt(dem, x + c, z) - heightAt(dem, x - c, z)) / (2 * c);
  const dz = (heightAt(dem, x, z + c) - heightAt(dem, x, z - c)) / (2 * c);
  return Math.hypot(dx, dz);
}

function isBadValue(v: number, nodata: number | null): boolean {
  return !Number.isFinite(v) || (nodata !== null && Math.abs(v - nodata) < 1e-6) || v < VALID_Z_MIN || v > VALID_Z_MAX;
}

/**
 * Costruisce il Dem finale a partire dai dati grezzi letti dal raster: individua NoData/valori
 * fuori range e li riempie per media dei vicini validi, a passate successive. Il DTM originale
 * non viene mai modificato altrove: questa è l'unica trasformazione, fatta una volta all'apertura.
 */
export function finishDem(
  data: Float32Array,
  w: number,
  h: number,
  cell: number,
  e0: number,
  n0: number,
  nodata: number | null,
  name: string,
  epsg: number | null,
): Dem {
  let zmin = Infinity;
  let zmax = -Infinity;
  let bad = 0;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (isBadValue(v, nodata)) {
      mask[i] = 1;
      bad++;
    } else {
      if (v < zmin) zmin = v;
      if (v > zmax) zmax = v;
    }
  }
  if (bad === data.length) throw new Error('Il DTM non contiene quote valide nell\'area scelta.');
  if (bad) {
    let left = bad;
    let guard = 0;
    while (left > 0 && guard < 4000) {
      guard++;
      let fixed = 0;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const i = r * w + c;
          if (mask[i] !== 1) continue;
          let s = 0;
          let n = 0;
          if (c > 0 && mask[i - 1] !== 1) { s += data[i - 1]; n++; }
          if (c < w - 1 && mask[i + 1] !== 1) { s += data[i + 1]; n++; }
          if (r > 0 && mask[i - w] !== 1) { s += data[i - w]; n++; }
          if (r < h - 1 && mask[i + w] !== 1) { s += data[i + w]; n++; }
          if (n) {
            data[i] = s / n;
            mask[i] = 2;
            fixed++;
          }
        }
      }
      for (let i = 0; i < mask.length; i++) if (mask[i] === 2) mask[i] = 0;
      left -= fixed;
      if (!fixed) break;
    }
  }
  return { w, h, cell, data, e0, n0, zmin, zmax, epsg, name, filled: bad };
}
