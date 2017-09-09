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

    <div class="ui divider"></div>

    <div class="inline field">
      <label for="">DNS 地址</label>
      <input type="text"
        v-model="dnsServer"
        :placeholder="enableTunnelDns.length !== 0 ? '8.8.8.8:53' : '127.0.0.1'"
        vee-validate="'required'"
      >
      <div class="ui checkbox">
        <input type="checkbox" value="enableTunnelDns" v-model="enableTunnelDns">
        <label>转发 DNS 查询</label>
      </div>
    </div>
    <div class="field">
      <div class="ui checkbox">
        <input type="checkbox" value="enableRelayUDP" v-model="enableRelayUDP">
        <label>转发 UDP 流量</label>
      </div>
    </div>
    <div class="ui label" v-show="enableUDP">
      <i class="ui idea icon"></i>
      转发 DNS 查询和转发 UDP 流量都需要服务器<a href="https://github.com/icymind/VRouter/wiki/%E6%9C%8D%E5%8A%A1%E5%99%A8%E5%BC%80%E5%90%AF-UDP-Relay">开启 UDP Relay <i class="ui hand pointer icon fitted"></i></a>
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
import Vue from 'vue'
import VeeValidate from 'vee-validate'
Vue.use(VeeValidate, { inject: false })

export default {
  name: 'proxies-form',
  props: ['editingClone'],
  inject: ['$validator'],
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
    enableRelayUDP: {
      get: function () {
        return this.editingClone.enableRelayUDP ? ['enableRelayUDP'] : []
      },
      set: function (value) {
        this.editingClone.enableRelayUDP = (value.length !== 0)
      }
    },
    enableTunnelDns: {
      get: function () {
        return this.editingClone.enableTunnelDns ? ['enableTunnelDns'] : []
      },
      set: function (value) {
        this.editingClone.enableTunnelDns = (value.length !== 0)
      }
    },
    enableUDP: function () {
      return this.enableTunnelDns.length !== 0 || this.enableRelayUDP.length !== 0
    },
    proxies: {
      get: function () {
        return this.editingClone.proxies
      },
      set: function (value) {
        this.editingClone.proxies = value
      }
    },
    dnsServer: {
      get: function () {
        return this.editingClone.dnsServer
      },
      set: function (value) {
        this.editingClone.dnsServer = value
      }
    },
    shadowsocks: function () {
      return this.editingClone.shadowsocks || {}
    },
    shadowsocksr: function () {
      return this.editingClone.shadowsocksr || {}
    },
    kcptun: function () {
      return this.editingClone.kcptun || {}
    }
  }
}
</script>

<style lang="css">
.ui.label a {
  color: red;
}
</style>
