<script lang="ts">
  import { appState } from '../core/appState.svelte';
  import { fmt } from '../core/format';
  import type { AppController } from '../app/controller';
  import type { CropSelection } from '../dem/geotiff-io';

  let { controller }: { controller: AppController } = $props();

  let canvasEl: HTMLCanvasElement | null = null;
  let sel = $state<CropSelection>({ x0: 0, y0: 0, x1: 0, y1: 0 });
  let factor = $state(1);
  let dragging = false;

  const info = $derived(controller.cropInfo(sel, factor));

  function draw(): void {
    if (!canvasEl || !controller.hillshade) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(controller.hillshade.image, 0, 0);
    const x = Math.min(sel.x0, sel.x1), y = Math.min(sel.y0, sel.y1);
    const w = Math.abs(sel.x1 - sel.x0), h = Math.abs(sel.y1 - sel.y0);
    ctx.fillStyle = 'rgba(10,20,30,.45)';
    ctx.fillRect(0, 0, canvasEl.width, y);
    ctx.fillRect(0, y + h, canvasEl.width, canvasEl.height - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvasEl.width - x - w, h);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.setLineDash([]);
  }

  function initCrop(node: HTMLCanvasElement) {
    canvasEl = node;
    const { w, h } = controller.cropPreviewSize;
    node.width = w; node.height = h;
    sel = controller.useAllCrop();
    factor = controller.suggestFactor(sel);
    draw();
    return { destroy() { canvasEl = null; } };
  }

  function pointFromEvent(e: PointerEvent): { x: number; y: number } {
    const r = canvasEl!.getBoundingClientRect();
    const x = Math.min(Math.max(((e.clientX - r.left) / r.width) * canvasEl!.width, 0), canvasEl!.width);
    const y = Math.min(Math.max(((e.clientY - r.top) / r.height) * canvasEl!.height, 0), canvasEl!.height);
    return { x, y };
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    canvasEl!.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    sel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    draw();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const p = pointFromEvent(e);
    sel = { ...sel, x1: p.x, y1: p.y };
    draw();
  }

  function onPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(sel.x1 - sel.x0) < 4 || Math.abs(sel.y1 - sel.y0) < 4) {
      sel = controller.useAllCrop();
      draw();
    }
    factor = controller.suggestFactor(sel);
  }

  function useAll(): void {
    sel = controller.useAllCrop();
    draw();
  }

  function factorLabel(f: number): string {
    const mm = controller.sourceResX * f;
    return `${fmt(mm, mm < 10 ? 1 : 0)} m${f === 1 ? ' (originale)' : ''}`;
  }
</script>

{#if appState.cropOpen}
  <div class="overlay" id="crop">
    <div class="card">
      <h1>Area di lavoro</h1>
      <p>Trascina sull'anteprima per scegliere la zona da aprire. Un'area più piccola si carica più velocemente.</p>
      <div id="cropWrap">
        <canvas
          use:initCrop
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
        ></canvas>
      </div>
      <div class="row">
        <span>Passo del terreno</span>
        <select aria-label="Passo del terreno" value={String(factor)} onchange={(e) => { factor = +e.currentTarget.value; }}>
          {#each controller.cropFactors as f}
            <option value={f}>{factorLabel(f)}</option>
          {/each}
        </select>
      </div>
      <div id="cropInfo" class="muted">
        {info.text}
        {#if info.warning}<br><span class="warn">{info.warning}</span>{/if}
      </div>
      <div class="actions" style="margin-top:14px">
        <button class="btn" onclick={useAll}>Usa tutto</button>
        <button class="btn" onclick={() => controller.cancelCrop()}>Annulla</button>
        <button class="btn primary" disabled={!info.canLoad} onclick={() => controller.loadCrop(sel, factor)}>Apri area</button>
      </div>
    </div>
  </div>
{/if}
