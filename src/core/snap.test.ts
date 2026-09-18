import { describe, expect, it } from 'vitest';
import { snapPoint, snapValue } from './snap';

describe('snapValue', () => {
  it('arrotonda al passo più vicino', () => {
    expect(snapValue(1.12, 0.5)).toBeCloseTo(1);
    expect(snapValue(1.3, 0.5)).toBeCloseTo(1.5);
    expect(snapValue(7, 2)).toBeCloseTo(8);
  });
});

describe('snapPoint', () => {
  it('applica lo snap su entrambi gli assi', () => {
    expect(snapPoint({ x: 1.12, z: 3.7 }, 0.5, false)).toEqual({ x: 1, z: 3.5 });
  });

  it('bypassa lo snap quando richiesto (Alt)', () => {
    expect(snapPoint({ x: 1.12, z: 3.7 }, 0.5, true)).toEqual({ x: 1.12, z: 3.7 });
  });
});
