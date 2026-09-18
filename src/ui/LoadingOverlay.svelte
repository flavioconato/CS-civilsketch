<script lang="ts">
  import { appState } from '../core/appState.svelte';
</script>

{#if appState.loading.active}
  <div class="overlay" id="loading">
    <div class="card">
      <div>{appState.loading.msg}</div>
      <div class="bar"><i></i></div>
    </div>
  </div>
{/if}
