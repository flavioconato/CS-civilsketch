import { fromArrayBuffer } from 'geotiff';
import { ORTOFOTO_MAX_PX } from '../core/config';

/** Ortofoto letta da GeoTIFF: RGBA interleaved, pronta per una THREE.DataTexture. */
export interface OrtofotoRaster {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Passo in metri (dopo l'eventuale ricampionamento per stare sotto ORTOFOTO_MAX_PX). */
  resX: number;
  /** Origine reale (angolo del pixel [0,0], stessa convenzione di Dem.e0/n0) in metri. */
  e0: number;
  n0: number;
  epsg: number | null;
  name: string;
}

export interface LocalBounds {
  x0: number;
  z0: number;
  w: number;
  h: number;
}

/**
 * Rettangolo dell'ortofoto in coordinate scena locali, le stesse di `Dem` (x = Est crescente,
 * z = Nord decrescente — si veda `readCroppedDem` in `geotiff-io.ts`, che usa la stessa
 * convenzione per il DTM: `n0 = origin[1] - y0*resX - ...`).
 */
export function ortofotoLocalBounds(
  dem: { e0: number; n0: number },
  photo: { e0: number; n0: number; resX: number; width: number; height: number },
): LocalBounds {
  return {
    x0: photo.e0 - dem.e0,
    z0: dem.n0 - photo.n0,
    w: photo.resX * photo.width,
    h: photo.resX * photo.height,
  };
}

/**
 * Legge un'ortofoto GeoTIFF (RGB o RGBA) per intero, senza ritaglio: a differenza del DTM non
 * serve un dialogo di crop, il fragment shader mostra da solo solo l'area di sovrapposizione col
 * terreno (si veda `three/scene.ts`). Ricampionata se più grande di `ORTOFOTO_MAX_PX` per lato,
 * per restare dentro i limiti pratici di una texture WebGL e della memoria.
 */
export async function loadOrtofoto(file: File): Promise<OrtofotoRaster> {
  const buf = await file.arrayBuffer();
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const W = image.getWidth();
  const H = image.getHeight();

  let res: number[];
  let origin: number[];
  try {
    res = image.getResolution();
    origin = image.getOrigin();
  } catch {
    throw new Error('Il file non contiene la georeferenziazione. Serve un GeoTIFF georeferenziato.');
  }
  const resX = Math.abs(res[0]);
  if (resX < 0.01) {
    throw new Error('L\'ortofoto è in coordinate geografiche (gradi). Serve un file proiettato in metri, nello stesso sistema del DTM.');
  }

  const gk = image.getGeoKeys ? image.getGeoKeys() : null;
  const epsg = (gk && (gk as Record<string, number>).ProjectedCSTypeGeoKey) || null;
  const samples = image.getSamplesPerPixel();

  const factor = Math.max(1, Math.ceil(Math.max(W, H) / ORTOFOTO_MAX_PX));
  const outW = Math.max(1, Math.round(W / factor));
  const outH = Math.max(1, Math.round(H / factor));

  const raw = (await image.readRasters({
    interleave: true,
    width: outW,
    height: outH,
    resampleMethod: factor > 1 ? 'bilinear' : 'nearest',
  })) as unknown as ArrayLike<number>;

  const data = new Uint8ClampedArray(outW * outH * 4);
  if (samples >= 3) {
    for (let i = 0, j = 0; i < outW * outH; i++, j += samples) {
      data[i * 4] = raw[j];
      data[i * 4 + 1] = raw[j + 1];
      data[i * 4 + 2] = raw[j + 2];
      data[i * 4 + 3] = samples >= 4 ? raw[j + 3] : 255;
    }
  } else {
    for (let i = 0; i < outW * outH; i++) {
      const v = raw[i];
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
  }

  return {
    data,
    width: outW,
    height: outH,
    resX: resX * factor,
    e0: origin[0],
    n0: origin[1],
    epsg,
    name: file.name.replace(/\.tiff?$/i, ''),
  };
}
