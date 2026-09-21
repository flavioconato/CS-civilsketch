import type { Dem, Rivestimento, Sezione, SezionePunto, SezioneTipo, Traccia, Vasca, Vertex } from './types';
import { nearestOnPolygon, pointInPolygon, polygonArea, projectOntoTrack, trackLength } from './polyline';
import { livellettaElevation } from './livelletta';
import { RIVESTIMENTO_DEFAULT_SPESSORE, SEZIONE_MAX_REACH } from './config';
import { heightAt } from '../dem/dem';

export function defaultRivestimento(): Rivestimento {
  return { attivo: false, spessore: RIVESTIMENTO_DEFAULT_SPESSORE };
}

/**
 * Scostamento verticale del profilo trasversale rispetto alla livelletta, alla distanza con
 * segno `d` dall'asse (§7 SPEC). Interpola linearmente tra i punti disegnati e, oltre l'ultimo
 * punto di ciascun lato, prosegue con la pendenza dell'ultimo segmento: questo permette alle
 * scarpate di raggiungere da sole il terreno naturale (min/max smette di modificarlo da sole
 * quando il profilo lo incrocia), senza dover troncare esplicitamente il profilo.
 */
export function sectionOffset(sezione: Sezione, d: number): number {
  const pts = sezione.punti;
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0].dz;
  const slopeBetween = (a: SezionePunto, b: SezionePunto): number => {
    const span = b.d - a.d;
    return span > 1e-9 ? (b.dz - a.dz) / span : 0;
  };
  if (d <= pts[0].d) {
    const a = pts[0], b = pts[1];
    return a.dz + slopeBetween(a, b) * (d - a.d);
  }
  const last = pts.length - 1;
  if (d >= pts[last].d) {
    const a = pts[last - 1], b = pts[last];
    return b.dz + slopeBetween(a, b) * (d - b.d);
  }
  for (let i = 1; i < pts.length; i++) {
    if (d <= pts[i].d) {
      const a = pts[i - 1], b = pts[i];
      const span = b.d - a.d;
      const t = span > 1e-9 ? (d - a.d) / span : 0;
      return a.dz + (b.dz - a.dz) * t;
    }
  }
  return pts[last].dz;
}

/**
 * Profilo trapezio simmetrico di default (piattaforma piatta + scarpate), usato come punto di
 * partenza per canale/rilevato: l'utente può poi modificarlo liberamente nell'editor di sezione.
 * Il segno di `dz` segue la convenzione di `sectionOffset`: positivo per un canale (le sponde
 * salgono allontanandosi dall'asse), negativo per un rilevato (le scarpate scendono).
 */
export function trapezioPunti(tipo: SezioneTipo, larghezza: number, scarpataRapporto: number): SezionePunto[] {
  const half = Math.max(larghezza, 0) / 2;
  const run = 3;
  const rise = run / Math.max(scarpataRapporto, 0.05);
  const sign = tipo === 'canale' ? 1 : -1;
  return [
    { d: -half - run, dz: sign * rise },
    { d: -half, dz: 0 },
    { d: half, dz: 0 },
    { d: half + run, dz: sign * rise },
  ];
}

export interface TrackVolume {
  scavo: number;
  riporto: number;
}

/**
 * Scava una vasca a pianta poligonale (§8.2 SPEC): dal contorno (`dist` ≈ 0, quota di progetto ≈
 * quota naturale nel punto più vicino del contorno, quindi quasi nessuna modifica) il terreno
 * scende con la scarpata `vasca.scarpataRapporto` fino alla quota piatta `vasca.quotaFondo`. Fuori
 * dal contorno il terreno non si tocca: a differenza di canale/rilevato non serve un margine di
 * raccordo, il confine È il poligono disegnato.
 */
function excavateVasca(data: Float32Array, dem: Dem, vertices: Vertex[], vasca: Vasca): TrackVolume {
  const cellArea = dem.cell * dem.cell;
  const tanScarpata = 1 / Math.max(vasca.scarpataRapporto, 0.05);
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const v of vertices) {
    xmin = Math.min(xmin, v.x); xmax = Math.max(xmax, v.x);
    zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z);
  }
  const c0 = Math.max(0, Math.floor(xmin / dem.cell));
  const c1 = Math.min(dem.w - 1, Math.ceil(xmax / dem.cell));
  const r0 = Math.max(0, Math.floor(zmin / dem.cell));
  const r1 = Math.min(dem.h - 1, Math.ceil(zmax / dem.cell));
  // Il terreno naturale al bordo va letto sul risultato in corso di elaborazione (`data`), non sul
  // DTM originale, per la stessa ragione del daylighting di canale/rilevato: se una traccia
  // precedente ha già modificato il terreno lì, la vasca deve partire da quella quota, non da quella
  // di prima. `heightAt` si aspetta un `Dem`: `data` condivide w/h/cell con `dem`, basta sostituirlo.
  const runningDem: Dem = { ...dem, data };

  let scavo = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const x = c * dem.cell, z = r * dem.cell;
      if (!pointInPolygon(vertices, { x, z })) continue;
      const { dist, x: rx, z: rz } = nearestOnPolygon(vertices, { x, z });
      const orlo = heightAt(runningDem, rx, rz);
      const zProject = Math.max(vasca.quotaFondo, orlo - tanScarpata * dist);
      const idx = r * dem.w + c;
      const zBefore = data[idx];
      const zAfter = Math.min(zBefore, zProject);
      if (zAfter !== zBefore) {
        scavo += (zBefore - zAfter) * cellArea;
        data[idx] = zAfter;
      }
    }
  }
  return { scavo, riporto: 0 };
}

