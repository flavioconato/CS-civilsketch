import type { Accumulo, Dem, Muro, Vertex } from './types';
import { heightAt } from '../dem/dem';
import { pointAtProgressive, projectOntoTrack, trackLength } from './polyline';
import { muroCrestElevation } from './muro';
import { ACCUMULO_FIELD_MAX_CELLS, ACCUMULO_MAX_REACH } from './config';

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
 * Portata massima verso monte entro cui si cerca il raggio d'azione dell'accumulo: solo un tetto di
 * sicurezza contro terreni che non chiudono mai (pianeggianti o in discesa verso monte), non un dato
 * fisico. La chiusura vera avviene sempre molto prima, dove il terreno reale la impone (si veda
 * `computeAccumuloField`).
 */
export function accumuloMaxReach(): number {
  return ACCUMULO_MAX_REACH;
}

/**
 * Campo 2D di accumulo a monte di uno sbarramento: una griglia locale (stessa risoluzione del DTM)
 * centrata sulla traccia, con lo stato di ogni nodo (allagato o no) e la quota della superficie dove
 * allagato. `c0`/`r0` sono gli indici di colonna/riga del DTM da cui parte la griglia locale.
 */
export interface AccumuloField {
  c0: number;
  r0: number;
  cols: number;
  rows: number;
  cell: number;
  /** Quota del terreno per nodo (stessa griglia del DTM). */
  terrain: Float32Array;
  /** 1 se il nodo è allagato (dentro l'accumulo). */
  flooded: Uint8Array;
  /** Quota della superficie di accumulo per nodo, valida solo dove `flooded`. */
  surface: Float32Array;
}

