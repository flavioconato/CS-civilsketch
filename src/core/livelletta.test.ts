import { describe, expect, it } from 'vitest';
import { livellettaElevation } from './livelletta';
import type { Livelletta } from './types';

describe('livellettaElevation', () => {
  it('modalità pendenza: quota iniziale + pendenza costante', () => {
    const liv: Livelletta = { mode: 'pendenza', quotaIniziale: 100, pendenza: 2, quotaFinale: 0, vertici: [] };
    expect(livellettaElevation(liv, 0, 500)).toBeCloseTo(100);
    expect(livellettaElevation(liv, 250, 500)).toBeCloseTo(105);
    expect(livellettaElevation(liv, 500, 500)).toBeCloseTo(110);
  });

  it('modalità quote: interpola linearmente tra quota iniziale e finale', () => {
    const liv: Livelletta = { mode: 'quote', quotaIniziale: 100, pendenza: 0, quotaFinale: 150, vertici: [] };
    expect(livellettaElevation(liv, 0, 200)).toBeCloseTo(100);
    expect(livellettaElevation(liv, 100, 200)).toBeCloseTo(125);
    expect(livellettaElevation(liv, 200, 200)).toBeCloseTo(150);
  });

  it('modalità vertici: interpola tra i vertici della livelletta spezzata', () => {
    const liv: Livelletta = {
      mode: 'vertici', quotaIniziale: 0, pendenza: 0, quotaFinale: 0,
      vertici: [{ prog: 0, quota: 10 }, { prog: 100, quota: 20 }, { prog: 300, quota: 15 }],
    };
    expect(livellettaElevation(liv, 50, 300)).toBeCloseTo(15);
    expect(livellettaElevation(liv, 200, 300)).toBeCloseTo(17.5);
  });

  it('blocca il valore all\'estremo più vicino fuori range', () => {
    const liv: Livelletta = { mode: 'pendenza', quotaIniziale: 100, pendenza: 5, quotaFinale: 0, vertici: [] };
    expect(livellettaElevation(liv, -50, 100)).toBeCloseTo(100);
    expect(livellettaElevation(liv, 500, 100)).toBeCloseTo(105);
  });
});
