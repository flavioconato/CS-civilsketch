import { describe, expect, it } from 'vitest';
import type { Dem, Muro } from './types';
import { accumuloMaxPendenzaGradi, computeAccumulo, computeAccumuloField, detectMonteSide } from './accumulo';

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

/**
 * DTM con una vera valle confinata: fondo piatto (quota = z) per |x-cx| <= half, pareti che salgono
 * di `wallSlope` al metro oltre quel bordo, fino a un tetto opzionale `capAt` (per simulare una sella
 * più bassa del coronamento che lascia sfiorare l'accumulo lateralmente, invece di richiudersi contro
 * pareti sempre più alte). Serve a testare la vera fisica 2D (§8.2/8.3/8.4): un profilo x-invariante
 * come `slopedDem` non confina nulla lateralmente e non è adatto a un accumulo realistico.
 */
function valleyDem(w: number, h: number, cx: number, half: number, wallSlope: number, capAt: number | null): Dem {
  const data = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const beyond = Math.max(0, Math.abs(c - cx) - half);
      let wall = beyond * wallSlope;
      if (capAt !== null) wall = Math.min(wall, capAt);
      data[r * w + c] = r + wall;
    }
  }
  let zmax = -Infinity;
  for (const v of data) zmax = Math.max(zmax, v);
  return { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 0, zmax, epsg: null, name: 'valley' };
}

/** Legge il campo alle coordinate di griglia (x,z) in metri, che qui coincidono con gli indici DTM (cell=1). */
function fieldAt(field: NonNullable<ReturnType<typeof computeAccumuloField>>, x: number, z: number) {
  const li = (z - field.r0) * field.cols + (x - field.c0);
  return { flooded: field.flooded[li] === 1, surface: field.surface[li], terrain: field.terrain[li] };
}

describe('detectMonteSide', () => {
  it('è il lato con la quota naturale più alta', () => {
    expect(detectMonteSide(slopedDem(), vertices)).toBe(1);
  });
});

describe('computeAccumulo — acqua confinata in una valle', () => {
  it('null se l\'accumulo non è attivo', () => {
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: false, pendenzaGradi: 0, lato: 1 } };
    expect(computeAccumulo(slopedDem(), vertices, muro)).toBeNull();
  });

  it('con pareti ovunque più alte del coronamento, il pelo libero resta piatto alla quota di sommità', () => {
    // Valle larga (fondo piatto x in [12,28], pareti a 3 m/m oltre), diga che si ammorsa nelle
    // pareti (x 10→30, quote di spalla 16 m, sopra il coronamento 15 m): nessuna via di fuga
    // laterale entro la portata di ricerca, quindi l'acqua si ferma esattamente al coronamento.
    const dem = valleyDem(61, 25, 20, 8, 3, null);
    const dammVertices = [{ x: 10, z: 10 }, { x: 30, z: 10 }];
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const field = computeAccumuloField(dem, dammVertices, muro)!;
    expect(field).not.toBeNull();

    const center = fieldAt(field, 20, 12); // fondo valle, ben dentro l'accumulo
    expect(center.flooded).toBe(true);
    expect(center.surface).toBeCloseTo(15); // = quota di sommità (nessuno sfioro possibile)

    const beyondCrest = fieldAt(field, 20, 16); // il fondo valle qui è già a quota 16 > coronamento
    expect(beyondCrest.flooded).toBe(false);

    const farWall = fieldAt(field, 0, 12); // sulla parete, ben oltre il bordo della valle
    expect(farWall.flooded).toBe(false);

    const res = computeAccumulo(dem, dammVertices, muro)!;
    expect(res.volume).toBeGreaterThan(0);
    expect(res.area).toBeGreaterThan(0);
  });

  it('con una sella più bassa del coronamento, l\'acqua sfiora lateralmente invece di appoggiarsi al coronamento', () => {
    // Stessa valle, ma le pareti si fermano ("sella") a 3 m sopra il fondo: appena a monte della
    // diga (z=11) la sella è a quota 14, sotto il coronamento (15). L'acqua non può restare a 15
    // contro la diga se può defluire lateralmente a 14: l'intero invaso si assesta a 14.
    const dem = valleyDem(101, 25, 40, 8, 3, 3);
    const dammVertices = [{ x: 32, z: 10 }, { x: 48, z: 10 }];
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const field = computeAccumuloField(dem, dammVertices, muro)!;
    expect(field).not.toBeNull();

    const center = fieldAt(field, 40, 12); // fondo valle, subito a monte della diga
    expect(center.flooded).toBe(true);
    expect(center.surface).toBeCloseTo(14); // quota di sfioro reale, non il coronamento (15)

    const shelf = fieldAt(field, 5, 11); // sulla sella, lontano lateralmente dalla diga
    expect(shelf.flooded).toBe(true);
    expect(shelf.surface).toBeCloseTo(14);

    // Non risale oltre la quota di sfioro: un punto che richiederebbe 15 per essere sommerso resta asciutto.
    const atSpillLevel = fieldAt(field, 40, 14); // fondo valle a quota 14: appena sommerso, al limite
    expect(atSpillLevel.flooded).toBe(true);
    const justAbove = fieldAt(field, 40, 15); // fondo valle a quota 15 > 14 di sfioro: asciutto
    expect(justAbove.flooded).toBe(false);
  });

  it('un dosso trasversale a tutta la valle chiude per sempre, anche se il terreno oltre ridiscende', () => {
    // Come sopra (valle confinata, pareti sempre più alte del coronamento), ma con un dosso a
    // quota 30 su tutta la sezione a z=13, seguito da terreno molto basso (quota 2) a z=14-16:
    // senza terreno basso oltre non sarebbe una prova (si chiuderebbe comunque lì), quindi la prova
    // è che quel terreno basso NON venga riallagato "scavalcando" il dosso.
    const w = 61, h = 25, cx = 20, half = 8, wallSlope = 3;
    const data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) {
      const base = r === 13 ? 30 : (r >= 14 && r <= 16 ? 2 : r);
      for (let c = 0; c < w; c++) {
        const beyond = Math.max(0, Math.abs(c - cx) - half);
        data[r * w + c] = base + beyond * wallSlope;
      }
    }
    let zmax = -Infinity;
    for (const v of data) zmax = Math.max(zmax, v);
    const dem: Dem = { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 0, zmax, epsg: null, name: 'dosso' };
    const dammVertices = [{ x: 10, z: 10 }, { x: 30, z: 10 }];
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const field = computeAccumuloField(dem, dammVertices, muro)!;
    expect(field).not.toBeNull();

    expect(fieldAt(field, 20, 12).flooded).toBe(true); // prima del dosso: allagato
    expect(fieldAt(field, 20, 15).flooded).toBe(false); // oltre il dosso, terreno basso: non raggiungibile
    expect(fieldAt(field, 20, 16).flooded).toBe(false);
  });
});

