<script lang="ts">
  import { appState } from '../core/appState.svelte';
</script>

<div id="toast" role="status" class:show={appState.toast.show}>{appState.toast.msg}</div>
