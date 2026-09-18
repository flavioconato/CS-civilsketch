import { describe, expect, it } from 'vitest';
import type { Dem, Muro } from './types';
import { computeAccumulo, detectMonteSide } from './accumulo';

/** DTM 21×21 celle di passo 1 m, quota = indice di riga: sale linearmente lungo z da 0 a 20. */
function slopedDem(): Dem {
  const w = 21, h = 21;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = r;
  return { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 0, zmax: 20, epsg: null, name: 'test' };
}

/** Come slopedDem, ma più estesa lungo z: serve ai raggi che risalgono a lungo prima di chiudersi. */
function tallSlopedDem(): Dem {
  const w = 21, h = 41;
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = r;
  return { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 0, zmax: 40, epsg: null, name: 'test-tall' };
}

const vertices = [{ x: 0, z: 10 }, { x: 20, z: 10 }];

describe('detectMonteSide', () => {
  it('è il lato con la quota naturale più alta', () => {
    expect(detectMonteSide(slopedDem(), vertices)).toBe(1);
  });
});

describe('computeAccumulo', () => {
  it('è null se l\'accumulo non è attivo', () => {
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: false, pendenzaGradi: 0, lato: 1 } };
    expect(computeAccumulo(slopedDem(), vertices, muro)).toBeNull();
  });

  it('acqua (pendenza 0°): pelo libero piatto alla quota di sommità, fino a incontrare il terreno', () => {
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const res = computeAccumulo(slopedDem(), vertices, muro)!;
    expect(res.crest).toBeCloseTo(15); // quota minima del terreno lungo la traccia (10) + altezza (5)
    expect(res.volume).toBeCloseTo(262.5); // fasce a dd=0.5..4.5 (profondità 4.5..0.5), per 21 colonne
    expect(res.area).toBeCloseTo(105);
  });

  it('detrito (pendenza > 0°): la superficie risale verso monte, trattenendo più dell\'acqua', () => {
    // Il terreno di prova sale a 45° (una cella di quota in più ogni metro verso monte). Con una
    // pendenza di accumulo che sale a metà di quella del versante (tan=0.5 anziché tan=1), il
    // raggio si chiude molto più tardi rispetto all'acqua (che resta piatta): più materiale
    // trattenuto, non meno — il contrario del comportamento sbagliato di una superficie che scende.
    const pendenzaGradi = (Math.atan(0.5) * 180) / Math.PI;
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi, lato: 1 } };
    const res = computeAccumulo(tallSlopedDem(), vertices, muro)!;
    expect(res.volume).toBeCloseTo(525); // fasce a dd=0.5..9.5 (profondità 4.75..0.25), per 21 colonne
    expect(res.area).toBeCloseTo(210);

    const acqua: Muro = { ...muro, accumulo: { ...muro.accumulo, pendenzaGradi: 0 } };
    const resAcqua = computeAccumulo(tallSlopedDem(), vertices, acqua)!;
    expect(res.volume).toBeGreaterThan(resAcqua.volume);
  });

  it('una volta chiusa l\'intersezione con un dosso, non riprende più oltre anche se il terreno ridiscende', () => {
    // Terreno come slopedDem, ma con un dosso più alto della sommità appena oltre l'acqua, e subito
    // dopo il dosso il terreno torna basso: senza la regola di chiusura definitiva, quel terreno
    // basso oltre il dosso verrebbe ricontato come se l'accumulo si "proiettasse" fin là.
    const w = 21, h = 21;
    const rowElev = Array.from({ length: h }, (_, r) => r);
    rowElev[13] = 30;
    rowElev[14] = 2; rowElev[15] = 2; rowElev[16] = 2;
    const data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = rowElev[r];
    const dem: Dem = { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 0, zmax: 30, epsg: null, name: 'dosso' };

    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const res = computeAccumulo(dem, vertices, muro)!;
    expect(res.volume).toBeCloseTo(168); // solo le fasce prima del dosso (dd=0.5 e 1.5, profondità 4.5 e 3.5), per 21 colonne
    expect(res.area).toBeCloseTo(42);
  });
});
