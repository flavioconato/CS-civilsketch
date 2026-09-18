<script lang="ts">
  import { appState } from '../core/appState.svelte';
</script>

<div id="brand">
  <b>CivilSketch</b>
  <span>{appState.dem ? appState.dem.name : 'Nessun terreno caricato'}</span>
</div>
<button id="panelToggle" class="tool" aria-label="Pannello" onclick={() => (appState.panelOpenMobile = !appState.panelOpenMobile)}>
  <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
</button>
