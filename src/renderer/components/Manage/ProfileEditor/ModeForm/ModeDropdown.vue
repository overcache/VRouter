<template lang="html">
  <div class="ModeDropdown">
    <label for="">mode</label>
    <div class="ui selection dropdown">
      <input type="hidden">
      <i class="ui dropdown icon"></i>
      <div class="default text">none</div>
      <div class="menu">
        <div class="item" data-value="global">global</div>
        <div class="item" data-value="whitelist">whitelist</div>
        <div class="item" data-value="blacklist">blacklist</div>
        <div class="item" data-value="none">none</div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
}
</script>

<style lang="css">
.ModeDropdown {
  margin: 10px 0;
}
</style>
