import type { Dem, PuntoQuotato, SlopeBreaks, Tool, Traccia, TracciaKind } from './types';
import type { TrackVolume } from './terrainOps';
import type { MuroStats } from './muro';
import type { AccumuloResult } from './accumulo';
import type { OperaPreset } from './presets';
import { defaultPresets } from './presets';
import { DEFAULT_EXAG, DEFAULT_SLOPE_BREAKS, DEFAULT_SNAP_STEP, DEFAULT_SNAP_STEP_VERT } from './config';

export interface DemInfoRow {
  label: string;
  value: string;
}

/**
 * Stato reattivo condiviso dall'app. Contiene solo dati semplici/serializzabili:
 * gli oggetti three.js e i nodi DOM (mesh dei punti, etichette) vivono altrove
 * (three/points.ts) per non farli passare dal proxy di reattività di Svelte.
 */
export const appState = $state({
  dem: null as Dem | null,
  demInfo: [] as DemInfoRow[],
  tool: 'inspect' as Tool,
  exag: DEFAULT_EXAG,
  points: [] as PuntoQuotato[],
  slopeBreaks: [...DEFAULT_SLOPE_BREAKS] as SlopeBreaks,

  tracks: [] as Traccia[],
  selectedTrackId: null as number | null,
  drawingTrackId: null as number | null,
  pendingTrackKind: 'terreno' as TracciaKind,
  trackVolumes: {} as Record<number, TrackVolume>,
  muroStats: {} as Record<number, MuroStats>,
  accumuloStats: {} as Record<number, AccumuloResult>,
  presets: defaultPresets() as OperaPreset[],
  nextPresetId: 1,
  gridVisible: false,
  snapStep: DEFAULT_SNAP_STEP,
  snapStepVert: DEFAULT_SNAP_STEP_VERT,

  showContour: true,
  contourStep: 5,
  showSlope: false,
  opacity: 1,
  showWireframe: false,

  statusHint: 'Carica un DTM per iniziare',
  statusE: '—',
  statusN: '—',
  statusZ: '—',
  statusSlope: '—',

  welcomeOpen: true,
  cropOpen: false,
  panelOpenMobile: false,

  loading: { active: false, msg: '' },
  toast: { msg: '', show: false },
});
