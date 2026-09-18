<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from './core/appState.svelte';
  import { AppController } from './app/controller';
  import Toolbar from './ui/Toolbar.svelte';
  import BrandBar from './ui/BrandBar.svelte';
  import Panel from './ui/Panel.svelte';
  import TrackPopup from './ui/TrackPopup.svelte';
  import StatusBar from './ui/StatusBar.svelte';
  import WelcomeDialog from './ui/WelcomeDialog.svelte';
  import CropDialog from './ui/CropDialog.svelte';
  import LoadingOverlay from './ui/LoadingOverlay.svelte';
  import Toast from './ui/Toast.svelte';

  let viewEl: HTMLDivElement;
  let labelsEl: HTMLDivElement;
  let controller: AppController | null = $state(null);
  let fatalMessage: string | null = $state(null);

  onMount(() => {
    const canvas = document.createElement('canvas');
    if (!(canvas.getContext('webgl2') || canvas.getContext('webgl'))) {
      fatalMessage = 'Questo browser non ha WebGL attivo, quindi non può disegnare in 3D. Prova con Chrome, Edge o Firefox aggiornati.';
      return;
    }
    try {
      controller = new AppController(viewEl, labelsEl);
    } catch (err) {
      console.error(err);
      fatalMessage = `Avvio non riuscito: ${(err as Error).message}`;
      return;
    }

    const onError = (ev: ErrorEvent) => {
      appState.loading = { active: false, msg: '' };
      appState.toast = { msg: `Errore: ${ev.message || 'imprevisto'}`, show: true };
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      appState.loading = { active: false, msg: '' };
      appState.toast = { msg: `Errore: ${ev.reason?.message || 'imprevisto'}`, show: true };
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  });
</script>

<div id="view" bind:this={viewEl}></div>

{#if fatalMessage}
  <div class="overlay">
    <div class="card">
      <h1>Impossibile avviare</h1>
      <p>{fatalMessage}</p>
    </div>
  </div>
{:else if controller}
  <Toolbar {controller} />
  <BrandBar />
  <Panel {controller} />
  <TrackPopup {controller} />
  <StatusBar />
  <WelcomeDialog {controller} />
  <CropDialog {controller} />
{/if}

<LoadingOverlay />
<Toast />
<div id="labels" bind:this={labelsEl}></div>
