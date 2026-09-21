import * as THREE from 'three';
import type {
  Accumulo, Dem, Livelletta, LivellettaVertex, Muro, OperaCategoria, PickResult, SezionePunto, SezioneTipo, SlopeBreaks,
  Tool, Traccia, TracciaKind,
} from '../core/types';
import type { DemInfoRow } from '../core/appState.svelte';
import { appState } from '../core/appState.svelte';
import { fmt } from '../core/format';
import { heightAt, slopeAt } from '../dem/dem';
import {
  buildHillshadePreview, loadGeoTiffSource, pixelsFromSelection, readCroppedDem, suggestCropFactor,
  type CropSelection, type GeoTiffSource, type HillshadePreview,
} from '../dem/geotiff-io';
import { generateSyntheticDem } from '../dem/synthetic';
import {
  CROP_FACTORS, CROP_WARN_MAX_CELLS, MURO_DEFAULT_ALTEZZA, MURO_DEFAULT_FONDAZIONE, MURO_DEFAULT_SPESSORE,
  SEZIONE_DEFAULT_LARGHEZZA, SEZIONE_DEFAULT_SCARPATA, TRACK_VERTEX_HIT_PX,
} from '../core/config';
import { distanceToPolyline, trackLength } from '../core/polyline';
import { defaultLivelletta, livellettaVerticesFromTerrain } from '../core/livelletta';
import { muroStats } from '../core/muro';
import { computeAccumulo, defaultAccumulo } from '../core/accumulo';
import { computeProjectDem, trapezioPunti } from '../core/terrainOps';
import type { OperaPreset } from '../core/presets';
import { snapPoint } from '../core/snap';
import { ThreeContext } from '../three/scene';
import { buildTerrain, setWire } from '../three/terrain';
import { pick } from '../three/picking';
import { fitView, moveWasd, type WasdKeys } from '../three/camera';
import { extent } from '../three/coords';
import { PointsLayer } from '../three/points';
import { TracksLayer } from '../three/tracks';

/** Orchestratore dell'app: tiene insieme scena three.js, stato reattivo e flusso di import/ritaglio del DTM. */
export class AppController {
  ctx: ThreeContext;
  points: PointsLayer;
  tracks: TracksLayer;

  private keys: WasdKeys & Record<string, boolean> = {};
  private clock = new THREE.Clock();
  private hoverReq: number | null = null;
  private lastMove: PointerEvent | null = null;
  private down: { x: number; y: number } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  private geo: GeoTiffSource | null = null;
  hillshade: HillshadePreview | null = null;
  cropSel: CropSelection = { x0: 0, y0: 0, x1: 0, y1: 0 };
  cropFactors: readonly number[] = CROP_FACTORS;

  private nextTrackId = 1;
  private drawStartVertexCount = 0;
  private hoverVertexIndex: number | null = null;
  private draggingVertex: { trackId: number; index: number } | null = null;
  /** Terreno di progetto: copia del DTM naturale con le sezioni delle tracce applicate (§7 SPEC). */
  private projectDem: Dem | null = null;

  constructor(container: HTMLElement, labelsContainer: HTMLElement) {
    this.ctx = new ThreeContext(container);
    this.points = new PointsLayer(this.ctx, labelsContainer);
    this.tracks = new TracksLayer(this.ctx, labelsContainer);
    this.ctx.uniforms.uGridStep.value = appState.snapStep;
    this.wireCanvasInput();
    this.wireKeyboard();
    this.startLoop();
    this.setTool('inspect');
  }

  /* ---------- Strumenti e viste ---------- */

  setTool(tool: Tool): void {
    this.hoverVertexIndex = null;
    this.ctx.controls.suspended = false;
    appState.tool = tool;
    if (tool === 'track' && !appState.gridVisible) this.toggleGrid();
    appState.statusHint = !appState.dem
      ? 'Carica un DTM per iniziare'
      : tool === 'point'
        ? 'Clicca sul terreno per inserire un punto quotato'
        : tool === 'track'
          ? (appState.drawingTrackId !== null
            ? 'Clicca per aggiungere vertici, tasto destro per tornare indietro di un punto, Invio per terminare, Esc per annullare'
            : 'Clicca per iniziare una traccia o selezionarne una esistente')
          : 'Passa sul terreno per leggere quota e pendenza';
  }

