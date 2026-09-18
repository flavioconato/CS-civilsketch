import { describe, expect, it } from 'vitest';
import { finishDem, heightAt, slopeAt } from './dem';

function flatDem(w: number, h: number, cell: number, z: number) {
  return finishDem(new Float32Array(w * h).fill(z), w, h, cell, 0, 0, null, 'test', null);
}

describe('heightAt', () => {
  it('ritorna la quota del nodo quando il punto coincide con una cella', () => {
    const data = new Float32Array([0, 10, 20, 30]);
    const dem = finishDem(data, 2, 2, 1, 0, 0, null, 'test', null);
    expect(heightAt(dem, 0, 0)).toBeCloseTo(0);
    expect(heightAt(dem, 1, 0)).toBeCloseTo(10);
    expect(heightAt(dem, 0, 1)).toBeCloseTo(20);
    expect(heightAt(dem, 1, 1)).toBeCloseTo(30);
  });

  it('interpola bilinearmente tra i 4 nodi più vicini', () => {
    const data = new Float32Array([0, 10, 20, 30]);
    const dem = finishDem(data, 2, 2, 1, 0, 0, null, 'test', null);
    expect(heightAt(dem, 0.5, 0)).toBeCloseTo(5);
    expect(heightAt(dem, 0.5, 0.5)).toBeCloseTo(15);
  });

  it('effettua clamp ai bordi del terreno', () => {
    const dem = flatDem(3, 3, 1, 42);
    expect(heightAt(dem, -5, -5)).toBeCloseTo(42);
    expect(heightAt(dem, 999, 999)).toBeCloseTo(42);
  });
});

describe('slopeAt', () => {
  it('è nulla su un terreno piatto', () => {
    const dem = flatDem(5, 5, 1, 100);
    expect(slopeAt(dem, 2, 2)).toBeCloseTo(0);
  });

  it('corrisponde alla pendenza costante di un piano inclinato', () => {
    const w = 5, h = 5, cell = 1;
    const data = new Float32Array(w * h);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) data[r * w + c] = c * cell * 0.1;
    const dem = finishDem(data, w, h, cell, 0, 0, null, 'test', null);
    expect(slopeAt(dem, 2, 2)).toBeCloseTo(0.1, 5);
  });
});

describe('finishDem', () => {
  it('riempie le celle NoData con la media dei vicini validi', () => {
    const nodata = -9999;
    const data = new Float32Array([10, 20, 30, nodata]);
    const dem = finishDem(data, 2, 2, 1, 0, 0, nodata, 'test', null);
    expect(dem.filled).toBe(1);
    expect(dem.data[3]).toBeCloseTo((20 + 30) / 2);
    expect(dem.zmin).toBeCloseTo(10);
    expect(dem.zmax).toBeCloseTo(30);
  });

  it('lancia un errore se nessuna quota è valida', () => {
    const nodata = -9999;
    const data = new Float32Array(4).fill(nodata);
    expect(() => finishDem(data, 2, 2, 1, 0, 0, nodata, 'test', null)).toThrow();
  });
});
