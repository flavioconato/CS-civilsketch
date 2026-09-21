<script lang="ts">
  import { appState } from '../core/appState.svelte';
  import { OPERA_CATEGORY_LABELS } from '../core/config';
  import { fmt } from '../core/format';
  import { heightAt } from '../dem/dem';
  import { formatChainage, progressives, trackLength } from '../core/polyline';
  import { accumuloMaxPendenzaGradi, detectMonteSide } from '../core/accumulo';
  import type { AppController } from '../app/controller';
  import type { LivellettaMode, OperaCategoria, SezionePunto, SezioneTipo } from '../core/types';
  import SectionEditor from './SectionEditor.svelte';
  import InfoButton from './InfoButton.svelte';

  let { controller }: { controller: AppController } = $props();

  const track = $derived(appState.tracks.find((t) => t.id === appState.selectedTrackId) ?? null);
  const trackProgressives = $derived(track ? progressives(track.vertices) : []);
  const trackVolumes = $derived(track ? (appState.trackVolumes[track.id] ?? { scavo: 0, riporto: 0 }) : null);
  const muro = $derived(track ? (appState.muroStats[track.id] ?? null) : null);
  const accumulo = $derived(track ? (appState.accumuloStats[track.id] ?? null) : null);
  const isDrawing = $derived(track !== null && appState.drawingTrackId === track.id);
  const maxPendenzaAccumulo = $derived(
    track?.muro && appState.dem ? accumuloMaxPendenzaGradi(appState.dem, track.vertices, track.muro) : null,
  );

  // Rete di sicurezza indipendente dall'evento di input: qualunque sia la causa (digitazione,
  // cambio di altezza o di terreno che abbassa il limite consigliato), la pendenza non resta mai
  // sopra il massimo per questo versante più di un istante.
  $effect(() => {
    if (track?.muro?.accumulo.attivo && maxPendenzaAccumulo !== null
      && track.muro.accumulo.pendenzaGradi > maxPendenzaAccumulo) {
      controller.setAccumulo(track.id, { pendenzaGradi: maxPendenzaAccumulo });
    }
  });

  function onToggleAccumulo(trackId: number, checked: boolean): void {
    if (checked) {
      const t = appState.tracks.find((x) => x.id === trackId);
      const lato = t && appState.dem ? detectMonteSide(appState.dem, t.vertices) : 1;
      controller.setAccumulo(trackId, { attivo: true, lato });
    } else {
      controller.setAccumulo(trackId, { attivo: false });
    }
  }

  function invertiLatoMonte(trackId: number): void {
    const t = appState.tracks.find((x) => x.id === trackId);
    if (t) controller.setAccumulo(trackId, { lato: t.muro!.accumulo.lato === 1 ? -1 : 1 });
  }

  /**
   * Bozza locale del profilo di sezione: si applica al terreno 3D solo su "Applica" (o alla
   * chiusura/cambio traccia), non a ogni trascinamento — ricalcolare l'intero DTM a ogni micro
   * spostamento è troppo lento su terreni grandi.
   */
  let sezioneDraft = $state<SezionePunto[]>([]);
  let sezioneBaseline = $state<SezionePunto[]>([]);
  let lastSyncedTrackId = $state<number | null>(null);

  function puntiEqual(a: SezionePunto[], b: SezionePunto[]): boolean {
    return a.length === b.length && a.every((p, i) => p.d === b[i].d && p.dz === b[i].dz);
  }

  function syncSezioneDraft(t: { id: number; sezione: { punti: SezionePunto[] } | null }): void {
    if (!t.sezione) return;
    sezioneDraft = t.sezione.punti.map((p) => ({ ...p }));
    sezioneBaseline = t.sezione.punti.map((p) => ({ ...p }));
    lastSyncedTrackId = t.id;
  }

  $effect(() => {
    if (track?.sezione && track.id !== lastSyncedTrackId) syncSezioneDraft(track);
  });

  const sezioneDirty = $derived(!puntiEqual(sezioneDraft, sezioneBaseline));

  function applySezioneDraft(): void {
    if (!track || !sezioneDirty) return;
    controller.updateSezionePunti(track.id, sezioneDraft);
    sezioneBaseline = sezioneDraft.map((p) => ({ ...p }));
  }

  // Applica automaticamente la bozza rimasta in sospeso (se diversa dall'ultima applicata) quando si
  // cambia traccia senza cliccare "Applica", così le modifiche non si perdono silenziosamente.
  $effect(() => {
    const id = track?.id ?? null;
    return () => {
      if (id !== null && !puntiEqual(sezioneDraft, sezioneBaseline)) controller.updateSezionePunti(id, sezioneDraft);
    };
  });

  let presetNameDraft = $state('');

  function onApplyPreset(trackId: number, raw: string): void {
    if (!raw) return;
    controller.applyPreset(trackId, +raw);
    const t = appState.tracks.find((x) => x.id === trackId);
    if (t) syncSezioneDraft(t);
  }

  function onTipoChange(trackId: number, tipo: SezioneTipo): void {
    controller.setSezioneTipo(trackId, tipo);
    const t = appState.tracks.find((x) => x.id === trackId);
    if (t) syncSezioneDraft(t);
  }

  function onSavePreset(trackId: number, categoria: OperaCategoria | null): void {
    if (!presetNameDraft.trim()) return;
    applySezioneDraft();
    controller.saveSezioneAsPreset(trackId, presetNameDraft, categoria ?? 'cls');
    presetNameDraft = '';
  }

  function onLivellettaMode(trackId: number, mode: LivellettaMode): void {
    controller.updateLivelletta(trackId, { mode });
  }

  function close(): void {
    controller.selectTrack(null);
  }
