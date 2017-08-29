<template lang="html">
  <div class="proxies-form">
    <proxies-dropdown></proxies-dropdown>

    <ss-form :shadowsocks="shadowsocks"></ss-form>

    <ssr-form :shadowsocksr="shadowsocksr"></ssr-form>

    <kt-form :kcptun="kcptun"></kt-form>
  </div>
</template>

<script>
import ProxiesDropdown from 'ProxiesForm/'
export default {
}
</script>

<style lang="css">
</style>
