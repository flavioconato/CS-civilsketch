import type { Accumulo, Dem, Muro, Vertex } from './types';
import { heightAt } from '../dem/dem';
import { pointAtProgressive, sampledProgressives, trackLength } from './polyline';
import { muroCrestElevation } from './muro';
import { ACCUMULO_MAX_REACH } from './config';

export interface AccumuloRay {
  /** Punto sull'asse della traccia a questa progressiva. */
  px: number;
  pz: number;
  /** Versore perpendicolare alla traccia, verso monte. */
  nx: number;
  nz: number;
}

/** Punto e direzione verso monte (perpendicolare alla traccia) alla progressiva `s`. */
export function accumuloRayAt(vertices: Vertex[], length: number, s: number, lato: 1 | -1): AccumuloRay {
  const p = pointAtProgressive(vertices, s);
  const a = pointAtProgressive(vertices, Math.max(0, s - 0.5));
  const b = pointAtProgressive(vertices, Math.min(length, s + 0.5));
  let tx = b.x - a.x, tz = b.z - a.z;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl; tz /= tl;
  return { px: p.x, pz: p.z, nx: -tz * lato, nz: tx * lato };
}

/**
 * Lato "monte" della traccia (segno della distanza dall'asse): quello con la quota media del
 * terreno naturale più alta, campionata a qualche metro dall'asse a metà traccia — gli sbarramenti
 * trattengono il materiale dal lato che sale.
 */
export function detectMonteSide(dem: Dem, vertices: Vertex[]): 1 | -1 {
  const length = trackLength(vertices);
  const { px, pz, nx, nz } = accumuloRayAt(vertices, length, length / 2, 1);
  const probe = 5;
  const hPos = heightAt(dem, px + nx * probe, pz + nz * probe);
  const hNeg = heightAt(dem, px - nx * probe, pz - nz * probe);
  return hPos >= hNeg ? 1 : -1;
}

export interface AccumuloResult {
  crest: number;
  volume: number;
  area: number;
}

/** Pendenza della superficie di accumulo in tangente (0 = acqua, pelo libero piatto). */
export function accumuloTanPendenza(muro: Muro): number {
  return Math.tan((muro.accumulo.pendenzaGradi * Math.PI) / 180);
}

/**
 * Portata massima verso monte della superficie di accumulo: solo un tetto di sicurezza. Non esiste
 * un limite "naturale" calcolabile a priori dall'altezza dello sbarramento, perché — a differenza
 * dell'acqua, sempre piatta — il detrito risale insieme al terreno (si veda `computeAccumulo`) e la
 * distanza a cui la chiusura avviene davvero dipende da come si comporta il terreno reale, non da un
 * valore fisso: la marcia verso monte in `computeAccumulo`/`buildAccumuloMesh` trova comunque la
 * chiusura vera molto prima di questo tetto, che serve solo a non scandire un'area sconfinata quando
 * la pendenza impostata è pari o superiore a quella del versante (l'accumulo allora non si chiude mai
 * da solo, come una sabbionaia che seguisse esattamente la pendenza del pendio all'infinito).
 */
export function accumuloMaxReach(): number {
  return ACCUMULO_MAX_REACH;
}

/**
 * Volume trattenuto a monte di uno sbarramento (§8.2/8.3/8.4 SPEC). La superficie parte dalla quota
 * di sommità (d=0, contro lo sbarramento) e **risale** verso monte con la pendenza impostata — non
 * scende: l'acqua è per forza piatta (0°), ma il detrito, potendo mantenere una pendenza propria,
 * riesce a "inseguire" la risalita naturale del terreno molto più a lungo di un pelo libero piatto,
 * trattenendone quindi di più (esattamente il motivo per cui una briglia paradetriti su un versante
 * ripido è efficace: il detrito si dispone con una pendenza minore di quella del versante originario,
 * ma pur sempre positiva, non nulla). Più la pendenza impostata si avvicina a quella reale del
 * versante, più il raggio si allunga prima di richiudersi; se la eguaglia o supera, l'accumulo non si
 * richiude più da solo e si ferma solo al tetto di sicurezza `accumuloMaxReach`.
 *
 * Si integra un raggio alla volta, marciando verso monte a partire dallo sbarramento: alla prima
 * progressiva in cui il terreno naturale raggiunge la superficie, il raggio **si ferma lì per
 * sempre** — anche se più avanti il terreno tornasse a scendere, quel punto non è raggiungibile
 * dall'accumulo perché nel mezzo c'è un dosso più alto che lo separa fisicamente.
 */
export function computeAccumulo(dem: Dem, vertices: Vertex[], muro: Muro): AccumuloResult | null {
  if (!muro.accumulo.attivo || vertices.length < 2) return null;
  const crest = muroCrestElevation(dem, vertices, muro);
  const tanP = accumuloTanPendenza(muro);
  const maxReach = accumuloMaxReach();

  const length = trackLength(vertices);
  const sStep = dem.cell;
  const dStep = dem.cell;
  const cellArea = sStep * dStep;
  const lato = muro.accumulo.lato;

  let volume = 0, area = 0;
  for (const s of sampledProgressives(length, sStep)) {
    const { px, pz, nx, nz } = accumuloRayAt(vertices, length, s, lato);
    for (let d = 0; d < maxReach; d += dStep) {
      const dd = d + dStep / 2;
      const surface = crest + tanP * dd;
      const terrainZ = heightAt(dem, px + nx * dd, pz + nz * dd);
      if (surface <= terrainZ) break; // chiusura: il raggio si ferma qui, non riprende più oltre
      volume += (surface - terrainZ) * cellArea;
      area += cellArea;
    }
  }
  return { crest, volume, area };
}

export function defaultAccumulo(): Accumulo {
  return { attivo: false, pendenzaGradi: 0, lato: 1 };
}