  fitView(plan: boolean): void {
    if (!appState.dem) return;
    fitView(this.ctx, this.displayDem!, appState.exag, plan);
  }

  /* ---------- Griglia e snap ---------- */

  toggleGrid(): void {
    appState.gridVisible = !appState.gridVisible;
    this.ctx.uniforms.uGrid.value = appState.gridVisible ? 1 : 0;
  }

  setSnapStep(v: number): void {
    appState.snapStep = v;
    this.ctx.uniforms.uGridStep.value = v;
    if (appState.dem && v < appState.dem.cell) {
      this.toast('Lo snap è più fine della maglia del DTM: la precisione è solo apparente.');
    }
  }

  setSnapStepVert(v: number): void {
    appState.snapStepVert = v;
  }

  /* ---------- Pannello visualizzazione ---------- */

  toggleContour(): void {
    appState.showContour = !appState.showContour;
    this.ctx.uniforms.uContour.value = appState.showContour ? 1 : 0;
  }

  setContourStep(v: number): void {
    appState.contourStep = v;
    this.ctx.uniforms.uStep.value = v;
  }

  setSlopeMode(on: boolean): void {
    appState.showSlope = on;
    this.ctx.uniforms.uSlope.value = on ? 1 : 0;
  }

  setSlopeBreaks(breaks: SlopeBreaks): void {
    appState.slopeBreaks = breaks;
    this.ctx.uniforms.uB.value.set(...breaks);
  }

  setOpacity(v: number): void {
    appState.opacity = v;
    this.ctx.terrainMat.opacity = v;
    const tr = v < 0.999;
    if (this.ctx.terrainMat.transparent !== tr) {
      this.ctx.terrainMat.transparent = tr;
      this.ctx.terrainMat.needsUpdate = true;
    }
  }

  setWireframe(on: boolean): void {
    appState.showWireframe = on;
    setWire(this.ctx, on);
  }

  async setExag(v: number): Promise<void> {
    if (!appState.dem) { appState.exag = v; return; }
    const old = appState.exag;
    appState.exag = v;
    const k = v / old;
    this.ctx.controls.target.y *= k;
    this.ctx.camera.position.y *= k;
    await this.showLoading('Aggiornamento del terreno…');
    buildTerrain(this.ctx, this.displayDem!, appState.exag);
    this.points.placePins(this.displayDem!, appState.exag);
    this.rebuildTracks();
    this.hideLoading();
  }

  /* ---------- Punti quotati ---------- */

  removePoint(id: number): void { this.points.remove(id); }

  /* ---------- Tracce ---------- */

  /** Terreno attualmente visibile in scena: quello di progetto se esistono sezioni, altrimenti quello naturale. */
  private get displayDem(): Dem | null {
    return this.projectDem ?? appState.dem;
  }

  private rebuildTracks(): void {
    if (!appState.dem) return;
    const dem = this.displayDem ?? appState.dem;
    for (const t of appState.tracks) {
      if (t.livelletta.mode === 'terreno' && t.vertices.length >= 2) {
        t.livelletta.vertici = livellettaVerticesFromTerrain(appState.dem, t.vertices);
      }
    }
    this.tracks.rebuild(appState.dem, dem, appState.exag, appState.tracks, appState.selectedTrackId, this.draggingVertex === null);
    const stats: typeof appState.muroStats = {};
    for (const t of appState.tracks) {
      if (t.kind === 'oggetto' && t.muro && t.vertices.length >= 2) stats[t.id] = muroStats(dem, t.vertices, t.muro);
    }
    appState.muroStats = stats;

    // L'accumulo scandisce una fascia di terreno a monte: più pesante dei conti sopra, quindi si
    // salta durante il trascinamento di un vertice (si ricalcola al rilascio) per restare fluidi.
    if (this.draggingVertex === null) {
      const accStats: typeof appState.accumuloStats = {};
      for (const t of appState.tracks) {
        if (t.kind === 'oggetto' && t.muro?.accumulo.attivo && t.vertices.length >= 2) {
          const res = computeAccumulo(dem, t.vertices, t.muro);
          if (res) accStats[t.id] = res;
        }
      }
      appState.accumuloStats = accStats;
    }
  }

