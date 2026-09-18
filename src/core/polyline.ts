import type { Vertex } from './types';

export function segmentLength(a: Vertex, b: Vertex): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Progressive cumulate a ciascun vertice, a partire da 0 sul primo. */
export function progressives(vertices: Vertex[]): number[] {
  const out: number[] = [];
  if (vertices.length === 0) return out;
  out.push(0);
  for (let i = 1; i < vertices.length; i++) {
    out.push(out[i - 1] + segmentLength(vertices[i - 1], vertices[i]));
  }
  return out;
}

export function trackLength(vertices: Vertex[]): number {
  const prog = progressives(vertices);
  return prog.length ? prog[prog.length - 1] : 0;
}

/** Progressive campionate a passo ~`step` lungo una traccia di lunghezza `length` (estremi inclusi). */
export function sampledProgressives(length: number, step: number): number[] {
  const n = Math.max(2, Math.ceil(length / step) + 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((length * i) / (n - 1));
  return out;
}

/** Punto planimetrico alla progressiva s lungo la polilinea (clamp agli estremi). */
export function pointAtProgressive(vertices: Vertex[], s: number): Vertex {
  if (vertices.length === 0) return { x: 0, z: 0 };
  if (vertices.length === 1) return { ...vertices[0] };
  const prog = progressives(vertices);
  const total = prog[prog.length - 1];
  const clamped = Math.min(Math.max(s, 0), total);
  for (let i = 1; i < vertices.length; i++) {
    if (clamped <= prog[i] || i === vertices.length - 1) {
      const segLen = prog[i] - prog[i - 1];
      const t = segLen > 1e-9 ? (clamped - prog[i - 1]) / segLen : 0;
      const a = vertices[i - 1], b = vertices[i];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
  }
  return { ...vertices[vertices.length - 1] };
}

export function distanceToSegment(p: Vertex, a: Vertex, b: Vertex): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.min(Math.max(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0), 1);
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/** Distanza minima del punto p dalla spezzata (0 se coincide con un vertice o un segmento). */
export function distanceToPolyline(vertices: Vertex[], p: Vertex): number {
  if (vertices.length === 0) return Infinity;
  if (vertices.length === 1) return Math.hypot(p.x - vertices[0].x, p.z - vertices[0].z);
  let min = Infinity;
  for (let i = 1; i < vertices.length; i++) min = Math.min(min, distanceToSegment(p, vertices[i - 1], vertices[i]));
  return min;
}

export interface TrackProjection {
  /** Progressiva del piede della perpendicolare sulla spezzata. */
  s: number;
  /** Distanza trasversale dall'asse, con segno (positiva a destra del verso di percorrenza). */
  d: number;
}

/**
 * Proietta un punto sulla spezzata: restituisce la progressiva del punto più vicino sulla
 * traccia e la distanza trasversale con segno. Usata per applicare le sezioni trasversali (§7).
 */
export function projectOntoTrack(vertices: Vertex[], p: Vertex): TrackProjection {
  if (vertices.length < 2) return { s: 0, d: 0 };
  const prog = progressives(vertices);
  let best: TrackProjection = { s: 0, d: Infinity };
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (len2 < 1e-12) continue;
    const t = Math.min(Math.max(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0), 1);
    const px = a.x + abx * t, pz = a.z + abz * t;
    const dist = Math.hypot(p.x - px, p.z - pz);
    if (dist < Math.abs(best.d)) {
      const cross = abx * (p.z - a.z) - abz * (p.x - a.x);
      best = { s: prog[i - 1] + t * Math.hypot(abx, abz), d: Math.sign(cross) * dist };
    }
  }
  return best;
}

/** Formatta una progressiva in notazione da cantiere italiana, es. 1234.5 -> "1+234.50". */
export function formatChainage(prog: number): string {
  const sign = prog < 0 ? '-' : '';
  const abs = Math.abs(prog);
  const km = Math.floor(abs / 1000);
  const rest = abs - km * 1000;
  return `${sign}${km}+${rest.toFixed(2).padStart(6, '0')}`;
}
