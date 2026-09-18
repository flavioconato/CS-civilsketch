import { describe, expect, it } from 'vitest';
import type { Dem, Muro } from './types';
import { muroCrestElevation, muroStats, MURO_MIN_HEIGHT } from './muro';
import { defaultAccumulo } from './accumulo';

/** DTM 11×3 celle di passo 1 m, quota = indice di colonna: sale linearmente da 0 a 10 lungo x. */
function slopedDem(): Dem {
  const w = 11, h = 3;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = c;
  return { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 0, zmax: 10, epsg: null, name: 'test' };
}

describe('muroCrestElevation', () => {
  it('è la quota minima del terreno lungo la traccia più l\'altezza massima', () => {
    const dem = slopedDem();
    const muro: Muro = { altezza: 3, spessore: 0.5, fondazione: 0.2, accumulo: defaultAccumulo() };
    // Traccia dal punto più basso (x=0) al più alto (x=10): il minimo è a x=0, quota 0.
    expect(muroCrestElevation(dem, [{ x: 0, z: 1 }, { x: 10, z: 1 }], muro)).toBeCloseTo(3);
  });
});

describe('muroStats', () => {
  it('sviluppa l\'altezza massima solo nel punto più basso, minore altrove, con un minimo garantito', () => {
    const dem = slopedDem();
    const muro: Muro = { altezza: 3, spessore: 0.5, fondazione: 0.2, accumulo: defaultAccumulo() };
    const stats = muroStats(dem, [{ x: 0, z: 1 }, { x: 10, z: 1 }], muro);

    expect(stats.crest).toBeCloseTo(3);
    expect(stats.hMax).toBeCloseTo(3); // nel punto più basso (x=0): altezza fuori terra = altezza impostata
    expect(stats.hMin).toBeCloseTo(MURO_MIN_HEIGHT); // dove il terreno supera la sommità, resta il minimo garantito
    expect(stats.volume).toBeCloseTo(3.85, 2);
  });

  it('con terreno sempre sotto la sommità, l\'altezza fuori terra vale ovunque quella impostata meno il dislivello', () => {
    const dem = slopedDem();
    const muro: Muro = { altezza: 12, spessore: 1, fondazione: 0, accumulo: defaultAccumulo() };
    const stats = muroStats(dem, [{ x: 0, z: 1 }, { x: 10, z: 1 }], muro);

    expect(stats.crest).toBeCloseTo(12);
    expect(stats.hMax).toBeCloseTo(12); // a x=0
    expect(stats.hMin).toBeCloseTo(2); // a x=10: 12 - 10
  });
});
