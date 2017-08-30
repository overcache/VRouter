<template lang="html">
  <div class="ui form">
    <div class="grouped fields">
      <label>代理工具</label>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="ss" v-model="proxies">
          <label>Shadowsocks</label>
        </div>
      </div>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="ssr" v-model="proxies">
          <label>ShadowsocksR</label>
        </div>
      </div>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="ssKt" v-model="proxies">
          <label>Shadowsocks + Kcptun</label>
        </div>
      </div>
      <div class="field">
        <div class="ui radio checkbox">
          <input type="radio" value="ssrKt" v-model="proxies">
          <label>ShadowsocksR + Kcptun</label>
        </div>
      </div>
    </div>

    <ss-form :shadowsocks="shadowsocks" v-show="enableSs"></ss-form>

    <ssr-form :shadowsocksr="shadowsocksr" v-show="enableSsr"></ssr-form>

    <kt-form :kcptun="kcptun" v-show="enableKt"></kt-form>
  </div>
</template>

<script>
import SsForm from './ProxiesForm/SsForm'
import SsrForm from './ProxiesForm/SsrForm'
import KtForm from './ProxiesForm/KtForm'
export default {
  name: 'proxies-form',
  props: ['editingClone'],
  components: {
    SsForm,
    SsrForm,
    KtForm
  },
  computed: {
    enableSs: function () {
      return /^(ss|ssKt)$/ig.test(this.editingClone.proxies)
    },
    enableSsr: function () {
      return /ssr/ig.test(this.editingClone.proxies)
    },
    enableKt: function () {
      return /kt/ig.test(this.editingClone.proxies)
    },
    proxies: {
      get: function () {
        return this.editingClone.proxies
      },
      set: function (value) {
        this.editingClone.proxies = value
      }
    },
    shadowsocks: function () {
      return this.editingClone.shadowsocks
    },
    shadowsocksr: function () {
      return this.editingClone.shadowsocksr
    },
    kcptun: function () {
      return this.editingClone.kcptun
    }
  }
}
</script>

<style lang="css">
</style>
