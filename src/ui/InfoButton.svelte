<script lang="ts">
  /**
   * Spiegazione testuale lunga tenuta fuori dalla vista finché non serve: le schermate (proprietà
   * di un'opera, pannello di verifica) sono già piene di campi numerici, quindi il testo esplicativo
   * sta in un popover invece che come paragrafo sempre visibile.
   */
  let { text }: { text: string } = $props();
  let open = $state(false);
</script>

<span class="info-wrap">
  <button
    type="button" class="info-btn" aria-label="Informazioni" aria-expanded={open}
    onclick={() => (open = !open)}
  >i</button>
  {#if open}
    <button type="button" class="backdrop" aria-label="Chiudi" onclick={() => (open = false)}></button>
    <div class="info-popover" role="note">{text}</div>
  {/if}
</span>
