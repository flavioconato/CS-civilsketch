import type { SlopeBreaks } from './types';

/** Dimensione (in celle) di ogni chunk di terreno. */
export const CHUNK_SIZE = 250;

/** Passi di sotto-campionamento per i livelli di LOD di ogni chunk. */
export const LOD_STEPS = [1, 4, 16] as const;

/** Fattori di distanza (rispetto allo span del chunk) a cui passare al livello di LOD successivo. */
export const LOD_DISTANCE_FACTORS = { 1: 1.6, 2: 5 } as const;

export const SLOPE_COLORS = ['#e8f0d8', '#bcd88f', '#f0cf6a', '#e49a4b', '#c65a4a'] as const;

/** Valori segnaposto: da impostare secondo gli standard dell'utente. */
export const DEFAULT_SLOPE_BREAKS: SlopeBreaks = [10, 30, 50, 100];

export const EXAG_MIN = 1;
export const EXAG_MAX = 3;
export const EXAG_STEP = 0.25;
export const DEFAULT_EXAG = 1;

export const DEFAULT_CONTOUR_STEP = 5;

/** Lato massimo (px) dell'anteprima usata per il ritaglio e l'hillshade. */
export const CROP_PREVIEW_MAX_PX = 520;

export const CROP_FACTORS = [1, 2, 3, 4, 5, 10] as const;

/** Soglia di celle oltre la quale si suggerisce un passo di ricampionamento più largo. */
export const CROP_SUGGEST_MAX_CELLS = 6e6;

/** Soglia di celle oltre la quale si avvisa che l'area potrebbe essere lenta. */
export const CROP_WARN_MAX_CELLS = 8e6;

/** Quote fuori da questo intervallo sono considerate non valide (oltre al NoData dichiarato). */
export const VALID_Z_MIN = -1000;
export const VALID_Z_MAX = 9000;

/* ---------- Griglia, snap e tracce (§5, §6 SPEC) ---------- */

export const SNAP_STEPS = [0.25, 0.5, 1, 2] as const;
export const DEFAULT_SNAP_STEP = 0.5;
export const DEFAULT_SNAP_STEP_VERT = 0.1;

/** Passo minimo del campionamento di draping lungo una traccia, in metri. */
export const TRACK_SAMPLE_STEP = 2;

export const TRACK_NATURAL_COLOR = '#3a4636';
export const TRACK_DESIGN_COLOR = '#1f5fbf';
export const TRACK_VERTEX_COLOR = '#1f5fbf';
export const TRACK_TUBE_RADIUS = 0.35;
export const TRACK_VERTEX_RADIUS = 0.7;

/** Distanza massima in pixel schermo per considerare un click "sopra" un vertice di traccia. */
export const TRACK_VERTEX_HIT_PX = 12;

/* ---------- Modifica terreno: sezioni di canale/rilevato (§7 SPEC) ---------- */

/** Valori segnaposto per un profilo trapezio di default: da impostare secondo gli standard dell'utente. */
export const SEZIONE_DEFAULT_LARGHEZZA = 6;
export const SEZIONE_DEFAULT_SCARPATA = 1.5;

/**
 * Margine oltre l'estensione del profilo disegnato entro cui si cerca il raccordo (daylight) con
 * il terreno naturale. Oltre questa distanza min/max non modificherebbe comunque più il terreno
 * per scarpate ragionevoli, quindi il limite evita di scandire l'intero DTM per tracce con
 * scarpate molto dolci.
 */
export const SEZIONE_MAX_REACH = 120;

/* ---------- Libreria opere: categorie e palette (§8, §12 SPEC) ---------- */

export const OPERA_CATEGORY_LABELS = {
  ferrovia: 'Ferrovia',
  idraulica: 'Idraulica',
  contenimento: 'Contenimento',
  protezione: 'Protezione',
  cls: 'Cls generico',
} as const;

/** Placeholder cromatico per categoria: da rivedere secondo gli standard grafici dell'utente. */
export const OPERA_CATEGORY_COLORS = {
  ferrovia: '#1f5fbf',
  idraulica: '#0e9594',
  contenimento: '#a5682a',
  protezione: '#c1443c',
  cls: '#7a7a72',
} as const;

export const TRACCIA_KIND_LABELS = {
  traccia: 'Traccia semplice',
  livelletta: 'Livelletta',
  terreno: 'Scavo o riporto',
  oggetto: 'Oggetto da inserire',
} as const;

export const TRACCIA_KIND_HINTS = {
  traccia: 'Solo polilinea, senza quote di progetto.',
  livelletta: 'Traccia con profilo di progetto, senza modificare il terreno.',
  terreno: 'Canale, rilevato o trincea: modifica il terreno lungo una sezione.',
  oggetto: 'Un oggetto separato (muro, barriera o briglia) che si appoggia al terreno senza modificarlo.',
} as const;

/** Valori segnaposto per il muro di contenimento (§8.3 SPEC): da impostare secondo gli standard dell'utente. */
export const MURO_DEFAULT_ALTEZZA = 2;
export const MURO_DEFAULT_SPESSORE = 0.4;
export const MURO_DEFAULT_FONDAZIONE = 0.5;

/* ---------- Accumulo a monte di uno sbarramento (§8.2/8.3/8.4 SPEC) ---------- */

/** Pendenza di default della superficie di accumulo: acqua (pelo libero orizzontale). */
export const ACCUMULO_DEFAULT_PENDENZA = 0;

/**
 * Distanza massima a monte fino a cui si cerca il raccordo con il terreno naturale (oltre questa
 * distanza si smette comunque di contare accumulo, anche per pendenza 0 = acqua, che altrimenti su
 * terreno molto pianeggiante non incontrerebbe mai il terreno da sola).
 */
export const ACCUMULO_MAX_REACH = 300;