  /** Ricalcola l'heightmap di progetto dalle sezioni delle tracce e ricostruisce il terreno in scena. */
  private rebuildTerrainProject(): void {
    const dem = appState.dem;
    if (!dem) { this.projectDem = null; return; }
    const { data, volumes } = computeProjectDem(dem, appState.tracks);
    this.projectDem = { ...dem, data };
    appState.trackVolumes = volumes;
    buildTerrain(this.ctx, this.projectDem, appState.exag);
    this.points.placePins(this.projectDem, appState.exag);
  }

  private snapXZ(x: number, z: number, bypass: boolean): { x: number; z: number } {
    return snapPoint({ x, z }, appState.snapStep, bypass);
  }

  /** Traccia più vicina al punto del terreno cliccato, entro una tolleranza in metri, o null (§10.1: oggetti interrogabili). */
  private findTrackNear(p: PickResult): number | null {
    const dem = appState.dem;
    if (!dem) return null;
    const hitThreshold = Math.max(dem.cell * 2, 2);
    let closest: { id: number; dist: number } | null = null;
    for (const t of appState.tracks) {
      const d = distanceToPolyline(t.vertices, p);
      if (d < hitThreshold && (!closest || d < closest.dist)) closest = { id: t.id, dist: d };
    }
    return closest?.id ?? null;
  }

  /** Strumento Interroga su una traccia/oggetto (muro, scavo o riporto): lo seleziona per mostrarne i dati (§10.1). */
  inspectClick(p: PickResult): void {
    const id = this.findTrackNear(p);
    if (id !== null) this.selectTrack(id);
  }

  private handleTrackClick(p: PickResult, altKey: boolean): void {
    if (appState.drawingTrackId !== null) {
      const track = appState.tracks.find((t) => t.id === appState.drawingTrackId);
      if (!track) return;
      const sp = this.snapXZ(p.x, p.z, altKey);
      track.vertices.push({ x: sp.x, z: sp.z });
      this.rebuildTracks();
      this.rebuildTerrainProject();
      return;
    }
    const closestId = this.findTrackNear(p);
    if (closestId !== null) {
      this.selectTrack(closestId);
    } else {
      const dem = appState.dem!;
      const sp = this.snapXZ(p.x, p.z, altKey);
      const id = this.nextTrackId++;
      const kind = appState.pendingTrackKind;
      const track: Traccia = {
        id,
        name: `Traccia ${id}`,
        kind,
        vertices: [{ x: sp.x, z: sp.z }],
        livelletta: defaultLivelletta(heightAt(dem, sp.x, sp.z)),
        sezione: kind === 'terreno' ? { tipo: 'canale', punti: trapezioPunti('canale', SEZIONE_DEFAULT_LARGHEZZA, SEZIONE_DEFAULT_SCARPATA) } : null,
        muro: kind === 'oggetto'
          ? { altezza: MURO_DEFAULT_ALTEZZA, spessore: MURO_DEFAULT_SPESSORE, fondazione: MURO_DEFAULT_FONDAZIONE, accumulo: defaultAccumulo() }
          : null,
        categoria: kind === 'oggetto' ? 'contenimento' : null,
      };
      appState.tracks.push(track);
      appState.drawingTrackId = id;
      appState.selectedTrackId = id;
      this.drawStartVertexCount = 1;
      this.setTool('track');
      this.rebuildTracks();
    }
  }

  finishTrackDraw(): void {
    appState.drawingTrackId = null;
    this.setTool('track');
    this.rebuildTracks();
  }

  /** Scelta del tipo di traccia dal menu della barra strumenti, prima di iniziare a disegnare. */
  startTrackKind(kind: TracciaKind): void {
    appState.pendingTrackKind = kind;
    this.setTool('track');
  }