const NEI4 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;
const NEI8 = [
  ...NEI4, [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** Min-heap binario minimale, specializzato per coppie (priorità, indice locale intero). */
class MinHeap {
  private prio: number[] = [];
  private val: number[] = [];

  get size(): number { return this.prio.length; }

  push(p: number, v: number): void {
    this.prio.push(p);
    this.val.push(v);
    let i = this.prio.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): [number, number] | undefined {
    const n = this.prio.length;
    if (n === 0) return undefined;
    const topP = this.prio[0], topV = this.val[0];
    const lastP = this.prio.pop()!, lastV = this.val.pop()!;
    if (this.prio.length) {
      this.prio[0] = lastP;
      this.val[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < this.prio.length && this.prio[l] < this.prio[smallest]) smallest = l;
        if (r < this.prio.length && this.prio[r] < this.prio[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return [topP, topV];
  }

  private swap(i: number, j: number): void {
    const tp = this.prio[i]; this.prio[i] = this.prio[j]; this.prio[j] = tp;
    const tv = this.val[i]; this.val[i] = this.val[j]; this.val[j] = tv;
  }
}

/**
 * Riquadro locale del DTM (indici di colonna/riga) attorno alla traccia, esteso di `reach` in ogni
 * direzione e ridotto quanto basta perché il numero di nodi resti governabile: una portata di
 * sicurezza molto ampia su un DTM molto fine altrimenti scandirebbe milioni di nodi a ogni modifica.
 */
function fieldBBox(dem: Dem, vertices: Vertex[], reachStart: number): { c0: number; r0: number; c1: number; r1: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  let reach = reachStart;
  for (let iter = 0; iter < 8; iter++) {
    const c0 = Math.max(0, Math.floor((minX - reach) / dem.cell));
    const c1 = Math.min(dem.w - 1, Math.ceil((maxX + reach) / dem.cell));
    const r0 = Math.max(0, Math.floor((minZ - reach) / dem.cell));
    const r1 = Math.min(dem.h - 1, Math.ceil((maxZ + reach) / dem.cell));
    const cells = (c1 - c0 + 1) * (r1 - r0 + 1);
    if (cells <= ACCUMULO_FIELD_MAX_CELLS || reach < dem.cell * 4) return { c0, r0, c1, r1 };
    reach *= 0.7;
  }
  // Non dovrebbe arrivarci (il ciclo sopra ritorna sempre prima), ma tiene TypeScript tranquillo.
  const c0 = Math.max(0, Math.floor((minX - reach) / dem.cell));
  const c1 = Math.min(dem.w - 1, Math.ceil((maxX + reach) / dem.cell));
  const r0 = Math.max(0, Math.floor((minZ - reach) / dem.cell));
  const r1 = Math.min(dem.h - 1, Math.ceil((maxZ + reach) / dem.cell));
  return { c0, r0, c1, r1 };
}

/**
 * Minimax-Dijkstra (algoritmo da "priority-flood" idrologico): per ogni nodo raggiungibile dai
 * semi, la quota di colmo minima che un qualunque percorso deve comunque superare per arrivarci —
 * cioè la sella più bassa che si incontra risalendo verso quel nodo. Usata per trovare la vera quota
 * di sfioro dell'acqua (si veda `computeAccumuloField`): un pelo libero non può mai restare più alto
 * della sella più bassa che lo collega all'esterno, altrimenti sfiorerebbe di lì.
 */
function computeRim(cols: number, rows: number, terrain: Float32Array, wall: Uint8Array, seeds: number[]): Float32Array {
  const rim = new Float32Array(cols * rows).fill(Infinity);
  const finalized = new Uint8Array(cols * rows);
  const heap = new MinHeap();
  for (const li of seeds) {
    if (wall[li]) continue;
    const v = terrain[li];
    if (v < rim[li]) { rim[li] = v; heap.push(v, li); }
  }
  while (heap.size) {
    const popped = heap.pop()!;
    const p = popped[0], li = popped[1];
    if (finalized[li] || p > rim[li]) continue;
    finalized[li] = 1;
    const c = li % cols, r = (li / cols) | 0;
    for (const [dc, dr] of NEI8) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nli = nr * cols + nc;
      if (wall[nli] || finalized[nli]) continue;
      const cand = Math.max(p, terrain[nli]);
      if (cand < rim[nli]) { rim[nli] = cand; heap.push(cand, nli); }
    }
  }
  return rim;
}

/**
 * Allaga per davvero alla quota `level`: componente connessa (8-connessione) raggiungibile dai semi
 * restando sempre sotto `level`, senza mai attraversarla. A differenza di `computeRim` (che serve
 * solo a trovare la quota di sfioro), qui la soglia è fissa e la propagazione si ferma per sempre
 * appena un nodo tocca o supera `level` — se `level` è davvero la quota di sfioro, questo raggio non
 * può mai raggiungere il bordo dell'area analizzata (altrimenti la quota di sfioro sarebbe più
 * bassa), quindi resta sempre a monte, senza "scavalcare" la sella e riempire il versante a valle.
 */
function floodBelowLevel(
  cols: number, rows: number, terrain: Float32Array, wall: Uint8Array, seeds: number[], level: number,
): Uint8Array {
  const flooded = new Uint8Array(cols * rows);
  const stack: number[] = [];
  for (const li of seeds) {
    if (wall[li] || flooded[li] || terrain[li] >= level) continue;
    flooded[li] = 1;
    stack.push(li);
  }
  while (stack.length) {
    const li = stack.pop()!;
    const c = li % cols, r = (li / cols) | 0;
    for (const [dc, dr] of NEI8) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nli = nr * cols + nc;
      if (wall[nli] || flooded[nli] || terrain[nli] >= level) continue;
      flooded[nli] = 1;
      stack.push(nli);
    }
  }
  return flooded;
}

/**
 * Dijkstra geodetico: per ogni nodo, la distanza dal seme più vicino lungo il percorso più breve
 * (8-connesso), fermandosi per sempre al primo nodo in cui il terreno raggiunge il soffitto
 * `crest + tanP·distanza` (si veda `computeAccumuloField` per il detrito, che risale con pendenza
 * propria invece di restare piatto come l'acqua).
 */
function computeSlopeFlood(
  cols: number, rows: number, terrain: Float32Array, wall: Uint8Array, seeds: number[],
  crest: number, tanP: number, cellSize: number,
): { flooded: Uint8Array; surface: Float32Array } {
  const dist = new Float32Array(cols * rows).fill(Infinity);
  const finalized = new Uint8Array(cols * rows);
  const flooded = new Uint8Array(cols * rows);
  const surface = new Float32Array(cols * rows);
  const heap = new MinHeap();
  const diag = cellSize * Math.SQRT2;
  for (const li of seeds) {
    if (wall[li]) continue;
    if (0 < dist[li]) { dist[li] = 0; heap.push(0, li); }
  }
  while (heap.size) {
    const popped = heap.pop()!;
    const p = popped[0], li = popped[1];
    if (finalized[li] || p > dist[li]) continue;
    finalized[li] = 1;
    const ceiling = crest + tanP * p;
    if (terrain[li] >= ceiling) continue; // chiusura definitiva: non si espande oltre questo nodo
    flooded[li] = 1;
    surface[li] = ceiling;
    const c = li % cols, r = (li / cols) | 0;
    for (const [dc, dr] of NEI8) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nli = nr * cols + nc;
      if (wall[nli] || finalized[nli]) continue;
      const w = dc !== 0 && dr !== 0 ? diag : cellSize;
      const cand = p + w;
      if (cand < dist[nli]) { dist[nli] = cand; heap.push(cand, nli); }
    }
  }
  return { flooded, surface };
}

/**
 * Erosione morfologica leggera: toglie dal campo allagato le celle sostenute da meno di
 * `minNeighbors` vicine allagate (8-connessione), ripetuto per `passes` passate. Un vero deposito o
 * invaso ha un'estensione areale, non un percorso largo una cella; senza questo filtro, un varco
 * appena più stretto della portata di ricerca fra due rilievi qualunque — non collegato in modo
 * fisicamente significativo alla valle dello sbarramento — resterebbe comunque sotto il soffitto
 * crescente e produrrebbe un filo di accumulo sottilissimo che attraversa terreno non pertinente,
 * invece di richiudersi. Le celle protette (i semi, subito a monte dello sbarramento) non vengono
 * mai erose, perché l'accumulo deve sempre comparire lì.
 */
function pruneThinTendrils(
  cols: number, rows: number, flooded: Uint8Array, protect: Set<number>, minNeighbors = 6, passes = 4,
): Uint8Array {
  let cur = flooded;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(cur.length);
    let removedAny = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const li = r * cols + c;
        if (!cur[li]) continue;
        if (protect.has(li)) { next[li] = 1; continue; }
        let count = 0;
        for (const [dc, dr] of NEI8) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
          if (cur[nr * cols + nc]) count++;
        }
        if (count >= minNeighbors) next[li] = 1; else removedAny = true;
      }
    }
    cur = next;
    if (!removedAny) break;
  }
  return cur;
}

