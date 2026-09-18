<script lang="ts">
  import { appState } from '../core/appState.svelte';
  import type { AppController } from '../app/controller';

  let { controller }: { controller: AppController } = $props();

  let over = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  function handleFiles(files: FileList | null): void {
    const f = files?.[0];
    if (f) controller.openFile(f);
  }
</script>

<svelte:window
  ondragenter={(e) => { e.preventDefault(); over = true; }}
  ondragover={(e) => { e.preventDefault(); over = true; }}
  ondragleave={(e) => { e.preventDefault(); over = false; }}
  ondrop={(e) => { e.preventDefault(); over = false; handleFiles(e.dataTransfer?.files ?? null); }}
/>

{#if appState.welcomeOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay" id="welcome"
    onclick={(e) => { if ((e.target as HTMLElement).id === 'welcome' && appState.dem) appState.welcomeOpen = false; }}
  >
    <div class="card">
      <h1>Schizza gli interventi sul terreno reale</h1>
      <p>Carica un DTM in GeoTIFF (1–5 m, coordinate proiettate in metri). Puoi ritagliare l'area di lavoro prima di aprirla.</p>
      <div
        class="drop" class:over tabindex="0" role="button"
        onclick={() => fileInput?.click()}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } }}
      >
        <strong>Trascina qui il GeoTIFF</strong><span class="muted">oppure tocca per sceglierlo</span>
      </div>
      <input
        bind:this={fileInput} type="file" accept=".tif,.tiff,image/tiff" hidden
        onchange={(e) => { handleFiles(e.currentTarget.files); e.currentTarget.value = ''; }}
      >
      <div class="actions">
        <button class="btn" onclick={() => controller.openDemo()}>Apri il terreno di esempio</button>
      </div>
    </div>
  </div>
{/if}
