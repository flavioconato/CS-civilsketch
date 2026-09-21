<script lang="ts">
  import type { SezionePunto } from '../core/types';
  import { snapValue } from '../core/snap';
  import { fmt } from '../core/format';
  import InfoButton from './InfoButton.svelte';

  let {
    punti, snapD, snapDz, onChange,
  }: { punti: SezionePunto[]; snapD: number; snapDz: number; onChange: (punti: SezionePunto[]) => void } = $props();

  const W = 380, H = 230, PAD_L = 40, PAD_R = 14, PAD_T = 14, PAD_B = 24;

  /** Copia locale usata per il feedback live durante il trascinamento (evita di ricalcolare il terreno a ogni frame). */
  let local = $state<SezionePunto[]>([]);
  $effect(() => { local = punti.map((p) => ({ ...p })); });

  let dragIndex = $state<number | null>(null);
  let hoverIndex = $state<number | null>(null);
  let cursor = $state<{ d: number; dz: number } | null>(null);
  let svgEl: SVGSVGElement | undefined = $state();

  const dRange = $derived.by(() => {
    const ds = local.map((p) => p.d).concat(0);
    const pad = Math.max(1.5, snapD * 3);
    return [Math.min(...ds) - pad, Math.max(...ds) + pad] as const;
  });
  const dzRange = $derived.by(() => {
    const dzs = local.map((p) => p.dz).concat(0);
    const pad = Math.max(0.5, snapDz * 5);
    return [Math.min(...dzs) - pad, Math.max(...dzs) + pad] as const;
  });

  const toX = (d: number) => PAD_L + ((d - dRange[0]) / (dRange[1] - dRange[0])) * (W - PAD_L - PAD_R);
  const toY = (dz: number) => H - PAD_B - ((dz - dzRange[0]) / (dzRange[1] - dzRange[0])) * (H - PAD_T - PAD_B);
  const fromX = (x: number) => dRange[0] + ((x - PAD_L) / (W - PAD_L - PAD_R)) * (dRange[1] - dRange[0]);
  const fromY = (y: number) => dzRange[0] + ((H - PAD_B - y) / (H - PAD_T - PAD_B)) * (dzRange[1] - dzRange[0]);

  /** Passo "leggibile" per le etichette degli assi: indipendente dal passo di snap, che sarebbe troppo fitto da leggere. */
  function niceStep(span: number, maxTicks = 7): number {
    const raw = span / maxTicks;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const norm = raw / mag;
    const mult = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return mult * mag;
  }

  function ticks(range: readonly [number, number]): number[] {
    const step = niceStep(range[1] - range[0]);
    const start = Math.ceil(range[0] / step) * step;
    const out: number[] = [];
    for (let v = start; v <= range[1] + 1e-9 && out.length < 20; v += step) out.push(Math.round(v * 1000) / 1000);
    return out;
  }
  const dTicks = $derived(ticks(dRange));
  const dzTicks = $derived(ticks(dzRange));

  const pathD = $derived(local.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.d)},${toY(p.dz)}`).join(' '));

  function commit(next: SezionePunto[]): void {
    local = [...next].sort((a, b) => a.d - b.d);
    onChange(local);
  }

  function clientToLocal(ev: PointerEvent): { x: number; y: number } {
    const rect = svgEl!.getBoundingClientRect();
    return { x: ((ev.clientX - rect.left) / rect.width) * W, y: ((ev.clientY - rect.top) / rect.height) * H };
  }

  function onPointDown(ev: PointerEvent, i: number): void {
    ev.stopPropagation();
    dragIndex = i;
    try { (ev.target as Element).setPointerCapture(ev.pointerId); } catch { /* ignora */ }
  }

  function onSvgMove(ev: PointerEvent): void {
    const { x, y } = clientToLocal(ev);
    const d = snapValue(fromX(x), snapD);
    const dz = snapValue(fromY(y), snapDz);
    cursor = { d, dz };
    if (dragIndex !== null) local[dragIndex] = { d, dz };
  }

  function onSvgUp(): void {
    if (dragIndex === null) return;
    dragIndex = null;
    commit(local);
  }

  function onSvgLeave(): void {
    if (dragIndex === null) cursor = null;
  }

  function removePoint(i: number): void {
    if (local.length <= 2) return;
    commit(local.filter((_, idx) => idx !== i));
  }

  function addPoint(): void {
    const last = local[local.length - 1] ?? { d: 0, dz: 0 };
    const step = Math.max(snapD, 0.5);
    commit([...local, { d: last.d + step, dz: last.dz }]);
  }

  function updatePointField(i: number, field: 'd' | 'dz', raw: string): void {
    const v = +raw;
    if (!Number.isFinite(v)) return;
    const snapped = snapValue(v, field === 'd' ? snapD : snapDz);
    commit(local.map((p, idx) => (idx === i ? { ...p, [field]: snapped } : p)));
  }
</script>

<div class="readout" aria-live="polite">
  {#if cursor}
    Distanza dall'asse <b>{fmt(cursor.d, 2)} m</b> · Quota rispetto alla livelletta <b>{fmt(cursor.dz, 2)} m</b>
  {:else}
    Passa il mouse sul grafico per leggere le quote in metri.
  {/if}
  <InfoButton text="Trascina un punto per modellarne la quota. Doppio click su un punto (o la ✕ qui sotto) per eliminarlo, &quot;Aggiungi punto&quot; per crearne uno nuovo." />
</div>

<svg
  bind:this={svgEl}
  viewBox="0 0 {W} {H}" class="section-editor"
  onpointermove={onSvgMove} onpointerup={onSvgUp} onpointercancel={onSvgUp} onpointerleave={onSvgLeave}
  role="img" aria-label="Editor del profilo trasversale, quotato in metri"
>
  {#each dTicks as d}
    <line x1={toX(d)} y1={PAD_T} x2={toX(d)} y2={H - PAD_B} class="grid" />
    <text x={toX(d)} y={H - PAD_B + 14} class="tick" text-anchor="middle">{fmt(d, Math.abs(d) < 10 && d % 1 !== 0 ? 1 : 0)}</text>
  {/each}
  {#each dzTicks as dz}
    <line x1={PAD_L} y1={toY(dz)} x2={W - PAD_R} y2={toY(dz)} class="grid" />
    <text x={PAD_L - 6} y={toY(dz) + 3} class="tick" text-anchor="end">{fmt(dz, Math.abs(dz) < 10 && dz % 1 !== 0 ? 1 : 0)}</text>
  {/each}
  <line x1={toX(0)} y1={PAD_T} x2={toX(0)} y2={H - PAD_B} class="axis" />
  <line x1={PAD_L} y1={toY(0)} x2={W - PAD_R} y2={toY(0)} class="axis" />
  <text x={toX(0) + 4} y={PAD_T + 10} class="axis-label">asse traccia</text>
  <text x={W - PAD_R} y={toY(0) - 5} class="axis-label" text-anchor="end">quota livelletta</text>
  <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} class="dim-label" text-anchor="middle">distanza dall'asse (m)</text>
  <text x={11} y={(PAD_T + H - PAD_B) / 2} class="dim-label" text-anchor="middle" transform={`rotate(-90 11 ${(PAD_T + H - PAD_B) / 2})`}>quota (m)</text>

  {#if cursor}
    <line x1={toX(cursor.d)} y1={PAD_T} x2={toX(cursor.d)} y2={H - PAD_B} class="crosshair" />
    <line x1={PAD_L} y1={toY(cursor.dz)} x2={W - PAD_R} y2={toY(cursor.dz)} class="crosshair" />
  {/if}

  <path d={pathD} class="profile" />
  {#each local as p, i}
    <circle cx={toX(p.d)} cy={toY(p.dz)} r={dragIndex === i || hoverIndex === i ? 8 : 6.5} class="point" class:dragging={dragIndex === i}></circle>
    <circle
      cx={toX(p.d)} cy={toY(p.dz)} r="14" class="hit"
      role="button" tabindex="-1" aria-label={`Punto, distanza ${p.d.toFixed(2)} m, quota ${p.dz.toFixed(2)} m`}
      onpointerdown={(ev) => onPointDown(ev, i)}
      onpointerenter={() => (hoverIndex = i)}
      onpointerleave={() => (hoverIndex = null)}
      ondblclick={() => removePoint(i)}
    ><title>Doppio click per eliminare · d={p.d.toFixed(2)} m, quota={p.dz.toFixed(2)} m</title></circle>
  {/each}
</svg>

<ul class="pts sez-pts">
  <li class="sez-head muted">
    <span>Distanza dall'asse (m) · Quota (m)</span>
  </li>
  {#each local as p, i (i)}
    <li>
      <span>
        <input
          type="number" class="num" style="width:70px" step={snapD || 0.1} aria-label={`Distanza dall'asse in metri, punto ${i + 1}`}
          value={p.d} onchange={(e) => updatePointField(i, 'd', e.currentTarget.value)}
        > m
        <input
          type="number" class="num" style="width:70px" step={snapDz || 0.1} aria-label={`Quota rispetto alla livelletta in metri, punto ${i + 1}`}
          value={p.dz} onchange={(e) => updatePointField(i, 'dz', e.currentTarget.value)}
        > m
      </span>
      <button class="x" aria-label={`Elimina punto ${i + 1}`} disabled={local.length <= 2} onclick={() => removePoint(i)}>✕</button>
    </li>
  {/each}
