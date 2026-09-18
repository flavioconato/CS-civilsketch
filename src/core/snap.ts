export function snapValue(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

export interface Point2D { x: number; z: number }

/** Applica lo snap planimetrico; `bypass` (tasto Alt premuto) lo disattiva temporaneamente. */
export function snapPoint(p: Point2D, step: number, bypass: boolean): Point2D {
  if (bypass || step <= 0) return p;
  return { x: snapValue(p.x, step), z: snapValue(p.z, step) };
}
