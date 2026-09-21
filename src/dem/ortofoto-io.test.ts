import { describe, expect, it } from 'vitest';
import { ortofotoLocalBounds } from './ortofoto-io';

describe('ortofotoLocalBounds', () => {
  it('converte origine reale in coordinate scena locali (Est cresce, Nord decresce)', () => {
    const dem = { e0: 500000, n0: 5000000 };
    const photo = { e0: 500010, n0: 5000000, resX: 0.5, width: 200, height: 100 };
    const b = ortofotoLocalBounds(dem, photo);
    expect(b.x0).toBeCloseTo(10); // 10 m a est dell'origine del DTM
    expect(b.z0).toBeCloseTo(0); // stessa quota Nord dell'origine del DTM
    expect(b.w).toBeCloseTo(100); // 200 px * 0.5 m
    expect(b.h).toBeCloseTo(50); // 100 px * 0.5 m
  });

  it('un\'ortofoto più a nord del DTM ha z0 negativo (fuori dal terreno verso z<0)', () => {
    const dem = { e0: 0, n0: 1000 };
    const photo = { e0: 0, n0: 1050, resX: 1, width: 10, height: 10 };
    const b = ortofotoLocalBounds(dem, photo);
    expect(b.z0).toBeCloseTo(-50);
  });
});
