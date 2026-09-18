import * as THREE from 'three';
import type { Dem, OperaCategoria, Traccia } from '../core/types';
import { sceneY } from './coords';
import { formatChainage, pointAtProgressive, progressives, sampledProgressives, trackLength } from '../core/polyline';
import { livellettaElevation } from '../core/livelletta';
import { muroCrestElevation, MURO_MIN_HEIGHT } from '../core/muro';
import { accumuloMaxReach, accumuloRayAt, accumuloTanPendenza } from '../core/accumulo';
import { heightAt } from '../dem/dem';
import {
  OPERA_CATEGORY_COLORS, TRACK_DESIGN_COLOR, TRACK_NATURAL_COLOR, TRACK_SAMPLE_STEP,
  TRACK_TUBE_RADIUS, TRACK_VERTEX_COLOR, TRACK_VERTEX_RADIUS,
} from '../core/config';
import type { ThreeContext } from './scene';

/** Piccolo scostamento verticale per evitare z-fighting col terreno sottostante. */
const DRAPE_OFFSET = 0.25;

/**
 * Passi trasversali minimo e massimo della mesh dell'accumulo, dallo sbarramento fino alla massima
 * distanza a monte: il passo effettivo si adegua alla portata e al passo del DTM (si veda
 * `buildAccumuloMesh`), per non "scavalcare" un dosso stretto che dovrebbe chiudere la superficie.
 */
const ACCUMULO_D_STEPS_MIN = 8;
const ACCUMULO_D_STEPS_MAX = 160;

interface TrackVisual {
  natural: THREE.Mesh | null;
  design: THREE.Mesh | null;
  wall: THREE.Mesh | null;
  accumulo: THREE.Mesh | null;
  vertexMarkers: THREE.Mesh[];
  labels: HTMLDivElement[];
  labelPositions: THREE.Vector3[];
}

/**
 * Livello visuale delle tracce: tubo drappeggiato sul terreno naturale, tubo di progetto
 * (dalla livelletta), marker dei vertici ed etichette di progressiva (solo per la traccia
 * selezionata, per non affollare la vista). Ricostruito interamente a ogni modifica: il numero
 * di tracce previsto in fase 2 non giustifica un aggiornamento incrementale.
 */
export class TracksLayer {
  private group = new THREE.Group();
  private byId = new Map<number, TrackVisual>();
  private vertexGeo = new THREE.SphereGeometry(TRACK_VERTEX_RADIUS, 14, 10);
  private vertexMat = new THREE.MeshStandardMaterial({ color: TRACK_VERTEX_COLOR, roughness: 0.5 });
  private naturalMat = new THREE.MeshStandardMaterial({ color: TRACK_NATURAL_COLOR, roughness: 0.85 });
  private designMatByCategory = new Map<OperaCategoria | 'default', THREE.MeshStandardMaterial>();
  private wallMatByCategory = new Map<OperaCategoria | 'default', THREE.MeshStandardMaterial>();
  private accumuloMatByType = new Map<'acqua' | 'detrito', THREE.MeshStandardMaterial>();

  constructor(private ctx: ThreeContext, private labelsContainer: HTMLElement) {
    this.ctx.scene.add(this.group);
  }