/**
 * Campo di accumulo a monte di uno sbarramento (§8.2/8.3/8.4 SPEC): a differenza di una fascia
 * rettangolare larga quanto il coronamento, è una vera superficie 2D che nasce dal coronamento e
 * incontra il terreno a 360° — compresi i fianchi, dove può aggirare le spalle dello sbarramento
 * esattamente come farebbe il materiale reale (o l'acqua) se il terreno lì fosse più basso.
 *
 * Lo sbarramento stesso è un ostacolo fisico: i nodi entro `spessore/2` dalla traccia sono esclusi
 * dal campo (non attraversabili), quindi il propagarsi verso valle può avvenire solo aggirando le
 * due estremità della traccia, non attraversandola.
 *
 * - **Acqua** (pendenza 0°): pelo libero piatto, ma alla vera quota di sfioro — non necessariamente
 *   il coronamento. Se sui fianchi esiste una sella più bassa del coronamento che comunica con
 *   l'esterno dell'area analizzata, l'acqua sfiora lì: non può restare appoggiata a monte a una
 *   quota superiore alla sella più bassa che la collega all'esterno (si veda `computeRim`).
 * - **Detrito** (pendenza > 0°): risale verso monte con pendenza propria; la chiusura è locale, non
 *   una quota unica come per l'acqua, perché il detrito non insegue un equilibrio idrostatico:
 *   ogni direzione si ferma al primo punto in cui il proprio soffitto incontra il terreno.
 */
