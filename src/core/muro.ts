import type { Dem, Muro, Vertex } from './types';
import { heightAt } from '../dem/dem';
import { sampledProgressives, pointAtProgressive, trackLength } from './polyline';
import { TRACK_SAMPLE_STEP } from './config';

/** Altezza fuori terra minima garantita: dove il terreno supera la quota di sommità, il muro
 * risale localmente di questo tanto invece di annullarsi o invertirsi. */
export const MURO_MIN_HEIGHT = 0.1;

function terrainProfile(dem: Dem, vertices: Vertex[]): number[] {
  const sList = sampledProgressives(trackLength(vertices), TRACK_SAMPLE_STEP);
  return sList.map((s) => {
    const p = pointAtProgressive(vertices, s);
    return heightAt(dem, p.x, p.z);
  });
}

/**
 * Quota di sommità del muro (§8.3 SPEC): costante lungo tutta la traccia, pari alla quota minima
 * del terreno incontrata più l'altezza massima impostata dall'utente. L'altezza fuori terra vale
 * `altezza` solo nel punto più basso della traccia; altrove è minore, perché la sommità non segue
 * il terreno.
 */
export function muroCrestElevation(dem: Dem, vertices: Vertex[], muro: Muro): number {
  const profile = terrainProfile(dem, vertices);
  return Math.min(...profile) + muro.altezza;
}

export interface MuroStats {
  crest: number;
  hMin: number;
  hMax: number;
  volume: number;
}

/** Statistiche del muro lungo la traccia: quota di sommità, altezza fuori terra min/max e volume stimato. */
export function muroStats(dem: Dem, vertices: Vertex[], muro: Muro): MuroStats {
  const sList = sampledProgressives(trackLength(vertices), TRACK_SAMPLE_STEP);
  const profile = terrainProfile(dem, vertices);
  const crest = Math.min(...profile) + muro.altezza;

  let hMin = Infinity;
  let hMax = -Infinity;
  let area = 0;
  for (let i = 0; i < sList.length; i++) {
    const h = Math.max(MURO_MIN_HEIGHT, crest - profile[i]);
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h);
    if (i > 0) {
      const hPrev = Math.max(MURO_MIN_HEIGHT, crest - profile[i - 1]);
      area += ((h + hPrev) / 2) * (sList[i] - sList[i - 1]);
    }
  }
  const volume = muro.spessore * (area + trackLength(vertices) * muro.fondazione);
  return { crest, hMin, hMax, volume };
}