</script>

{#if track}
  <aside id="trackPopup">
    <div class="head">
      <input
        type="text" aria-label="Nome traccia"
        value={track.name}
        onchange={(e) => controller.renameTrack(track.id, e.currentTarget.value)}
      >
      <button class="x" aria-label="Chiudi" onclick={close}>✕</button>
    </div>

    <section>
      <dl class="kv">
        <dt>Vertici</dt><dd>{track.vertices.length}</dd>
        <dt>Lunghezza</dt><dd>{fmt(trackLength(track.vertices), 1)} m</dd>
      </dl>

      {#if isDrawing}
        <p class="muted">Clicca sul terreno per aggiungere vertici. Tasto destro per tornare indietro di un punto, Invio per terminare, Esc per annullare.</p>
        <div class="actions">
          <button class="btn" onclick={() => controller.cancelTrackDraw()}>Annulla</button>
          <button class="btn primary" onclick={() => controller.finishTrackDraw()}>Termina</button>
        </div>
      {:else}
        <div class="actions">
          <button class="btn" onclick={() => controller.continueTrack(track.id)}>Continua a disegnare</button>
          <button class="btn" onclick={() => controller.removeTrack(track.id)}>Elimina</button>
        </div>
      {/if}

      {#if track.vertices.length}
        <ul class="pts">
          {#each track.vertices as v, i}
            <li>
              <span>
                <b>{formatChainage(trackProgressives[i] ?? 0)}</b>
                {#if appState.dem}<span class="muted">· {fmt(heightAt(appState.dem, v.x, v.z), 2)} m</span>{/if}
              </span>
              <button class="x" aria-label={`Elimina vertice ${i + 1}`} onclick={() => controller.removeTrackVertex(track.id, i)}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if track.kind === 'livelletta' || track.kind === 'terreno'}
      <section>
        <h2>
          Livelletta
          <InfoButton text="Quota+pendenza o quota iniziale+finale danno un profilo lineare. Vertici di livelletta permette un profilo spezzato. Quote del terreno prende la quota naturale in ogni vertice della traccia e si aggiorna da sola se sposti o aggiungi vertici." />
        </h2>
        <div class="row">
          <select
            aria-label="Modalità livelletta" value={track.livelletta.mode}
            onchange={(e) => onLivellettaMode(track.id, e.currentTarget.value as LivellettaMode)}
          >
            <option value="pendenza">Quota iniziale + pendenza</option>
            <option value="quote">Quota iniziale + finale</option>
            <option value="vertici">Vertici di livelletta</option>
            <option value="terreno">Quote del terreno nei vari punti</option>
          </select>
        </div>

        {#if track.livelletta.mode === 'pendenza'}
          <div class="row">
            <span>Quota iniziale</span>
            <input type="number" class="num" step="0.1" aria-label="Quota iniziale" value={track.livelletta.quotaIniziale}
              onchange={(e) => controller.updateLivelletta(track.id, { quotaIniziale: +e.currentTarget.value })}> m
          </div>
          <div class="row">
            <span>Pendenza</span>
            <input type="number" class="num" step="0.1" aria-label="Pendenza percentuale" value={track.livelletta.pendenza}
              onchange={(e) => controller.updateLivelletta(track.id, { pendenza: +e.currentTarget.value })}> %
          </div>
        {:else if track.livelletta.mode === 'quote'}
          <div class="row">
            <span>Quota iniziale</span>
            <input type="number" class="num" step="0.1" aria-label="Quota iniziale" value={track.livelletta.quotaIniziale}
              onchange={(e) => controller.updateLivelletta(track.id, { quotaIniziale: +e.currentTarget.value })}> m
          </div>
          <div class="row">
            <span>Quota finale</span>
            <input type="number" class="num" step="0.1" aria-label="Quota finale" value={track.livelletta.quotaFinale}
              onchange={(e) => controller.updateLivelletta(track.id, { quotaFinale: +e.currentTarget.value })}> m
          </div>
        {:else if track.livelletta.mode === 'vertici'}
          {#if track.livelletta.vertici.length}
            <ul class="pts">
              {#each track.livelletta.vertici as lv, i}
                <li>
                  <span>
                    <input type="number" class="num" style="width:64px" aria-label={`Progressiva vertice livelletta ${i + 1}`} value={lv.prog}
                      onchange={(e) => controller.updateLivellettaVertex(track.id, i, { prog: +e.currentTarget.value })}>
                    <input type="number" class="num" style="width:64px" aria-label={`Quota vertice livelletta ${i + 1}`} value={lv.quota}
                      onchange={(e) => controller.updateLivellettaVertex(track.id, i, { quota: +e.currentTarget.value })}> m
                  </span>
                  <button class="x" aria-label={`Elimina vertice livelletta ${i + 1}`} onclick={() => controller.removeLivellettaVertex(track.id, i)}>✕</button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">Nessun vertice: aggiungine uno per definire il profilo spezzato.</p>
          {/if}
          <button class="btn" onclick={() => controller.addLivellettaVertex(track.id)}>Aggiungi vertice</button>
        {/if}
      </section>
    {/if}

    {#if track.kind === 'terreno' && track.sezione}
      <section>
        <h2>Modifica terreno</h2>
        <div class="row">
          <span>Categoria</span>
          <select aria-label="Categoria opera" value={track.categoria ?? ''}
            onchange={(e) => controller.setCategoria(track.id, e.currentTarget.value ? (e.currentTarget.value as OperaCategoria) : null)}
          >
            <option value="">—</option>
            {#each Object.entries(OPERA_CATEGORY_LABELS) as [key, label] (key)}
              <option value={key}>{label}</option>
            {/each}
          </select>
        </div>
        <div class="row">
          <span>
            Tipo
            <InfoButton text={track.sezione.tipo === 'canale'
              ? 'La livelletta della traccia è la quota di fondo canale: nel profilo qui sotto, d=0 è l\'asse e quota=0 è quella quota.'
              : 'La livelletta della traccia è la quota della piattaforma: nel profilo qui sotto, d=0 è l\'asse e quota=0 è quella quota.'} />
          </span>
          <select aria-label="Tipo di modifica" value={track.sezione.tipo}
            onchange={(e) => onTipoChange(track.id, e.currentTarget.value as SezioneTipo)}
          >
            <option value="canale">Canale (scavo)</option>
            <option value="rilevato">Rilevato (riporto)</option>
          </select>
        </div>
        <div class="row">
          <select aria-label="Applica preset" value=""
            onchange={(e) => { onApplyPreset(track.id, e.currentTarget.value); e.currentTarget.value = ''; }}
          >
            <option value="">Applica preset…</option>
            {#each appState.presets as preset (preset.id)}
              <option value={preset.id}>{preset.nome}</option>
            {/each}
          </select>
        </div>
        <SectionEditor
          punti={sezioneDraft}
          snapD={appState.snapStep}
          snapDz={appState.snapStepVert}
          onChange={(punti) => (sezioneDraft = punti)}
        />
        <div class="sez-apply">
          <button class="btn primary" disabled={!sezioneDirty} onclick={applySezioneDraft}>Applica al terreno 3D</button>
          <span class="hint">{sezioneDirty ? 'Ci sono modifiche non ancora applicate al terreno.' : 'Il terreno si aggiorna solo quando applichi, per restare fluido mentre disegni.'}</span>
        </div>
        {#if trackVolumes}
          <dl class="kv" style="margin-top:10px">
            <dt>Sterro</dt><dd>{fmt(trackVolumes.scavo, 0)} m³</dd>
            <dt>Riporto</dt><dd>{fmt(trackVolumes.riporto, 0)} m³</dd>
          </dl>
        {/if}
        <div class="row">
          <input
            type="text" style="flex:1;background:var(--panel-solid);border:1px solid var(--line);border-radius:6px;padding:4px 8px"
            placeholder="Nome nuovo preset" aria-label="Nome nuovo preset"
            value={presetNameDraft} oninput={(e) => (presetNameDraft = e.currentTarget.value)}
          >
          <button class="btn" onclick={() => onSavePreset(track.id, track.categoria)}>Salva come preset</button>
        </div>
      </section>
    {/if}

    {#if track.kind === 'oggetto' && track.muro}
      <section>
        <h2>
          Muro / barriera / briglia
          <InfoButton text="Oggetto separato, non modifica il terreno. La sommità resta a quota costante lungo la traccia: l'altezza qui sotto si sviluppa per intero solo nel punto più basso del terreno, minore dove il terreno sale." />
        </h2>
        <div class="row">
          <span>Categoria</span>
          <select aria-label="Categoria opera" value={track.categoria ?? 'contenimento'}
            onchange={(e) => controller.setCategoria(track.id, e.currentTarget.value as OperaCategoria)}
          >
            {#each Object.entries(OPERA_CATEGORY_LABELS) as [key, label] (key)}
              <option value={key}>{label}</option>
            {/each}
          </select>
        </div>
        <div class="row">
          <span>Altezza massima (punto più basso)</span>
          <input type="number" class="num" min="0.1" step="0.1" aria-label="Altezza massima"
            value={track.muro.altezza} onchange={(e) => controller.updateMuro(track.id, { altezza: Math.max(0.1, +e.currentTarget.value || 0.1) })}> m
        </div>
        <div class="row">
          <span>Spessore</span>
          <input type="number" class="num" min="0.05" step="0.05" aria-label="Spessore"
            value={track.muro.spessore} onchange={(e) => controller.updateMuro(track.id, { spessore: Math.max(0.05, +e.currentTarget.value || 0.05) })}> m
        </div>
        <div class="row">
          <span>Fondazione (infissione)</span>
          <input type="number" class="num" min="0" step="0.1" aria-label="Fondazione"
            value={track.muro.fondazione} onchange={(e) => controller.updateMuro(track.id, { fondazione: Math.max(0, +e.currentTarget.value || 0) })}> m
        </div>
        {#if muro}
          <dl class="kv">
            <dt>Altezza fuori terra</dt><dd>da {fmt(muro.hMin, 2)} a {fmt(muro.hMax, 2)} m</dd>
            <dt>Quota sommità</dt><dd>{fmt(muro.crest, 2)} m</dd>
            <dt>Volume stimato</dt><dd>{fmt(muro.volume, 1)} m³</dd>
          </dl>
        {/if}
      </section>

      <section>
        <h2>Accumulo a monte</h2>
        <label class="row" style="cursor:pointer">
          <span>Calcola l'accumulo trattenuto a monte</span>
          <input type="checkbox" checked={track.muro.accumulo.attivo}
            onchange={(e) => onToggleAccumulo(track.id, e.currentTarget.checked)}>
        </label>
        {#if track.muro.accumulo.attivo}
          <div class="row">
            <span>
              Pendenza superficie
              <InfoButton text="0° = acqua (pelo libero orizzontale, come un invaso). Maggiore di 0° = detrito, secondo il suo angolo di riposo. Oltre la pendenza massima indicata, la superficie non incontra più il versante entro una distanza ragionevole: il risultato smette di avere senso fisico." />
            </span>
            <input type="number" class="num" min="0" max={maxPendenzaAccumulo ?? 60} step="1" aria-label="Pendenza della superficie di accumulo in gradi"
              value={track.muro.accumulo.pendenzaGradi}
              onchange={(e) => {
                const raw = Math.max(0, +e.currentTarget.value || 0);
                const clamped = maxPendenzaAccumulo !== null ? Math.min(raw, maxPendenzaAccumulo) : raw;
                controller.setAccumulo(track.id, { pendenzaGradi: clamped });
              }}> °
          </div>
          {#if maxPendenzaAccumulo !== null}
            <p class="muted">Pendenza massima consigliata su questo versante: {maxPendenzaAccumulo}°.</p>
          {/if}
          <div class="row">
            <span>Lato monte rilevato dal terreno</span>
            <button class="btn" onclick={() => invertiLatoMonte(track.id)}>Inverti lato</button>
          </div>
          {#if accumulo}
            <dl class="kv">
              <dt>Superficie in pianta</dt><dd>{fmt(accumulo.area, 0)} m²</dd>
              <dt>Volume accumulabile</dt><dd>{fmt(accumulo.volume, 0)} m³</dd>
            </dl>
          {/if}
        {/if}
      </section>
    {/if}
  </aside>
{/if}
