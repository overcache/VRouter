<template lang="html">
  <div class="ProxiesDropdown">
    <label>代理</label>
    <div class="ui selection dropdown">
      <input type="hidden" name="proxies">
      <i class="ui dropdown icon"></i>
      <div class="default text">Gender</div>
      <div class="menu">
        <div class="item" data-value="ss">SS</div>
        <div class="item" data-value="ssr">SSR</div>
        <div class="item" data-value="sskt">SSKT</div>
        <div class="item" data-value="ssrkt">SSRKT</div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
}
</script>

<style lang="css">
.ProxiesDropdown {
  margin: 10px 0;
}
</style>
