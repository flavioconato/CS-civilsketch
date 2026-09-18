import type { Dem } from '../core/types';
import { finishDem } from './dem';

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number): number {
  let s = 0, a = 1, f = 1, n = 0;
  for (let i = 0; i < 5; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

export interface SyntheticDemOptions {
  /** Griglia più piccola per dispositivi con poca memoria/schermo piccolo. */
  light?: boolean;
  /** Chiamato periodicamente durante la generazione (0-100), per aggiornare un messaggio di stato. */
  onProgress?: (percent: number) => void | Promise<void>;
}

/**
 * Terreno sintetico: versante che scende verso sud con incisione torrentizia sinuosa
 * e una spianata ferroviaria al piede a quota quasi costante — utile per provare l'app
 * senza un GeoTIFF reale.
 */
export async function generateSyntheticDem(opts: SyntheticDemOptions = {}): Promise<Dem> {
  const cell = opts.light ? 2 : 1;
  const w = opts.light ? 601 : 1201;
  const h = opts.light ? 501 : 1001;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    if (opts.onProgress && r % 150 === 0) await opts.onProgress(Math.round((r / h) * 100));
    const y = r * cell;
    for (let c = 0; c < w; c++) {
      const x = c * cell;
      let z = 620 - y * 0.22 + 60 * fbm(x / 260, y / 260) + 8 * fbm(x / 40, y / 40);
      const axis = 600 + 90 * Math.sin(y / 170) + 30 * Math.sin(y / 53);
      const dx = Math.abs(x - axis);
      z -= 38 * Math.exp(-(dx * dx) / (2 * 70 * 70)) + 9 * Math.exp(-(dx * dx) / (2 * 9 * 9));
      const rail = 800;
      const zr = 440 - (x / w) * 4;
      const band = Math.abs(y - rail);
      if (band < 60) {
        const t = band < 7 ? 1 : Math.max(0, 1 - (band - 7) / 53);
        const sm = t * t * (3 - 2 * t);
        const cut = Math.min(z, zr + Math.max(0, band - 7) * 0.9);
        z = z * (1 - sm) + cut * sm;
      }
      data[r * w + c] = z;
    }
  }
  return finishDem(data, w, h, cell, 0, (h - 1) * cell, null, 'Terreno di esempio (sintetico)', null);
}