  /** Colore del tubo di progetto per categoria (§12 SPEC): un materiale condiviso per categoria. */
  private designMaterial(categoria: OperaCategoria | null): THREE.MeshStandardMaterial {
    const key = categoria ?? 'default';
    let mat = this.designMatByCategory.get(key);
    if (!mat) {
      const color = categoria ? OPERA_CATEGORY_COLORS[categoria] : TRACK_DESIGN_COLOR;
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, transparent: true, opacity: 0.85 });
      this.designMatByCategory.set(key, mat);
    }
    return mat;
  }

  /** Materiale opaco per gli oggetti separati (es. muro, §8.3): DoubleSide per non dipendere dal verso delle facce. */
  private wallMaterial(categoria: OperaCategoria | null): THREE.MeshStandardMaterial {
    const key = categoria ?? 'default';
    let mat = this.wallMatByCategory.get(key);
    if (!mat) {
      const color = categoria ? OPERA_CATEGORY_COLORS[categoria] : OPERA_CATEGORY_COLORS.contenimento;
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide });
      this.wallMatByCategory.set(key, mat);
    }
    return mat;
  }

  /** Materiale della superficie di accumulo (§8.2/8.3/8.4): acqua (pelo libero) o detrito, a seconda della pendenza impostata. */
  private accumuloMaterial(pendenzaGradi: number): THREE.MeshStandardMaterial {
    const key = pendenzaGradi < 3 ? 'acqua' : 'detrito';
    let mat = this.accumuloMatByType.get(key);
    if (!mat) {
      const acqua = key === 'acqua';
      mat = new THREE.MeshStandardMaterial({
        color: acqua ? 0x2f7fd1 : 0x8a6a45,
        roughness: acqua ? 0.15 : 0.9,
        metalness: acqua ? 0.15 : 0,
        transparent: true,
        opacity: acqua ? 0.55 : 0.78,
        side: THREE.DoubleSide,
        depthWrite: !acqua,
      });
      this.accumuloMatByType.set(key, mat);
    }
    return mat;
  }

  private disposeVisual(v: TrackVisual): void {
    if (v.natural) { v.natural.geometry.dispose(); this.group.remove(v.natural); }
    if (v.design) { v.design.geometry.dispose(); this.group.remove(v.design); }
    if (v.wall) { v.wall.geometry.dispose(); this.group.remove(v.wall); }
    if (v.accumulo) { v.accumulo.geometry.dispose(); this.group.remove(v.accumulo); }
    v.vertexMarkers.forEach((m) => this.group.remove(m));
    v.labels.forEach((el) => el.remove());
  }

  private sampledS(length: number): number[] {
    return sampledProgressives(length, TRACK_SAMPLE_STEP);
  }

  private buildTube(points: THREE.Vector3[], material: THREE.Material): THREE.Mesh | null {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
    const tubularSegments = Math.max(2, points.length * 2);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, tubularSegments, TRACK_TUBE_RADIUS, 6, false), material);
  }

  /**
   * Oggetto separato (§8.3, es. muro di contenimento): un solido a sezione rettangolare estruso
   * lungo la traccia, aderente al terreno attualmente visibile — non modifica l'heightmap.
   * La sommità è a quota costante (`muroCrestElevation`, pari alla quota minima del terreno
   * lungo la traccia più `altezza`): l'altezza fuori terra vale `altezza` solo nel punto più
   * basso, minore altrove, con un minimo garantito dove il terreno risale sopra la sommità.
   */
  private buildWallMesh(track: Traccia, displayDem: Dem, exag: number): THREE.Mesh | null {
    if (!track.muro || track.vertices.length < 2) return null;
    const length = trackLength(track.vertices);
    const sList = this.sampledS(length);
    const n = sList.length;
    const half = track.muro.spessore / 2;
    const { fondazione } = track.muro;
    const crest = muroCrestElevation(displayDem, track.vertices, track.muro);

    const outerTop: THREE.Vector3[] = [], outerBot: THREE.Vector3[] = [];
    const innerTop: THREE.Vector3[] = [], innerBot: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const s = sList[i];
      const p = pointAtProgressive(track.vertices, s);
      const a = pointAtProgressive(track.vertices, Math.max(0, s - 0.5));
      const b = pointAtProgressive(track.vertices, Math.min(length, s + 0.5));
      let tx = b.x - a.x, tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      const elevHere = heightAt(displayDem, p.x, p.z);
      const topElev = Math.max(crest, elevHere + MURO_MIN_HEIGHT);
      const yTop = (topElev - displayDem.zmin) * exag;
      const yBot = (elevHere - fondazione - displayDem.zmin) * exag;
      outerTop.push(new THREE.Vector3(p.x + nx * half, yTop, p.z + nz * half));
      outerBot.push(new THREE.Vector3(p.x + nx * half, yBot, p.z + nz * half));
      innerTop.push(new THREE.Vector3(p.x - nx * half, yTop, p.z - nz * half));
      innerBot.push(new THREE.Vector3(p.x - nx * half, yBot, p.z - nz * half));
    }

    const verts = [...outerTop, ...outerBot, ...innerTop, ...innerBot];
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; });
    const oT = (i: number) => i, oB = (i: number) => n + i, iT = (i: number) => 2 * n + i, iB = (i: number) => 3 * n + i;
    const idx: number[] = [];
    const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
    for (let i = 0; i < n - 1; i++) {
      quad(oT(i), oB(i), oB(i + 1), oT(i + 1));
      quad(iB(i), iT(i), iT(i + 1), iB(i + 1));
      quad(oT(i), oT(i + 1), iT(i + 1), iT(i));
      quad(oB(i + 1), oB(i), iB(i), iB(i + 1));
    }
    quad(oT(0), iT(0), iB(0), oB(0));
    quad(oT(n - 1), oB(n - 1), iB(n - 1), iT(n - 1));

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, this.wallMaterial(track.categoria));
  }

  /**
   * Superficie di accumulo a monte di uno sbarramento (§8.2/8.3/8.4): parte dalla quota di
   * sommità (contro lo sbarramento) e **risale** verso monte con la pendenza impostata (0° = acqua,
   * piatta; maggiore = detrito). Risale, non scende: il detrito, potendo mantenere una pendenza
   * propria a differenza dell'acqua, riesce a inseguire la risalita del terreno molto più a lungo di
   * un pelo libero piatto, trattenendone di più (si veda `computeAccumulo` per il dettaglio fisico).
   * Esattamente come la sezione di scavo/riporto viene tagliata dove incontra il terreno (§7), ogni
   * fascia trasversale marcia verso monte e si taglia alla prima intersezione con il terreno
   * naturale: i vertici oltre quel punto collassano tutti sul punto di taglio stesso (area nulla,
   * non visibile), invece di proseguire adagiati sul terreno fino in fondo — il che lascerebbe
   * comunque un velo colorato (per quanto piatto) esteso ben oltre l'accumulo vero, come se si
   * "proiettasse" all'infinito.
   */
  private buildAccumuloMesh(track: Traccia, displayDem: Dem, exag: number): THREE.Mesh | null {
    if (!track.muro?.accumulo.attivo || track.vertices.length < 2) return null;
    const muro = track.muro;
    const length = trackLength(track.vertices);
    const sList = this.sampledS(length);
    const n = sList.length;
    const crest = muroCrestElevation(displayDem, track.vertices, muro);
    const tanP = accumuloTanPendenza(muro);
    const maxReach = accumuloMaxReach();
    const lato = muro.accumulo.lato;
    // Passo trasversale legato al passo del DTM: con una portata ampia (tipico dell'acqua) un
    // numero fisso di passi rischierebbe di scavalcare un dosso stretto senza mai campionarlo,
    // mancando così il taglio che dovrebbe fermare la superficie.
    const dSteps = Math.max(ACCUMULO_D_STEPS_MIN, Math.min(ACCUMULO_D_STEPS_MAX, Math.ceil(maxReach / displayDem.cell)));

    const pos: number[] = [];
    let anyAccumulo = false;
    for (let i = 0; i < n; i++) {
      const { px, pz, nx, nz } = accumuloRayAt(track.vertices, length, sList[i], lato);
      let cut: [number, number, number] | null = null;
      for (let j = 0; j <= dSteps; j++) {
        const d = (maxReach * j) / dSteps;
        const x = px + nx * d, z = pz + nz * d;
        if (cut) { pos.push(...cut); continue; }
        const terrainZ = heightAt(displayDem, x, z);
        const surface = crest + tanP * d;
        if (surface > terrainZ) {
          anyAccumulo = true;
          pos.push(x, (surface - displayDem.zmin) * exag, z);
        } else {
          cut = [x, (terrainZ - displayDem.zmin) * exag, z];
          pos.push(...cut);
        }
      }
    }
    if (!anyAccumulo) return null;

    const idx: number[] = [];
    const at = (i: number, j: number) => i * (dSteps + 1) + j;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < dSteps; j++) {
        idx.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, this.accumuloMaterial(muro.accumulo.pendenzaGradi));
  }

  rebuild(naturalDem: Dem, displayDem: Dem, exag: number, tracks: Traccia[], selectedId: number | null): void {
    for (const v of this.byId.values()) this.disposeVisual(v);
    this.byId.clear();

    for (const track of tracks) {
      const visual: TrackVisual = { natural: null, design: null, wall: null, accumulo: null, vertexMarkers: [], labels: [], labelPositions: [] };

      if (track.vertices.length >= 2) {
        const length = trackLength(track.vertices);
        const sList = this.sampledS(length);

        const naturalPts = sList.map((s) => {
          const p = pointAtProgressive(track.vertices, s);
          return new THREE.Vector3(p.x, sceneY(naturalDem, exag, p.x, p.z) + DRAPE_OFFSET, p.z);
        });
        visual.natural = this.buildTube(naturalPts, this.naturalMat);
        if (visual.natural) this.group.add(visual.natural);

        if (track.kind === 'oggetto') {
          visual.wall = this.buildWallMesh(track, displayDem, exag);
          if (visual.wall) this.group.add(visual.wall);
          visual.accumulo = this.buildAccumuloMesh(track, displayDem, exag);
          if (visual.accumulo) this.group.add(visual.accumulo);
        } else {
          const designPts = sList.map((s) => {
            const p = pointAtProgressive(track.vertices, s);
            const z = livellettaElevation(track.livelletta, s, length);
            return new THREE.Vector3(p.x, (z - naturalDem.zmin) * exag + DRAPE_OFFSET, p.z);
          });
          visual.design = this.buildTube(designPts, this.designMaterial(track.categoria));
          if (visual.design) this.group.add(visual.design);
        }
      }

      if (track.id === selectedId) {
        const prog = progressives(track.vertices);
        track.vertices.forEach((vtx, i) => {
          const y = sceneY(naturalDem, exag, vtx.x, vtx.z) + DRAPE_OFFSET;
          const mesh = new THREE.Mesh(this.vertexGeo, this.vertexMat);
          mesh.position.set(vtx.x, y, vtx.z);
          this.group.add(mesh);
          visual.vertexMarkers.push(mesh);

          const el = document.createElement('div');
          el.className = 'label';
          el.textContent = formatChainage(prog[i] ?? 0);
          this.labelsContainer.appendChild(el);
          visual.labels.push(el);
          visual.labelPositions.push(new THREE.Vector3(vtx.x, y, vtx.z));
        });
      }

      this.byId.set(track.id, visual);
    }
  }

  updateLabels(): void {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const tmp = new THREE.Vector3();
    for (const visual of this.byId.values()) {
      visual.labels.forEach((el, i) => {
        tmp.copy(visual.labelPositions[i]).project(this.ctx.camera);
        const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
        el.style.display = vis ? '' : 'none';
        if (vis) {
          el.style.left = `${rect.left + ((tmp.x + 1) / 2) * rect.width}px`;
          el.style.top = `${rect.top + ((1 - tmp.y) / 2) * rect.height}px`;
        }
      });
    }
  }

  /** Indice del vertice della traccia più vicino al punto schermo, entro la soglia in pixel, o null. */
  hitTestVertex(trackId: number, clientX: number, clientY: number, thresholdPx: number): number | null {
    const visual = this.byId.get(trackId);
    if (!visual || !visual.vertexMarkers.length) return null;
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    const tmp = new THREE.Vector3();
    let best: number | null = null;
    let bestDist = thresholdPx;
    visual.vertexMarkers.forEach((mesh, i) => {
      tmp.copy(mesh.position).project(this.ctx.camera);
      if (tmp.z >= 1) return;
      const sx = rect.left + ((tmp.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - tmp.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }
}
