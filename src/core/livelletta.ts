import type { Dem, Livelletta, LivellettaVertex, Vertex } from './types';
import { heightAt } from '../dem/dem';
import { progressives } from './polyline';

/**
 * Quota di progetto z(s) alla progressiva s, secondo la modalità della livelletta (§6.2 SPEC).
 * Fuori dall'intervallo [0, length] il valore resta bloccato a quello dell'estremo più vicino.
 */
export function livellettaElevation(liv: Livelletta, s: number, length: number): number {
  const clamped = Math.min(Math.max(s, 0), Math.max(length, 0));
  switch (liv.mode) {
    case 'pendenza':
      return liv.quotaIniziale + (liv.pendenza / 100) * clamped;
    case 'quote': {
      if (length <= 1e-9) return liv.quotaIniziale;
      const t = clamped / length;
      return liv.quotaIniziale + (liv.quotaFinale - liv.quotaIniziale) * t;
    }
    case 'vertici':
    case 'terreno': {
      const pts = [...liv.vertici].sort((a, b) => a.prog - b.prog);
      if (pts.length === 0) return liv.quotaIniziale;
      if (clamped <= pts[0].prog) return pts[0].quota;
      if (clamped >= pts[pts.length - 1].prog) return pts[pts.length - 1].quota;
      for (let i = 1; i < pts.length; i++) {
        if (clamped <= pts[i].prog) {
          const a = pts[i - 1], b = pts[i];
          const span = b.prog - a.prog;
          const t = span > 1e-9 ? (clamped - a.prog) / span : 0;
          return a.quota + (b.quota - a.quota) * t;
        }
      }
      return pts[pts.length - 1].quota;
    }
    default:
      return liv.quotaIniziale;
  }
}

/** Livelletta di default per una nuova traccia: quota iniziale dal terreno, pendenza nulla. */
export function defaultLivelletta(quotaIniziale: number): Livelletta {
  return { mode: 'pendenza', quotaIniziale, pendenza: 0, quotaFinale: quotaIniziale, vertici: [] };
}

/** Vertici di livelletta presi dalla quota del terreno naturale a ogni vertice della traccia (modalità `terreno`). */
export function livellettaVerticesFromTerrain(dem: Dem, vertices: Vertex[]): LivellettaVertex[] {
  const prog = progressives(vertices);
  return vertices.map((v, i) => ({ prog: prog[i], quota: heightAt(dem, v.x, v.z) }));
}
