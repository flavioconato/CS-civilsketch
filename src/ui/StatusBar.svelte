<script lang="ts">
  import { appState } from '../core/appState.svelte';
</script>

<div id="status">
  <span><em>E</em><b>{appState.statusE}</b></span>
  <span><em>N</em><b>{appState.statusN}</b></span>
  <span><em>Quota</em><b>{appState.statusZ}</b></span>
  <span><em>Pendenza</em><b>{appState.statusSlope}</b></span>
  <span class="hint">{appState.statusHint}</span>
</div>