describe('computeAccumulo — detrito (pendenza > 0°)', () => {
  it('risale verso monte più dell\'acqua, a parità di versante', () => {
    // Terreno x-invariante (nessuna valle: qui basta testare l'andamento lungo la direzione monte,
    // non il confinamento laterale). Pendenza di accumulo pari a metà di quella del versante.
    const pendenzaGradi = (Math.atan(0.5) * 180) / Math.PI;
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi, lato: 1 } };
    const res = computeAccumulo(tallSlopedDem(), vertices, muro)!;
    const acqua: Muro = { ...muro, accumulo: { ...muro.accumulo, pendenzaGradi: 0 } };
    const resAcqua = computeAccumulo(tallSlopedDem(), vertices, acqua)!;
    expect(res.volume).toBeGreaterThan(resAcqua.volume);
    expect(res.area).toBeGreaterThan(resAcqua.area);
  });

  it('più la pendenza è vicina a quella del versante, più il raggio d\'azione si allunga', () => {
    const low: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 10, lato: 1 } };
    const high: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 35, lato: 1 } };
    const resLow = computeAccumulo(tallSlopedDem(), vertices, low)!;
    const resHigh = computeAccumulo(tallSlopedDem(), vertices, high)!;
    expect(resHigh.area).toBeGreaterThan(resLow.area);
  });
});

describe('accumuloMaxPendenzaGradi', () => {
  it('è positiva su un versante che sale, e più bassa per uno sbarramento più alto', () => {
    const basso: Muro = { altezza: 2, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const alto: Muro = { altezza: 10, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    const dem = tallSlopedDem();
    const maxBasso = accumuloMaxPendenzaGradi(dem, vertices, basso);
    const maxAlto = accumuloMaxPendenzaGradi(dem, vertices, alto);
    expect(maxBasso).toBeGreaterThan(0);
    expect(maxAlto).toBeLessThan(maxBasso);
  });

  it('è zero se il terreno a monte non sale affatto', () => {
    const w = 21, h = 21;
    const data = new Float32Array(w * h).fill(5);
    const flatDem: Dem = { w, h, cell: 1, data, e0: 0, n0: 0, zmin: 5, zmax: 5, epsg: null, name: 'flat' };
    const muro: Muro = { altezza: 5, spessore: 1, fondazione: 0, accumulo: { attivo: true, pendenzaGradi: 0, lato: 1 } };
    expect(accumuloMaxPendenzaGradi(flatDem, vertices, muro)).toBe(0);
  });
});