</ul>
<button class="btn" onclick={addPoint}>Aggiungi punto</button>

<style>
  .readout{font-size:13px;color:var(--muted);min-height:18px;margin-bottom:4px}
  .readout b{color:var(--ink);font-variant-numeric:tabular-nums}
  .section-editor{width:100%;height:230px;background:var(--panel-solid);border:1px solid var(--line);border-radius:8px;touch-action:none;cursor:crosshair}
  .grid{stroke:var(--line);stroke-width:1}
  .axis{stroke:var(--muted);stroke-width:1.3}
  .axis-label{fill:var(--muted);font-size:10px}
  .dim-label{fill:var(--muted);font-size:10px}
  .tick{fill:var(--muted);font-size:9.5px;font-variant-numeric:tabular-nums}
  .crosshair{stroke:var(--accent);stroke-width:1;stroke-dasharray:3 3;opacity:.55;pointer-events:none}
  .profile{fill:none;stroke:var(--accent);stroke-width:2.5}
  .hit{fill:transparent;cursor:grab;touch-action:none}
  .point{fill:var(--accent);stroke:var(--panel-solid);stroke-width:1.5;pointer-events:none}
  .point.dragging{fill:var(--ink)}
  .sez-pts{margin-top:8px}
  .sez-head{padding-top:0 !important;padding-bottom:4px !important}
</style>