export function computeAccumuloField(dem: Dem, vertices: Vertex[], muro: Muro): AccumuloField | null {
  if (!muro.accumulo.attivo || vertices.length < 2) return null;

  const crest = muroCrestElevation(dem, vertices, muro);
  const tanP = accumuloTanPendenza(muro);
  const lato = muro.accumulo.lato;
  const length = trackLength(vertices);

  // Per il detrito la portata di ricerca è proporzionale all'altezza dello sbarramento, non il tetto
  // di sicurezza pieno usato per l'acqua: senza questo limite, un varco largo appena una cella tra
  // due rilievi qualunque — non collegato in modo fisicamente significativo alla valle della diga —
  // può restare sotto il soffitto crescente per centinaia di metri, producendo un filo di accumulo
  // sottilissimo che attraversa rilievi non pertinenti invece di un vero cono/deposito locale.
  // L'acqua non ha questo problema: un pelo libero allaga per intero qualunque bacino sotto la sua
  // quota di sfioro, non solo un percorso a filo, quindi mantiene la portata di ricerca piena.
  const reach = tanP < 1e-6 ? ACCUMULO_MAX_REACH : Math.min(150, Math.max(30, muro.altezza * 10));
  const { c0, r0, c1, r1 } = fieldBBox(dem, vertices, reach);
  const cols = c1 - c0 + 1, rows = r1 - r0 + 1;
  if (cols < 2 || rows < 2) return null;

  const terrain = new Float32Array(cols * rows);
  const wall = new Uint8Array(cols * rows);
  const half = Math.max(muro.spessore / 2, dem.cell * 0.5);
  const seeds: number[] = [];

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const li = (r - r0) * cols + (c - c0);
      terrain[li] = dem.data[r * dem.w + c];
      const { d } = projectOntoTrack(vertices, { x: c * dem.cell, z: r * dem.cell });
      const absD = Math.abs(d);
      if (absD <= half) { wall[li] = 1; continue; }
      if (d * lato > 0 && absD <= half + dem.cell) seeds.push(li);
    }
  }
  if (!seeds.length) return null;

  let flooded: Uint8Array;
  let surface: Float32Array;

  if (tanP < 1e-6) {
    const rim = computeRim(cols, rows, terrain, wall, seeds);
    let zSpill = crest;
    for (let c = 0; c < cols; c++) {
      const top = rim[c], bot = rim[(rows - 1) * cols + c];
      if (top < zSpill) zSpill = top;
      if (bot < zSpill) zSpill = bot;
    }
    for (let r = 0; r < rows; r++) {
      const left = rim[r * cols], right = rim[r * cols + cols - 1];
      if (left < zSpill) zSpill = left;
      if (right < zSpill) zSpill = right;
    }
    // `rim` serve solo a trovare zSpill: usarlo anche per decidere le celle allagate (rim <= zSpill)
    // lascerebbe l'acqua "attraversare" la sella e riempire pure il versante a valle, perché il
    // percorso più economico verso qualunque punto oltre la sella resta comunque sotto zSpill una
    // volta superata (è così che è stata trovata la sella stessa). L'invaso vero è solo la
    // componente connessa raggiungibile dai semi restando sempre SOTTO zSpill: per costruzione non
    // può mai raggiungere il bordo dell'area analizzata (se potesse, zSpill sarebbe più basso), quindi
    // si ferma da sola esattamente alla sella, senza proseguire a valle.
    flooded = floodBelowLevel(cols, rows, terrain, wall, seeds, zSpill);
    surface = new Float32Array(cols * rows).fill(zSpill);
  } else {
    const res = computeSlopeFlood(cols, rows, terrain, wall, seeds, crest, tanP, dem.cell);
    flooded = pruneThinTendrils(cols, rows, res.flooded, new Set(seeds));
    surface = res.surface;
  }

  let any = false;
  for (let i = 0; i < flooded.length; i++) if (flooded[i]) { any = true; break; }
  if (!any) return null;

  return { c0, r0, cols, rows, cell: dem.cell, terrain, flooded, surface };
}

/** Volume e area in pianta dell'accumulo (§8.2/8.3/8.4 SPEC), dal campo 2D di `computeAccumuloField`. */
export function computeAccumulo(dem: Dem, vertices: Vertex[], muro: Muro): AccumuloResult | null {
  const field = computeAccumuloField(dem, vertices, muro);
  if (!field) return null;
  const crest = muroCrestElevation(dem, vertices, muro);
  const cellArea = field.cell * field.cell;
  let volume = 0, area = 0;
  for (let i = 0; i < field.flooded.length; i++) {
    if (!field.flooded[i]) continue;
    volume += (field.surface[i] - field.terrain[i]) * cellArea;
    area += cellArea;
  }
  return { crest, volume, area };
}

/**
 * Pendenza oltre la quale la superficie di accumulo, con l'altezza e il terreno attuali, non
 * incontrerebbe più il versante entro una distanza fisicamente ragionevole (si allontanerebbe verso
 * il tetto di sicurezza invece di chiudersi contro il terreno reale, dando un risultato senza senso).
 * Dipende sia dalla pendenza reale del terreno a monte, campionata lungo l'asse dell'accumulo, sia
 * dall'altezza dello sbarramento: uno sbarramento più alto parte da una quota di sommità più alta e
 * quindi impiega più distanza perché il terreno lo raggiunga, a parità di pendenza impostata. Il
 * margine del 15% tiene il suggerimento sotto la pendenza reale del versante, non esattamente pari
 * (pari o oltre, l'accumulo non si chiuderebbe mai da solo).
 */
export function accumuloMaxPendenzaGradi(dem: Dem, vertices: Vertex[], muro: Muro): number {
  const length = trackLength(vertices);
  const { px, pz, nx, nz } = accumuloRayAt(vertices, length, length / 2, muro.accumulo.lato);
  const crest = muroCrestElevation(dem, vertices, muro);
  const dTarget = Math.min(Math.max(30, muro.altezza * 15), ACCUMULO_MAX_REACH);
  const terrainAtTarget = heightAt(dem, px + nx * dTarget, pz + nz * dTarget);
  const tanMax = (terrainAtTarget - crest) / dTarget;
  if (tanMax <= 0) return 0;
  const gradi = (Math.atan(tanMax) * 180) / Math.PI;
  return Math.max(0, Math.floor(gradi * 0.85));
}

export function defaultAccumulo(): Accumulo {
  return { attivo: false, pendenzaGradi: 0, lato: 1 };
}
