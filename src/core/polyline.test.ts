import { describe, expect, it } from 'vitest';
import { distanceToPolyline, formatChainage, pointAtProgressive, progressives, trackLength } from './polyline';

describe('progressives', () => {
  it('calcola le progressive cumulate lungo una spezzata', () => {
    const vertices = [{ x: 0, z: 0 }, { x: 3, z: 4 }, { x: 3, z: 10 }];
    expect(progressives(vertices)).toEqual([0, 5, 11]);
  });

  it('ritorna un array vuoto senza vertici', () => {
    expect(progressives([])).toEqual([]);
  });
});

describe('trackLength', () => {
  it('è la progressiva dell\'ultimo vertice', () => {
    const vertices = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
    expect(trackLength(vertices)).toBeCloseTo(20);
  });
});

describe('pointAtProgressive', () => {
  const vertices = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];

  it('interpola sul primo segmento', () => {
    expect(pointAtProgressive(vertices, 5)).toEqual({ x: 5, z: 0 });
  });

  it('interpola sul secondo segmento', () => {
    expect(pointAtProgressive(vertices, 15)).toEqual({ x: 10, z: 5 });
  });

  it('effettua clamp agli estremi', () => {
    expect(pointAtProgressive(vertices, -5)).toEqual({ x: 0, z: 0 });
    expect(pointAtProgressive(vertices, 999)).toEqual({ x: 10, z: 10 });
  });
});

describe('distanceToPolyline', () => {
  const vertices = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];

  it('è zero su un vertice o su un segmento', () => {
    expect(distanceToPolyline(vertices, { x: 5, z: 0 })).toBeCloseTo(0);
    expect(distanceToPolyline(vertices, { x: 10, z: 0 })).toBeCloseTo(0);
  });

  it('misura la distanza perpendicolare dal segmento più vicino', () => {
    expect(distanceToPolyline(vertices, { x: 5, z: 3 })).toBeCloseTo(3);
    expect(distanceToPolyline(vertices, { x: 13, z: 5 })).toBeCloseTo(3);
  });
});

describe('formatChainage', () => {
  it('formatta in notazione km+m con due decimali', () => {
    expect(formatChainage(1234.5)).toBe('1+234.50');
    expect(formatChainage(45.3)).toBe('0+045.30');
    expect(formatChainage(0)).toBe('0+000.00');
  });
});