function developedLength(punti: SezionePunto[]): number {
  let len = 0;
  for (let i = 1; i < punti.length; i++) len += Math.hypot(punti[i].d - punti[i - 1].d, punti[i].dz - punti[i - 1].dz);
  return len;
}

/**
 * Superficie approssimativa da rivestire (canale o vasca), per una stima rapida di quantità — non
 * un computo (§15 SPEC esclude "computi e stime di costo", ma un'area/m³ di larga massima è nello
 * stesso spirito dei volumi di scavo già mostrati). Per il canale è lo sviluppo del profilo
 * disegnato (fondo + scarpate) per la lunghezza della traccia; per la vasca è l'area in pianta del
 * contorno (un'approssimazione per difetto della vera superficie 3D delle scarpate inclinate, ma
 * coerente con la leggerezza voluta per uno schizzo concettuale, §2 SPEC).
 */
export function rivestimentoArea(track: Traccia): number | null {
  if (track.kind === 'terreno' && track.sezione?.tipo === 'canale' && track.sezione.rivestimento.attivo) {
    return developedLength(track.sezione.punti) * trackLength(track.vertices);
  }
  if (track.kind === 'vasca' && track.vasca?.rivestimento.attivo && track.vertices.length >= 3) {
    return polygonArea(track.vertices);
  }
  return null;
}

/**
 * Ricalcola l'heightmap di progetto applicando in sequenza le sezioni delle tracce su una copia
 * del DTM naturale (§7 SPEC: scavo = min(terreno, progetto), riporto = max(terreno, progetto);
 * le scarpate arrivano al terreno naturale da sole perché min/max smette di modificarlo appena
 * il profilo lo incrocia). Ogni traccia modifica il risultato della precedente, quindi i volumi
 * per traccia sono relativi al terreno immediatamente prima della sua modifica, non al DTM originale.
 */
export function computeProjectDem(
  dem: Dem,
  tracks: Traccia[],
): { data: Float32Array; volumes: Record<number, TrackVolume> } {
  const data = new Float32Array(dem.data);
  const volumes: Record<number, TrackVolume> = {};
  const cellArea = dem.cell * dem.cell;

  for (const track of tracks) {
    if (track.kind === 'vasca' && track.vasca && track.vertices.length >= 3) {
      volumes[track.id] = excavateVasca(data, dem, track.vertices, track.vasca);
      continue;
    }
    if (!track.sezione || track.sezione.punti.length < 2 || track.vertices.length < 2) continue;
    const sezione = track.sezione;
    const length = trackLength(track.vertices);
    const maxD = sezione.punti.reduce((m, p) => Math.max(m, Math.abs(p.d)), 0);
    const reach = maxD + SEZIONE_MAX_REACH;

    let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (const v of track.vertices) {
      xmin = Math.min(xmin, v.x); xmax = Math.max(xmax, v.x);
      zmin = Math.min(zmin, v.z); zmax = Math.max(zmax, v.z);
    }
    const c0 = Math.max(0, Math.floor((xmin - reach) / dem.cell));
    const c1 = Math.min(dem.w - 1, Math.ceil((xmax + reach) / dem.cell));
    const r0 = Math.max(0, Math.floor((zmin - reach) / dem.cell));
    const r1 = Math.min(dem.h - 1, Math.ceil((zmax + reach) / dem.cell));

    let scavo = 0, riporto = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * dem.cell, z = r * dem.cell;
        const { s, d } = projectOntoTrack(track.vertices, { x, z });
        if (Math.abs(d) > reach) continue;
        const zProject = livellettaElevation(track.livelletta, s, length) + sectionOffset(sezione, d);
        const idx = r * dem.w + c;
        const zBefore = data[idx];
        const zAfter = sezione.tipo === 'canale' ? Math.min(zBefore, zProject) : Math.max(zBefore, zProject);
        if (zAfter !== zBefore) {
          const dz = Math.abs(zAfter - zBefore);
          if (zAfter < zBefore) scavo += dz * cellArea; else riporto += dz * cellArea;
          data[idx] = zAfter;
        }
      }
    }
    volumes[track.id] = { scavo, riporto };
  }

  return { data, volumes };
}