  cancelTrackDraw(): void {
    const id = appState.drawingTrackId;
    if (id === null) return;
    const track = appState.tracks.find((t) => t.id === id);
    appState.drawingTrackId = null;
    if (track) {
      track.vertices.length = Math.min(track.vertices.length, this.drawStartVertexCount);
      if (track.vertices.length < 2) {
        appState.tracks = appState.tracks.filter((t) => t.id !== id);
        if (appState.selectedTrackId === id) appState.selectedTrackId = null;
      }
    }
    this.setTool('track');
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  /** Tasto destro durante il disegno: toglie l'ultimo vertice inserito (annulla la traccia se non ce n'è ancora nessuno). */
  undoLastVertex(): void {
    const id = appState.drawingTrackId;
    if (id === null) return;
    const track = appState.tracks.find((t) => t.id === id);
    if (!track) return;
    if (track.vertices.length > this.drawStartVertexCount) {
      track.vertices.pop();
      this.rebuildTracks();
      this.rebuildTerrainProject();
    } else if (track.vertices.length <= 1) {
      this.cancelTrackDraw();
    }
  }

  continueTrack(id: number): void {
    const track = appState.tracks.find((t) => t.id === id);
    if (!track) return;
    appState.selectedTrackId = id;
    appState.drawingTrackId = id;
    this.drawStartVertexCount = track.vertices.length;
    this.setTool('track');
    this.rebuildTracks();
  }

  selectTrack(id: number | null): void {
    if (appState.drawingTrackId !== null) return;
    appState.selectedTrackId = id;
    this.rebuildTracks();
  }

  renameTrack(id: number, name: string): void {
    const track = appState.tracks.find((t) => t.id === id);
    if (track) track.name = name;
  }

  removeTrack(id: number): void {
    appState.tracks = appState.tracks.filter((t) => t.id !== id);
    if (appState.selectedTrackId === id) appState.selectedTrackId = null;
    if (appState.drawingTrackId === id) appState.drawingTrackId = null;
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  removeTrackVertex(trackId: number, index: number): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.vertices.splice(index, 1);
    if (track.vertices.length < 2) {
      this.removeTrack(trackId);
      return;
    }
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  updateLivelletta(trackId: number, patch: Partial<Livelletta>): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.livelletta = { ...track.livelletta, ...patch };
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  addLivellettaVertex(trackId: number): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track) return;
    const length = trackLength(track.vertices);
    track.livelletta.vertici.push({ prog: Math.round(length / 2), quota: track.livelletta.quotaIniziale });
    track.livelletta.vertici.sort((a, b) => a.prog - b.prog);
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  updateLivellettaVertex(trackId: number, idx: number, patch: Partial<LivellettaVertex>): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.livelletta.vertici[idx] = { ...track.livelletta.vertici[idx], ...patch };
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  removeLivellettaVertex(trackId: number, idx: number): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.livelletta.vertici.splice(idx, 1);
    this.rebuildTracks();
    this.rebuildTerrainProject();
  }

  /* ---------- Modifica terreno: sezione trasversale (§7 SPEC) ---------- */

