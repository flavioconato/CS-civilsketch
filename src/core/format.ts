export function fmt(v: number, d = 2): string {
  return v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
}
