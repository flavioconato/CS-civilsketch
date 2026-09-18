import type { OperaCategoria, SezionePunto, SezioneTipo } from './types';
import { trapezioPunti } from './terrainOps';

/**
 * Preset di sezione riusabile (§8 SPEC: "valori di default salvati come preset che l'utente può
 * modificare e riusare"). Non contiene alcuna quota o progressiva: solo la forma del profilo
 * trasversale, applicabile a qualunque traccia.
 */
export interface OperaPreset {
  id: number;
  nome: string;
  categoria: OperaCategoria;
  tipo: SezioneTipo;
  punti: SezionePunto[];
}

/**
 * Preset di partenza: valori segnaposto, non normativi, pensati solo per far vedere come si
 * imposta un profilo. Vanno adattati agli standard dell'utente (§8 SPEC).
 */
export function defaultPresets(): OperaPreset[] {
  return [
    { id: -1, nome: 'Canale trapezio', categoria: 'idraulica', tipo: 'canale', punti: trapezioPunti('canale', 2, 1.5) },
    { id: -2, nome: 'Rilevato ferroviario', categoria: 'ferrovia', tipo: 'rilevato', punti: trapezioPunti('rilevato', 9, 1.5) },
    { id: -3, nome: 'Trincea ferroviaria', categoria: 'ferrovia', tipo: 'canale', punti: trapezioPunti('canale', 9, 1.5) },
    { id: -4, nome: 'Muro di contenimento', categoria: 'contenimento', tipo: 'rilevato', punti: trapezioPunti('rilevato', 0.5, 0.15) },
  ];
}
