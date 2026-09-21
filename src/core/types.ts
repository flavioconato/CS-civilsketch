export interface Dem {
  w: number;
  h: number;
  cell: number;
  data: Float32Array;
  e0: number;
  n0: number;
  zmin: number;
  zmax: number;
  epsg: number | null;
  name: string;
  filled?: number;
}

export type Tool = 'inspect' | 'point' | 'track';

export interface PuntoQuotato {
  id: number;
  x: number;
  z: number;
  zr: number;
}

export interface PickResult {
  x: number;
  z: number;
}

export type SlopeBreaks = [number, number, number, number];

/** Vertice planimetrico di una traccia, in coordinate scena locali (stesso spazio dei punti quotati). */
export interface Vertex {
  x: number;
  z: number;
}

export type LivellettaMode = 'pendenza' | 'quote' | 'vertici' | 'terreno';

export interface LivellettaVertex {
  prog: number;
  quota: number;
}

/**
 * Profilo di progetto di una traccia (§6.2 SPEC): modalità alternative per definire z(s).
 * `terreno` è come `vertici` (interpolazione lineare tra progressiva e quota), ma `vertici` viene
 * ricalcolato automaticamente dalla quota del terreno naturale a ogni vertice della traccia —
 * comoda per un oggetto che deve seguire da vicino l'andamento naturale senza doverlo quotare a mano.
 */
export interface Livelletta {
  mode: LivellettaMode;
  quotaIniziale: number;
  pendenza: number;
  quotaFinale: number;
  vertici: LivellettaVertex[];
}

export type SezioneTipo = 'canale' | 'rilevato';

/** Punto del profilo trasversale: distanza con segno dall'asse (m) e scostamento dalla livelletta (m). */
export interface SezionePunto {
  d: number;
  dz: number;
}

/**
 * Rivestimento di uno scavo (canale o vasca): un guscio sottile reso sulla superficie di scavo,
 * senza offset geometrico verso l'esterno (coincide con la superficie di progetto, per restare
 * leggero) — `spessore` serve solo a stimare l'area/volume di rivestimento nel pannello.
 */
export interface Rivestimento {
  attivo: boolean;
  spessore: number;
}

/**
 * Sezione trasversale applicata lungo una traccia per modificare il terreno (§7 SPEC).
 * La livelletta della traccia dà la quota di riferimento (fondo canale o piano di un rilevato);
 * `punti` è il profilo disegnato dall'utente, in ordine di distanza `d` crescente (almeno 2 punti).
 * Oltre l'ultimo punto di ciascun lato il profilo prosegue con la stessa pendenza, cosa che
 * permette alle scarpate di raggiungere da sole il terreno naturale (si veda `sectionOffset`).
 * `rivestimento` ha senso solo per `tipo:'canale'` (uno scavo): un rilevato non si riveste.
 */
export interface Sezione {
  tipo: SezioneTipo;
  punti: SezionePunto[];
  rivestimento: Rivestimento;
}

/** Categoria dell'opera (§12 SPEC): determina colore e, in futuro, icona. */
export type OperaCategoria = 'ferrovia' | 'idraulica' | 'contenimento' | 'protezione' | 'cls';

/**
 * Cosa rappresenta la traccia, scelto prima di disegnarla:
 * - `traccia`: solo polilinea, nessuna quota di progetto.
 * - `livelletta`: traccia con profilo di progetto (§6.2), senza modificare il terreno.
 * - `terreno`: modifica il terreno in scavo o riporto lungo una sezione trasversale (§7).
 * - `vasca`: scavo a pianta poligonale con fondo piatto e scarpate (§8.2), senza asse lineare.
 * - `oggetto`: un oggetto separato che si appoggia al terreno (es. un muro, §8.3) senza modificarlo.
 */
export type TracciaKind = 'traccia' | 'livelletta' | 'terreno' | 'vasca' | 'oggetto';

/**
 * Accumulo trattenuto a monte da uno sbarramento (muro, barriera paramassi/paradetriti, briglia,
 * §8.2/8.3/8.4 SPEC): una superficie che parte dalla quota di sommità dello sbarramento e scende
 * verso monte con pendenza `pendenzaGradi` rispetto all'orizzontale — 0° per l'acqua (pelo libero
 * piatto, come un invaso), maggiore di 0° per il detrito (angolo di riposo del materiale). Il
 * volume accumulabile è la differenza, dove positiva, tra questa superficie e il terreno (si veda
 * `core/accumulo.ts`). `lato` è il segno della distanza dall'asse traccia che punta verso monte
 * (rilevato dal terreno la prima volta che si attiva, poi fisso per evitare salti imprevisti).
 */
export interface Accumulo {
  attivo: boolean;
  pendenzaGradi: number;
  lato: 1 | -1;
}

/**
 * Muro di contenimento (§8.3 SPEC): oggetto separato, non modifica il terreno. La base insegue il
 * terreno (incassata di `fondazione`), ma la sommità resta a **quota costante** lungo tutta la
 * traccia: `altezza` è l'altezza fuori terra massima, che si sviluppa per intero solo nel punto
 * più basso del terreno; dove il terreno sale, l'altezza fuori terra diminuisce di conseguenza
 * (si veda `core/muro.ts`). Vale anche per barriere e briglie (§8.2/8.4), oggetti di sbarramento
 * modellati allo stesso modo finché non avranno una geometria propria.
 */
export interface Muro {
  altezza: number;
  spessore: number;
  fondazione: number;
  accumulo: Accumulo;
}

/**
 * Vasca di laminazione o deposito (§8.2 SPEC): scavo a pianta poligonale (`Traccia.vertices` è il
 * contorno chiuso, senza duplicare il primo vertice in coda). Dal contorno il terreno scende con
 * la scarpata `scarpataRapporto` (stesso rapporto orizzontale:verticale di `trapezioPunti`) fino
 * alla quota piatta `quotaFondo`; non serve una larghezza di fondo esplicita, esce da sola come
 * per le scarpate di canale/rilevato (si veda `core/terrainOps.ts`).
 */
export interface Vasca {
  quotaFondo: number;
  scarpataRapporto: number;
  rivestimento: Rivestimento;
}

export interface Traccia {
  id: number;
  name: string;
  kind: TracciaKind;
  vertices: Vertex[];
  livelletta: Livelletta;
  sezione: Sezione | null;
  vasca: Vasca | null;
  muro: Muro | null;
  categoria: OperaCategoria | null;
}
