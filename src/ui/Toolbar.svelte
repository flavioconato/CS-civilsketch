<script lang="ts">
  import { appState } from '../core/appState.svelte';
  import { TRACCIA_KIND_HINTS, TRACCIA_KIND_LABELS } from '../core/config';
  import type { TracciaKind } from '../core/types';
  import type { AppController } from '../app/controller';

  let { controller }: { controller: AppController } = $props();

  let showKindMenu = $state(false);
  const KIND_ORDER: TracciaKind[] = ['traccia', 'livelletta', 'terreno', 'oggetto'];

  function chooseKind(kind: TracciaKind): void {
    controller.startTrackKind(kind);
    showKindMenu = false;
  }
</script>

<nav id="toolbar" aria-label="Strumenti">
  <button class="tool" onclick={() => (appState.welcomeOpen = true)}>
    <svg viewBox="0 0 24 24"><path d="M3 7h6l2 2h10v10H3z"/><path d="M12 17v-5m-2.5 2.5L12 12l2.5 2.5"/></svg>
    <span class="tip">Apri DTM</span>
  </button>
  <div class="sep"></div>
  <button class="tool" aria-pressed={appState.tool === 'inspect'} onclick={() => controller.setTool('inspect')}>
    <svg viewBox="0 0 24 24"><path d="M5 3l12 8-5 1 3 6-2 1-3-6-4 4z"/></svg>
    <span class="tip">Interroga (I)</span>
  </button>
  <button class="tool" aria-pressed={appState.tool === 'point'} onclick={() => controller.setTool('point')}>
    <svg viewBox="0 0 24 24"><path d="M12 21s-6-6-6-11a6 6 0 1 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/></svg>
    <span class="tip">Punto quotato (Q)</span>
  </button>
  <div class="sep"></div>
  <button class="tool" onclick={() => controller.fitView(true)}>
    <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 12h16M12 4v16"/></svg>
    <span class="tip">Vista in pianta (P)</span>
  </button>
  <button class="tool" onclick={() => controller.fitView(false)}>
    <svg viewBox="0 0 24 24"><path d="M3 17l6-9 4 5 3-3 5 7z"/></svg>
    <span class="tip">Vista prospettica (V)</span>
  </button>
  <button class="tool" onclick={() => controller.fitView(false)}>
    <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
    <span class="tip">Inquadra tutto (F)</span>
  </button>
  <div class="sep road"></div>
  <div class="tool-menu-wrap">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <button class="tool" aria-pressed={appState.tool === 'track'} onclick={() => (showKindMenu = !showKindMenu)}>
      <svg viewBox="0 0 24 24"><path d="M4 18c4-1 5-11 9-11s4 6 7 5"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="12" r="1.5"/></svg>
      <span class="tip">Traccia (T)</span>
    </button>
    {#if showKindMenu}
      <button class="backdrop" aria-label="Chiudi il menu" onclick={() => (showKindMenu = false)}></button>
      <div class="tool-menu" role="menu">
        {#each KIND_ORDER as kind (kind)}
          <button class="tool-menu-item" role="menuitem" onclick={() => chooseKind(kind)}>
            <b>{TRACCIA_KIND_LABELS[kind]}</b>
            <span>{TRACCIA_KIND_HINTS[kind]}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</nav>
