import * as THREE from 'three';

interface PointerState { x: number; y: number }

/**
 * Controlli orbit/pan/zoom leggeri, stile visualizzatore 3D: trascinamento per ruotare,
 * tasto destro/tasto centrale/Ctrl/Shift o due dita per spostare, rotella o pinch per zoomare.
 */
export class OrbitLite {
  cam: THREE.PerspectiveCamera;
  dom: HTMLElement;
  target = new THREE.Vector3();
  damping = 0.15;
  maxPolarAngle = Math.PI / 2 - 0.03;
  minPolarAngle = 0.02;
  minDistance = 1;
  maxDistance = Infinity;

  sph = new THREE.Spherical();
  dTheta = 0;
  dPhi = 0;
  pan = new THREE.Vector3();
  ptrs = new Map<number, PointerState>();
  mode: 'rotate' | 'pan' | 'two' | null = null;
  pinch = 0;
  /** Quando true, ignora i pointerdown: usato per lasciare il click al trascinamento di un vertice di traccia. */
  suspended = false;

  constructor(cam: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.cam = cam;
    this.dom = dom;
    this.setFromCamera();
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    const up = (e: PointerEvent) => this.onUp(e);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('lostpointercapture', up);
    dom.addEventListener(
      'wheel',
      (e) => { e.preventDefault(); this.zoom(Math.pow(0.92, -Math.sign(e.deltaY))); },
      { passive: false },
    );
  }

  setFromCamera(): void {
    this.sph.setFromVector3(new THREE.Vector3().subVectors(this.cam.position, this.target));
  }

  zoom(f: number): void {
    this.sph.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this.sph.radius * f));
  }

  private two(): PointerState[] {
    return [...this.ptrs.values()];
  }

  private dist2(): number {
    const [a, b] = this.two();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private mid(): PointerState {
    const [a, b] = this.two();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private onDown(e: PointerEvent): void {
    if (this.suspended) return;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* ignora: capture non disponibile */ }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 1) this.mode = (e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey) ? 'pan' : 'rotate';
    else if (this.ptrs.size === 2) { this.mode = 'two'; this.pinch = this.dist2(); }
  }

  private onMove(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const h = this.dom.clientHeight || 1;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (this.mode === 'two') {
      const c0 = this.mid();
      p.x = e.clientX; p.y = e.clientY;
      const d = this.dist2();
      if (this.pinch > 0 && d > 0) this.zoom(this.pinch / d);
      this.pinch = d;
      const c1 = this.mid();
      this.panBy(c1.x - c0.x, c1.y - c0.y);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (this.mode === 'rotate') { this.dTheta -= (2 * Math.PI * dx) / h; this.dPhi -= (2 * Math.PI * dy) / h; }
    else if (this.mode === 'pan') this.panBy(dx, dy);
  }

  private panBy(dx: number, dy: number): void {
    const h = this.dom.clientHeight || 1;
    const k = (this.sph.radius * 2 * Math.tan((this.cam.fov * Math.PI) / 360)) / h;
    const m = this.cam.matrix.elements;
    this.pan
      .add(new THREE.Vector3(m[0], m[1], m[2]).multiplyScalar(-dx * k))
      .add(new THREE.Vector3(m[4], m[5], m[6]).multiplyScalar(dy * k));
  }

  private onUp(e: PointerEvent): void {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = 0;
    this.mode = this.ptrs.size === 0 ? null : this.ptrs.size === 2 ? 'two' : 'rotate';
  }

  update(): void {
    const d = this.damping;
    this.sph.theta += this.dTheta * d;
    this.sph.phi += this.dPhi * d;
    this.sph.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.sph.phi));
    this.target.addScaledVector(this.pan, d);
    this.dTheta *= 1 - d; this.dPhi *= 1 - d; this.pan.multiplyScalar(1 - d);
    this.cam.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(this.sph));
    this.cam.lookAt(this.target);
  }
}