  setSezioneTipo(trackId: number, tipo: SezioneTipo): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== 'terreno') return;
    track.sezione = { tipo, punti: trapezioPunti(tipo, SEZIONE_DEFAULT_LARGHEZZA, SEZIONE_DEFAULT_SCARPATA) };
    this.rebuildTerrainProject();
  }

  updateSezionePunti(trackId: number, punti: SezionePunto[]): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track || !track.sezione || punti.length < 2) return;
    track.sezione = { ...track.sezione, punti };
    this.rebuildTerrainProject();
  }

  setCategoria(trackId: number, categoria: OperaCategoria | null): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track) return;
    track.categoria = categoria;
    this.rebuildTracks();
  }

  /* ---------- Oggetto: muro di contenimento (§8.3 SPEC) ---------- */

  updateMuro(trackId: number, patch: Partial<Muro>): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track || !track.muro) return;
    track.muro = { ...track.muro, ...patch };
    this.rebuildTracks();
  }

  /** Accumulo trattenuto a monte (§8.2/8.3/8.4 SPEC): acqua o detrito, a seconda della pendenza della superficie. */
  setAccumulo(trackId: number, patch: Partial<Accumulo>): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track || !track.muro) return;
    track.muro = { ...track.muro, accumulo: { ...track.muro.accumulo, ...patch } };
    this.rebuildTracks();
  }

  /* ---------- Libreria opere: preset di sezione riusabili (§8 SPEC) ---------- */

  applyPreset(trackId: number, presetId: number): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    const preset = appState.presets.find((p) => p.id === presetId);
    if (!track || track.kind !== 'terreno' || !preset) return;
    track.sezione = { tipo: preset.tipo, punti: preset.punti.map((p) => ({ ...p })) };
    track.categoria = preset.categoria;
    this.rebuildTerrainProject();
  }

  saveSezioneAsPreset(trackId: number, nome: string, categoria: OperaCategoria): void {
    const track = appState.tracks.find((t) => t.id === trackId);
    if (!track || !track.sezione) return;
    const preset: OperaPreset = {
      id: appState.nextPresetId++,
      nome: nome.trim() || 'Preset senza nome',
      categoria,
      tipo: track.sezione.tipo,
      punti: track.sezione.punti.map((p) => ({ ...p })),
    };
    appState.presets = [...appState.presets, preset];
  }

  removePreset(id: number): void {
    appState.presets = appState.presets.filter((p) => p.id !== id);
  }

  /* ---------- Overlay: loading / toast ---------- */

  showLoading(msg: string): Promise<void> {
    appState.loading = { active: true, msg };
    return new Promise((res) => requestAnimationFrame(() => setTimeout(res, 30)));
  }

  hideLoading(): void {
    appState.loading = { active: false, msg: '' };
  }

  toast(msg: string, ms = 3200): void {
    appState.toast = { msg, show: true };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { appState.toast = { ...appState.toast, show: false }; }, ms);
  }

  /* ---------- Apertura di un Dem nella scena ---------- */

  async openDem(dem: Dem): Promise<void> {
    await this.showLoading('Costruzione del terreno…');
    this.points.clear();
    appState.tracks = [];
    appState.selectedTrackId = null;
    appState.drawingTrackId = null;
    appState.dem = dem;
    this.projectDem = null;
    try {
      this.rebuildTerrainProject();
    } catch (err) {
      this.hideLoading();
      console.error(err);
      this.toast('Impossibile costruire il terreno: memoria insufficiente. Riduci l\'area o aumenta il passo.');
      return;
    }
    this.renderDemInfo(dem);
    this.rebuildTracks();
    this.fitView(false);
    this.setTool(appState.tool);
    this.hideLoading();
    appState.welcomeOpen = false;
    appState.cropOpen = false;
    const millions = (dem.w * dem.h / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 });
    this.toast(`Terreno aperto: ${millions} milioni di celle`);
  }

  private renderDemInfo(dem: Dem): void {
    const { W, D } = extent(dem, appState.exag);
    const rows: DemInfoRow[] = [
      { label: 'Nome', value: dem.name },
      { label: 'Celle', value: `${dem.w.toLocaleString('it-IT')} × ${dem.h.toLocaleString('it-IT')}` },
      { label: 'Passo', value: `${fmt(dem.cell, 2)} m` },
      { label: 'Estensione', value: `${fmt(W / 1000, 2)} × ${fmt(D / 1000, 2)} km` },
      { label: 'Quota min', value: `${fmt(dem.zmin, 1)} m` },
      { label: 'Quota max', value: `${fmt(dem.zmax, 1)} m` },
      { label: 'Sistema', value: dem.epsg ? `EPSG:${dem.epsg}` : 'non indicato' },
    ];
    if (dem.filled) rows.push({ label: 'Celle riempite', value: dem.filled.toLocaleString('it-IT') });
    appState.demInfo = rows;
  }

  /* ---------- Import GeoTIFF + ritaglio ---------- */

  async openFile(file: File): Promise<void> {
    await this.showLoading('Lettura del file…');
    try {
      this.geo = await loadGeoTiffSource(file);
      this.hideLoading();
      this.geo.warnings.forEach((w) => this.toast(w));
      this.openCropDialog();
    } catch (err) {
      this.hideLoading();
      console.error(err);
      this.toast((err as Error).message || 'File non leggibile.', 6000);
    }
  }

  private openCropDialog(): void {
    if (!this.geo) return;
    this.hillshade = buildHillshadePreview(this.geo);
    this.cropSel = { x0: 0, y0: 0, x1: this.geo.preview.w, y1: this.geo.preview.h };
    appState.welcomeOpen = false;
    appState.cropOpen = true;
  }

  get cropPreviewSize(): { w: number; h: number } {
    return this.geo ? { w: this.geo.preview.w, h: this.geo.preview.h } : { w: 0, h: 0 };
  }

  get sourceResX(): number {
    return this.geo?.resX ?? 1;
  }

  useAllCrop(): CropSelection {
    const { w, h } = this.cropPreviewSize;
    this.cropSel = { x0: 0, y0: 0, x1: w, y1: h };
    return this.cropSel;
  }

  suggestFactor(sel: CropSelection): number {
    const [x0, y0, x1, y1] = pixelsFromSelection(this.geo!, sel);
    return suggestCropFactor((x1 - x0) * (y1 - y0), this.cropFactors);
  }

  cropInfo(sel: CropSelection, factor: number): { text: string; warning: string; canLoad: boolean } {
    if (!this.geo || !this.hillshade) return { text: '', warning: '', canLoad: false };
    const [x0, y0, x1, y1] = pixelsFromSelection(this.geo, sel);
    const w = Math.ceil((x1 - x0) / factor), h = Math.ceil((y1 - y0) / factor);
    const n = w * h;
    const km = (v: number) => fmt(v / 1000, 2);
    let text = `Area ${km((x1 - x0) * this.geo.resX)} × ${km((y1 - y0) * this.geo.resX)} km · `
      + `${(n / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} milioni di celle · `
      + `quote ${fmt(this.hillshade.zRange[0], 0)}–${fmt(this.hillshade.zRange[1], 0)} m`;
    if (this.geo.epsg) text += ` · EPSG:${this.geo.epsg}`;
    const warning = n > CROP_WARN_MAX_CELLS ? 'Area molto grande: potrebbe essere lenta. Riduci l\'area o aumenta il passo.' : '';
    return { text, warning, canLoad: w >= 2 && h >= 2 };
  }

  cancelCrop(): void {
    appState.cropOpen = false;
    if (!appState.dem) appState.welcomeOpen = true;
  }

  async loadCrop(sel: CropSelection, factor: number): Promise<void> {
    if (!this.geo) return;
    const [x0, y0, x1, y1] = pixelsFromSelection(this.geo, sel);
    await this.showLoading('Lettura dell\'area di lavoro…');
    try {
      const dem = await readCroppedDem(this.geo, x0, y0, x1, y1, factor);
      this.hideLoading();
      await this.openDem(dem);
    } catch (err) {
      this.hideLoading();
      console.error(err);
      this.toast((err as Error).message || 'Lettura non riuscita.', 6000);
    }
  }

  /* ---------- Terreno di esempio ---------- */

  async openDemo(): Promise<void> {
    try {
      await this.showLoading('Generazione del terreno di esempio…');
      const nav = navigator as Navigator & { deviceMemory?: number };
      const light = matchMedia('(max-width: 900px)').matches || (!!nav.deviceMemory && nav.deviceMemory <= 4);
      const dem = await generateSyntheticDem({
        light,
        onProgress: (pct) => {
          appState.loading = { active: true, msg: `Generazione del terreno di esempio… ${pct} %` };
          return new Promise((res) => setTimeout(res, 0));
        },
      });
      this.hideLoading();
      await this.openDem(dem);
      this.toast(`Terreno sintetico con passo ${dem.cell} m, 1,2 × 1,0 km: le coordinate sono locali.`);
    } catch (err) {
      this.hideLoading();
      console.error(err);
      this.toast(`Terreno di esempio non creato: ${(err as Error).message}`, 7000);
    }
  }

  /* ---------- Barra di stato ---------- */

  private updateStatus(p: PickResult | null): void {
    const dem = this.displayDem;
    if (!p || !dem) {
      appState.statusE = appState.statusN = appState.statusZ = appState.statusSlope = '—';
      return;
    }
    const zr = heightAt(dem, p.x, p.z);
    const sl = slopeAt(dem, p.x, p.z);
    appState.statusE = fmt(dem.e0 + p.x, 1);
    appState.statusN = fmt(dem.n0 - p.z, 1);
    appState.statusZ = `${fmt(zr, 2)} m`;
    appState.statusSlope = `${fmt(sl * 100, 1)} % · ${fmt((Math.atan(sl) * 180) / Math.PI, 1)}°`;
  }

  /* ---------- Input canvas e tastiera ---------- */

  private updateTrackHover(): void {
    if (appState.tool === 'track' && appState.selectedTrackId !== null && appState.drawingTrackId === null && this.lastMove) {
      this.hoverVertexIndex = this.tracks.hitTestVertex(
        appState.selectedTrackId, this.lastMove.clientX, this.lastMove.clientY, TRACK_VERTEX_HIT_PX,
      );
      this.ctx.controls.suspended = this.hoverVertexIndex !== null;
    } else {
      this.hoverVertexIndex = null;
      this.ctx.controls.suspended = false;
    }
  }

  private wireCanvasInput(): void {
    const cv = this.ctx.renderer.domElement;
    cv.addEventListener('pointermove', (e: PointerEvent) => {
      this.lastMove = e;
      const dragDem = this.displayDem;
      if (this.draggingVertex && dragDem) {
        const p = pick(this.ctx, dragDem, appState.exag, e.clientX, e.clientY);
        if (p) {
          const sp = this.snapXZ(p.x, p.z, e.altKey);
          const track = appState.tracks.find((t) => t.id === this.draggingVertex!.trackId);
          if (track) {
            track.vertices[this.draggingVertex!.index] = { x: sp.x, z: sp.z };
            this.rebuildTracks();
          }
        }
        return;
      }
      if (this.hoverReq === null) {
        this.hoverReq = requestAnimationFrame(() => {
          this.hoverReq = null;
          const hoverDem = this.displayDem;
          if (this.lastMove?.pointerType === 'mouse' && hoverDem) {
            this.updateStatus(pick(this.ctx, hoverDem, appState.exag, this.lastMove.clientX, this.lastMove.clientY));
            this.updateTrackHover();
          }
        });
      }
    });
    // Ascoltatore in fase di cattura su window: i listener registrati direttamente sul canvas
    // (incluso quello pointerdown di OrbitLite) scattano tutti nella stessa fase "at target",
    // nell'ordine di registrazione, a prescindere dal flag capture — quindi per anticipare
    // davvero OrbitLite bisogna intercettare più in alto, su un antenato del canvas.
    window.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.target !== cv) return;
      if (appState.tool === 'track' && appState.drawingTrackId === null && appState.selectedTrackId !== null) {
        const idx = this.tracks.hitTestVertex(appState.selectedTrackId, e.clientX, e.clientY, TRACK_VERTEX_HIT_PX);
        if (idx !== null) {
          this.ctx.controls.suspended = true;
          this.draggingVertex = { trackId: appState.selectedTrackId, index: idx };
          try { cv.setPointerCapture(e.pointerId); } catch { /* ignora: capture non disponibile */ }
        }
      }
    }, { capture: true });
    cv.addEventListener('pointerdown', (e: PointerEvent) => {
      this.down = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointerup', (e: PointerEvent) => {
      if (this.draggingVertex) {
        this.draggingVertex = null;
        this.ctx.controls.suspended = false;
        try { cv.releasePointerCapture(e.pointerId); } catch { /* ignora */ }
        this.down = null;
        this.rebuildTerrainProject();
        this.rebuildTracks();
        return;
      }
      const clickDem = this.displayDem;
      if (!this.down || !clickDem) return;
      const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6;
      this.down = null;
      if (moved) return;
      if (e.button === 2) {
        if (appState.tool === 'track' && appState.drawingTrackId !== null) this.undoLastVertex();
        return;
      }
      if (e.button !== 0) return;
      const p = pick(this.ctx, clickDem, appState.exag, e.clientX, e.clientY);
      this.updateStatus(p);
      if (!p) return;
      if (appState.tool === 'point') this.points.add(clickDem, appState.exag, p.x, p.z);
      else if (appState.tool === 'track') this.handleTrackClick(p, e.altKey);
      else if (appState.tool === 'inspect') this.inspectClick(p);
    });
  }

  private wireKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('input,select,textarea')) return;
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (e.shiftKey) this.keys.shift = true;
      if (k === 'p') this.fitView(true);
      else if (k === 'v') this.fitView(false);
      else if (k === 'f') this.fitView(false);
      else if (k === 'i') this.setTool('inspect');
      else if (k === 'q') this.setTool('point');
      else if (k === 't') this.setTool('track');
      else if (k === 'g') this.toggleGrid();
      else if (k === 'c') this.toggleContour();
      else if (k === 'enter') { if (appState.drawingTrackId !== null) this.finishTrackDraw(); }
      else if (k === 'escape') { if (appState.drawingTrackId !== null) this.cancelTrackDraw(); else this.setTool('inspect'); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
      if (!e.shiftKey) this.keys.shift = false;
    });
    window.addEventListener('blur', () => { for (const k in this.keys) this.keys[k] = false; });
  }

  private startLoop(): void {
    this.ctx.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      moveWasd(this.ctx, this.displayDem, appState.exag, this.keys, dt);
      this.ctx.controls.update();
      this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
      if (appState.points.length) {
        this.points.scalePins();
        this.points.updateLabels();
      }
      if (appState.selectedTrackId !== null) this.tracks.updateLabels();
    });
  }
}
