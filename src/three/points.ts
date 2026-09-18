import * as THREE from 'three';
import type { Dem } from '../core/types';
import { heightAt } from '../dem/dem';
import { sceneY } from './coords';
import { appState } from '../core/appState.svelte';
import { fmt } from '../core/format';
import type { ThreeContext } from './scene';

interface Visual { mesh: THREE.Mesh; el: HTMLDivElement }

/**
 * Punti quotati: la parte visuale (mesh three.js + etichetta DOM) vive qui, indicizzata per id;
 * i dati semplici (id, x, z, zr) vivono in appState.points per il pannello "Punti quotati".
 * Tenerle separate evita di far passare oggetti three.js/DOM dal proxy reattivo di Svelte.
 */
export class PointsLayer {
  private visuals = new Map<number, Visual>();
  private pinGeo = new THREE.ConeGeometry(1, 3, 12);
  private pinMat = new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.6 });
  private nextId = 1;
  private tmp = new THREE.Vector3();

  constructor(private ctx: ThreeContext, private labelsContainer: HTMLElement) {
    this.pinGeo.rotateX(Math.PI);
    this.pinGeo.translate(0, 1.5, 0);
  }

  add(dem: Dem, exag: number, x: number, z: number): void {
    const zr = heightAt(dem, x, z);
    const id = this.nextId++;
    const mesh = new THREE.Mesh(this.pinGeo, this.pinMat);
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = `P${id}  ${fmt(zr, 2)} m`;
    this.labelsContainer.appendChild(el);
    this.visuals.set(id, { mesh, el });
    this.ctx.markerGroup.add(mesh);
    appState.points.push({ id, x, z, zr });
    this.placePins(dem, exag);
  }

  remove(id: number): void {
    const v = this.visuals.get(id);
    if (!v) return;
    this.ctx.markerGroup.remove(v.mesh);
    v.el.remove();
    this.visuals.delete(id);
    const i = appState.points.findIndex((p) => p.id === id);
    if (i >= 0) appState.points.splice(i, 1);
  }

  clear(): void {
    [...appState.points].forEach((p) => this.remove(p.id));
  }

  placePins(dem: Dem, exag: number): void {
    for (const p of appState.points) {
      const v = this.visuals.get(p.id);
      if (v) v.mesh.position.set(p.x, sceneY(dem, exag, p.x, p.z), p.z);
    }
    this.scalePins();
  }

  scalePins(): void {
    for (const p of appState.points) {
      const v = this.visuals.get(p.id);
      if (!v) continue;
      const d = this.ctx.camera.position.distanceTo(v.mesh.position);
      v.mesh.scale.setScalar(Math.max(d * 0.009, 0.4));
    }
  }

  updateLabels(): void {
    const rect = this.ctx.renderer.domElement.getBoundingClientRect();
    for (const p of appState.points) {
      const v = this.visuals.get(p.id);
      if (!v) continue;
      this.tmp.set(v.mesh.position.x, v.mesh.position.y + 3.1 * v.mesh.scale.x, v.mesh.position.z).project(this.ctx.camera);
      const vis = this.tmp.z < 1 && Math.abs(this.tmp.x) < 1.05 && Math.abs(this.tmp.y) < 1.05;
      v.el.style.display = vis ? '' : 'none';
      if (vis) {
        v.el.style.left = `${rect.left + ((this.tmp.x + 1) / 2) * rect.width}px`;
        v.el.style.top = `${rect.top + ((1 - this.tmp.y) / 2) * rect.height}px`;
      }
    }
  }
}
