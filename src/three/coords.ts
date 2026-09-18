import type { Dem } from '../core/types';
import { heightAt } from '../dem/dem';

/** Quota in coordinate scena (mondo Y), con base a zmin ed esagerazione verticale applicate. */
export function sceneY(dem: Dem, exag: number, x: number, z: number): number {
  return (heightAt(dem, x, z) - dem.zmin) * exag;
}

export interface Extent { W: number; D: number; Y: number }

/** Estensione del terreno in coordinate scena: larghezza (X), profondità (Z), altezza (Y). */
export function extent(dem: Dem, exag: number): Extent {
  return {
    W: (dem.w - 1) * dem.cell,
    D: (dem.h - 1) * dem.cell,
    Y: (dem.zmax - dem.zmin) * exag,
  };
}
