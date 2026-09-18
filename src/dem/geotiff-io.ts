import { fromArrayBuffer, type GeoTIFFImage } from 'geotiff';
import type { Dem } from '../core/types';
import { CROP_PREVIEW_MAX_PX, CROP_SUGGEST_MAX_CELLS, VALID_Z_MAX, VALID_Z_MIN } from '../core/config';
import { finishDem } from './dem';

export interface GeoTiffPreview {
  w: number;
  h: number;
  z: Float32Array | Float64Array | Int16Array | Uint16Array | Int32Array;
}

export interface GeoTiffSource {
  image: GeoTIFFImage;
  W: number;
  H: number;
  resX: number;
  origin: number[];
  nodata: number | null;
  epsg: number | null;
  name: string;
  preview: GeoTiffPreview;
  /** Avvertenze non bloccanti da mostrare in un toast, raccolte durante la lettura. */
  warnings: string[];
}

/** Legge il file GeoTIFF e prepara un'anteprima a bassa risoluzione per il ritaglio. */
export async function loadGeoTiffSource(file: File): Promise<GeoTiffSource> {
  const buf = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const W = image.getWidth();
  const H = image.getHeight();
  const warnings: string[] = [];

  let res: number[];
  let origin: number[];
  try {
    res = image.getResolution();
    origin = image.getOrigin();
  } catch {
    throw new Error('Il file non contiene la georeferenziazione. Serve un GeoTIFF georeferenziato.');
  }
  const resX = Math.abs(res[0]);
  const resY = Math.abs(res[1]);
  if (resX < 0.01) {
    throw new Error('Il DTM è in coordinate geografiche (gradi). Serve un DTM proiettato in metri, ad esempio UTM.');
  }
  if (Math.abs(resX - resY) / resX > 0.02) warnings.push('Celle non quadrate: uso il passo in direzione E–O.');

  const nd = image.getGDALNoData();
  const gk = image.getGeoKeys ? image.getGeoKeys() : null;
  const epsg = (gk && (gk as Record<string, number>).ProjectedCSTypeGeoKey) || null;
  if (image.getSamplesPerPixel() > 1) warnings.push('Il file ha più bande: uso la prima.');

  const pf = Math.max(W, H) / CROP_PREVIEW_MAX_PX;
  const pw = Math.max(2, Math.round(W / Math.max(pf, 1)));
  const ph = Math.max(2, Math.round(H / Math.max(pf, 1)));
  const rp = await image.readRasters({ samples: [0], width: pw, height: ph, resampleMethod: 'nearest' });
  const preview: GeoTiffPreview = { w: pw, h: ph, z: (rp as unknown as (typeof rp)[0][])[0] as GeoTiffPreview['z'] };

  return {
    image,
    W,
    H,
    resX,
    origin,
    nodata: nd === null || nd === undefined ? null : +nd,
    epsg: epsg ?? null,
    name: file.name.replace(/\.tiff?$/i, ''),
    preview,
    warnings,
  };
}

function isValidZ(v: number, nodata: number | null): boolean {
  return Number.isFinite(v) && !(nodata !== null && Math.abs(v - nodata) < 1e-6) && v > VALID_Z_MIN && v < VALID_Z_MAX;
}

export interface HillshadePreview {
  image: ImageData;
  zRange: [number, number];
}

/** Costruisce l'anteprima con hillshade usata come sfondo del riquadro di ritaglio. */
export function buildHillshadePreview(src: GeoTiffSource): HillshadePreview {
  const p = src.preview;
  const cellP = (src.resX * src.W) / p.w;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of p.z) if (isValidZ(v, src.nodata)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const Z = (c: number, r: number): number => {
    c = Math.min(Math.max(c, 0), p.w - 1);
    r = Math.min(Math.max(r, 0), p.h - 1);
    const v = p.z[r * p.w + c];
    return isValidZ(v, src.nodata) ? v : mn;
  };
  const L = [-0.5, -0.6, 0.62];
  const ll = Math.hypot(...L);
  const img = new ImageData(p.w, p.h);
  for (let r = 0; r < p.h; r++) {
    for (let c = 0; c < p.w; c++) {
      const i = (r * p.w + c) * 4;
      const v = p.z[r * p.w + c];
      if (!isValidZ(v, src.nodata)) {
        img.data[i] = 40; img.data[i + 1] = 40; img.data[i + 2] = 48; img.data[i + 3] = 255;
        continue;
      }
      const gx = (Z(c + 1, r) - Z(c - 1, r)) / (2 * cellP);
      const gy = (Z(c, r + 1) - Z(c, r - 1)) / (2 * cellP);
      const nl = Math.hypot(gx, gy, 1);
      const sh = Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / (nl * ll));
      const t = (v - mn) / Math.max(mx - mn, 1);
      const base = [150 + t * 80, 165 + t * 55, 130 + t * 70];
      const k = 0.35 + 0.75 * sh;
      img.data[i] = Math.min(255, base[0] * k);
      img.data[i + 1] = Math.min(255, base[1] * k);
      img.data[i + 2] = Math.min(255, base[2] * k);
      img.data[i + 3] = 255;
    }
  }
  return { image: img, zRange: [mn, mx] };
}

export interface CropSelection { x0: number; y0: number; x1: number; y1: number }

/** Converte la selezione (in pixel di anteprima) in pixel dell'immagine originale. */
export function pixelsFromSelection(src: GeoTiffSource, sel: CropSelection): [number, number, number, number] {
  const p = src.preview;
  const kx = src.W / p.w;
  const ky = src.H / p.h;
  const x0 = Math.floor(Math.min(sel.x0, sel.x1) * kx);
  const x1 = Math.ceil(Math.max(sel.x0, sel.x1) * kx);
  const y0 = Math.floor(Math.min(sel.y0, sel.y1) * ky);
  const y1 = Math.ceil(Math.max(sel.y0, sel.y1) * ky);
  return [Math.max(0, x0), Math.max(0, y0), Math.min(src.W, x1), Math.min(src.H, y1)];
}

/** Suggerisce il passo di ricampionamento più fine che resta sotto la soglia di celle. */
export function suggestCropFactor(pixelCount: number, factors: readonly number[]): number {
  let f = factors[0];
  for (const c of factors) {
    f = c;
    if (pixelCount / (c * c) <= CROP_SUGGEST_MAX_CELLS) break;
  }
  return f;
}

/** Legge l'area ritagliata alla risoluzione scelta e produce il Dem pronto per la scena. */
export async function readCroppedDem(
  src: GeoTiffSource,
  x0: number, y0: number, x1: number, y1: number,
  factor: number,
): Promise<Dem> {
  const w = Math.max(2, Math.ceil((x1 - x0) / factor));
  const h = Math.max(2, Math.ceil((y1 - y0) / factor));
  const rr = await src.image.readRasters({
    samples: [0],
    window: [x0, y0, x1, y1],
    width: w,
    height: h,
    resampleMethod: factor > 1 ? 'bilinear' : 'nearest',
  });
  const raw = (rr as unknown as (Float32Array | Float64Array | Int16Array)[])[0];
  const data = raw instanceof Float32Array ? raw : Float32Array.from(raw as ArrayLike<number>);
  const cellX = ((x1 - x0) * src.resX) / w;
  const e0 = src.origin[0] + x0 * src.resX + cellX / 2;
  const n0 = src.origin[1] - y0 * src.resX - cellX / 2;
  return finishDem(data, w, h, cellX, e0, n0, src.nodata, src.name, src.epsg);
}
