import { describe, expect, it } from 'vitest';
import type { Dem, Traccia } from './types';
import { computeProjectDem, defaultRivestimento, sectionOffset, trapezioPunti } from './terrainOps';

describe('sectionOffset', () => {
  const canale = { tipo: 'canale' as const, punti: trapezioPunti('canale', 2, 1), rivestimento: defaultRivestimento() };
  const rilevato = { tipo: 'rilevato' as const, punti: trapezioPunti('rilevato', 2, 1), rivestimento: defaultRivestimento() };

  it('è nullo entro la semi-larghezza', () => {
    expect(sectionOffset(canale, 0)).toBe(0);
    expect(sectionOffset(canale, 1)).toBe(0);
    expect(sectionOffset(canale, -1)).toBe(0);
  });

  it('sale allontanandosi dall\'asse per un canale (scarpata 1:1)', () => {
    expect(sectionOffset(canale, 2)).toBeCloseTo(1);
    expect(sectionOffset(canale, -2)).toBeCloseTo(1);
  });

  it('scende allontanandosi dall\'asse per un rilevato (scarpata 1:1)', () => {
    expect(sectionOffset(rilevato, 2)).toBeCloseTo(-1);
    expect(sectionOffset(rilevato, -2)).toBeCloseTo(-1);
  });

  it('prosegue oltre l\'ultimo punto disegnato con la stessa pendenza', () => {
    const asimmetrico = { tipo: 'canale' as const, punti: [{ d: -1, dz: 0 }, { d: 1, dz: 1 }], rivestimento: defaultRivestimento() };
    expect(sectionOffset(asimmetrico, 3)).toBeCloseTo(2);
    expect(sectionOffset(asimmetrico, -3)).toBeCloseTo(-1);
  });
});

function flatDem(w: number, h: number, cell: number): Dem {
  return { w, h, cell, data: new Float32Array(w * h), e0: 0, n0: 0, zmin: 0, zmax: 0, epsg: null, name: 'test' };
}

describe('computeProjectDem', () => {
  it('scava un canale a fondo piatto con scarpate che raggiungono il terreno naturale', () => {
    const dem = flatDem(21, 5, 1);
    const track: Traccia = {
      id: 1,
      name: 'Canale',
      kind: 'terreno',
      vertices: [{ x: 0, z: 2 }, { x: 20, z: 2 }],
      livelletta: { mode: 'pendenza', quotaIniziale: -2, pendenza: 0, quotaFinale: -2, vertici: [] },
      sezione: { tipo: 'canale', punti: trapezioPunti('canale', 2, 1), rivestimento: defaultRivestimento() },
      vasca: null,
      muro: null,
      categoria: null,
    };
    const { data, volumes } = computeProjectDem(dem, [track]);
    const at = (c: number, r: number) => data[r * dem.w + c];

    expect(at(10, 2)).toBeCloseTo(-2); // fondo canale, sull'asse
    expect(at(10, 1)).toBeCloseTo(-2); // fondo canale, al bordo della piattaforma (d=1)
    expect(at(10, 0)).toBeCloseTo(-1); // scarpata: d=2, sale di 1 m (scarpata 1:1)
    expect(at(10, 4)).toBeCloseTo(-1); // simmetrico sull'altro lato

    expect(volumes[1].scavo).toBeGreaterThan(0);
    expect(volumes[1].riporto).toBe(0);
  });

  it('rialza un rilevato a piattaforma piatta con scarpate in discesa', () => {
    const dem = flatDem(21, 5, 1);
    const track: Traccia = {
      id: 2,
      name: 'Rilevato',
      kind: 'terreno',
      vertices: [{ x: 0, z: 2 }, { x: 20, z: 2 }],
      livelletta: { mode: 'pendenza', quotaIniziale: 2, pendenza: 0, quotaFinale: 2, vertici: [] },
      sezione: { tipo: 'rilevato', punti: trapezioPunti('rilevato', 2, 1), rivestimento: defaultRivestimento() },
      vasca: null,
      muro: null,
      categoria: null,
    };
    const { data, volumes } = computeProjectDem(dem, [track]);
    const at = (c: number, r: number) => data[r * dem.w + c];

    expect(at(10, 2)).toBeCloseTo(2); // piattaforma, sull'asse
    expect(at(10, 0)).toBeCloseTo(1); // scarpata: d=2, scende di 1 m

    expect(volumes[2].riporto).toBeGreaterThan(0);
    expect(volumes[2].scavo).toBe(0);
  });

  it('non modifica il terreno per tracce senza sezione', () => {
    const dem = flatDem(5, 5, 1);
    const track: Traccia = {
      id: 3,
      name: 'Ferrovia',
      kind: 'livelletta',
      vertices: [{ x: 0, z: 2 }, { x: 4, z: 2 }],
      livelletta: { mode: 'pendenza', quotaIniziale: 0, pendenza: 0, quotaFinale: 0, vertici: [] },
      sezione: null,
      vasca: null,
      muro: null,
      categoria: null,
    };
    const { data, volumes } = computeProjectDem(dem, [track]);
    expect(data).toEqual(dem.data);
    expect(volumes[3]).toBeUndefined();
  });

  it('scava una vasca a pianta poligonale, a fondo piatto con scarpate che raggiungono il contorno', () => {
    const dem = flatDem(21, 21, 1); // terreno piatto a quota 0
    const track: Traccia = {
      id: 4,
      name: 'Vasca',
      kind: 'vasca',
      vertices: [{ x: 5, z: 5 }, { x: 15, z: 5 }, { x: 15, z: 15 }, { x: 5, z: 15 }],
      livelletta: { mode: 'pendenza', quotaIniziale: 0, pendenza: 0, quotaFinale: 0, vertici: [] },
      sezione: null,
      vasca: { quotaFondo: -3, scarpataRapporto: 1, rivestimento: defaultRivestimento() },
      muro: null,
      categoria: null,
    };
    const { data, volumes } = computeProjectDem(dem, [track]);
    const at = (c: number, r: number) => data[r * dem.w + c];

    expect(at(10, 10)).toBeCloseTo(-3); // centro: a 5 m da ogni lato, ben oltre la scarpata (1:1), fondo piatto
    expect(at(10, 9)).toBeCloseTo(-3); // a 4 m dal lato più vicino: ancora sul fondo piatto
    expect(at(10, 6)).toBeCloseTo(-1); // a 1 m dal lato più vicino: scarpata 1:1, scende di 1 m
    expect(at(10, 5)).toBeCloseTo(0); // esattamente sul contorno: nessuna modifica
    expect(at(2, 2)).toBeCloseTo(0); // fuori dal contorno: terreno intatto

    expect(volumes[4].scavo).toBeGreaterThan(0);
    expect(volumes[4].riporto).toBe(0);
  });
});
