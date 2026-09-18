import type { Dem, Sezione, SezionePunto, SezioneTipo, Traccia } from './types';
import { projectOntoTrack, trackLength } from './polyline';
import { livellettaElevation } from './livelletta';
import { SEZIONE_MAX_REACH } from './config';

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
