<script lang="ts">
  import { appState } from '../core/appState.svelte';
  import { EXAG_MAX, EXAG_MIN, EXAG_STEP, OPERA_CATEGORY_LABELS, SLOPE_COLORS } from '../core/config';
  import { fmt } from '../core/format';
  import { slopeAt } from '../dem/dem';
  import type { AppController } from '../app/controller';
  import type { SlopeBreaks } from '../core/types';

  let { controller }: { controller: AppController } = $props();

  let exagLive = $state(appState.exag);
  $effect(() => { exagLive = appState.exag; });

  function classLabel(i: number, b: SlopeBreaks): string {
    if (i === 0) return `fino a ${b[0]} %`;
    if (i === 4) return `oltre ${b[3]} %`;
    return `${b[i - 1]} – ${b[i]} %`;
  }

  function onBreakChange(i: number, raw: string): void {
    const v = Math.max(0, +raw || 0);
    const next = [...appState.slopeBreaks] as SlopeBreaks;
    next[i] = v;
    (next as number[]).sort((a, c) => a - c);
    controller.setSlopeBreaks(next);
  }
</script>

<aside id="panel" class:open={appState.panelOpenMobile}>
  <section>
    <h2>Terreno</h2>
    <dl class="kv">
      {#if appState.demInfo.length}
        {#each appState.demInfo as row}
          <dt>{row.label}</dt><dd title={row.value}>{row.value}</dd>
        {/each}
      {:else}
        <dt>Stato</dt><dd>—</dd>
      {/if}
    </dl>
  </section>

  <section>
    <h2>Visualizzazione</h2>
    <div class="row">
      <label><input type="checkbox" checked={appState.showContour} onchange={() => controller.toggleContour()}> Isoipse</label>
      <select aria-label="Equidistanza" value={String(appState.contourStep)} onchange={(e) => controller.setContourStep(+e.currentTarget.value)}>
        <option value="1">1 m</option>
        <option value="2">2 m</option>
        <option value="5">5 m</option>
        <option value="10">10 m</option>
        <option value="25">25 m</option>
      </select>
    </div>
    <div class="row">
      <label>
        <input type="checkbox" checked={appState.showSlope} onchange={(e) => controller.setSlopeMode((e.currentTarget as HTMLInputElement).checked)}>
        Mappa pendenze
      </label>
    </div>
    {#if appState.showSlope}
      <div class="classes">
        {#each appState.slopeBreaks as _, i}
          <span class="swatch" style="background:{SLOPE_COLORS[i]}"></span>
          <span>{classLabel(i, appState.slopeBreaks)}</span>
          <input
            type="number" class="num" min="0" step="1"
            aria-label={`Limite classe ${i + 1} in %`}
            value={appState.slopeBreaks[i]}
            onchange={(e) => onBreakChange(i, e.currentTarget.value)}
          >
        {/each}
        <span class="swatch" style="background:{SLOPE_COLORS[4]}"></span>
        <span>{classLabel(4, appState.slopeBreaks)}</span>
        <span></span>
      </div>
    {/if}
    <div class="row">
      <span>Trasparenza</span>
      <input type="range" min="0.2" max="1" step="0.05" value={appState.opacity}
        oninput={(e) => controller.setOpacity(+e.currentTarget.value)}>
    </div>
    <div class="row">
      <span>Esagerazione verticale <b>{fmt(exagLive, 1)}×</b></span>
      <input type="range" min={EXAG_MIN} max={EXAG_MAX} step={EXAG_STEP} value={exagLive}
        oninput={(e) => { exagLive = +e.currentTarget.value; }}
        onchange={(e) => controller.setExag(+e.currentTarget.value)}>
    </div>
    <div class="row">
      <label><input type="checkbox" checked={appState.showWireframe} onchange={(e) => controller.setWireframe((e.currentTarget as HTMLInputElement).checked)}> Maglia</label>
    </div>
  </section>

  <section>
    <h2>Griglia e snap</h2>
    <div class="row">
      <label><input type="checkbox" checked={appState.gridVisible} onchange={() => controller.toggleGrid()}> Griglia visibile</label>
    </div>
    <div class="row">
      <span>Passo planimetrico</span>
      <select aria-label="Passo planimetrico" value={String(appState.snapStep)} onchange={(e) => controller.setSnapStep(+e.currentTarget.value)}>
        <option value="0.25">0.25 m</option>
        <option value="0.5">0.5 m</option>
        <option value="1">1 m</option>
        <option value="2">2 m</option>
      </select>
    </div>
    <div class="row">
      <span>Passo verticale</span>
      <input type="number" class="num" min="0.01" step="0.01" aria-label="Passo verticale"
        value={appState.snapStepVert}
        onchange={(e) => controller.setSnapStepVert(Math.max(0.01, +e.currentTarget.value || 0.01))}>
    </div>
    <p class="muted">Tieni premuto Alt mentre clicchi o trascini per disattivare temporaneamente lo snap. Lo stesso passo qui sopra è usato anche nell'editor del profilo di scavo/riporto.</p>
  </section>

  <section>
    <h2>Punti quotati</h2>
    {#if appState.points.length}
      <ul class="pts">
        {#each appState.points as p (p.id)}
          <li>
            <span>
              <b>P{p.id}</b> {fmt(p.zr, 2)} m
              <span class="muted">· {fmt(appState.dem ? slopeAt(appState.dem, p.x, p.z) * 100 : 0, 0)} %</span>
            </span>
            <button class="x" aria-label={`Elimina P${p.id}`} onclick={() => controller.removePoint(p.id)}>✕</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Scegli lo strumento punto quotato e clicca sul terreno.</p>
    {/if}
  </section>

  <section>
    <h2>Libreria opere</h2>
    {#if appState.presets.length}
      <ul class="pts">
        {#each appState.presets as preset (preset.id)}
          <li>
            <span>
              <b>{preset.nome}</b>
              <span class="muted">· {OPERA_CATEGORY_LABELS[preset.categoria]}</span>
            </span>
            <button class="x" aria-label={`Elimina preset ${preset.nome}`} onclick={() => controller.removePreset(preset.id)}>✕</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Nessun preset. Disegna una traccia di scavo/riporto e salvalo dal riquadro della traccia, sotto "Modifica terreno".</p>
    {/if}
  </section>

  <section>
    <h2>Comandi</h2>
    <p class="muted">Trascina per ruotare, tasto destro o due dita per spostare, rotella per zoom. WASD per muoverti, Shift per andare più veloce. Con lo strumento Traccia: Invio termina, Esc annulla, tasto destro (senza trascinare) torna indietro di un punto.</p>
  </section>
</aside>
