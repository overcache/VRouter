<template>
  <div class="ui blurring message dimmable" :class="{positive: active}">
    <div class="ui dimmer">
      <div class="content">
        <div class="center">
          <div class="ui teal icon labeled button" @click="bus.$emit('applyProfile', index)">
            <i class="ui check icon"></i>
            应用
          </div>
          <div class="ui icon labeled button" @click="bus.$emit('editProfile', index)">
            <i class="ui write icon"></i>
            编辑
          </div>
          <div class="ui red icon labeled button" @click="bus.$emit('deleteProfile', index)">
            <i class="ui remove icon"></i>
            删除
          </div>
        </div>
      </div>
    </div>

    <div class="header">{{ name }}</div>
    <div class="list">
      <li>{{ server }}</li>
      <li>{{ proxies }}</li>
      <li>{{ mode }}</li>
    </div>
  </div>
</template>

<script>
/* global $ */
import Utils from '@/lib/utils.js'

export default {
  name: 'profile',
  props: ['profile', 'index', 'bus'],
  // data: function () {
  // 如果这么做, 因为data只执行一次, 将无法检测到profile的变化
  //   return {
  //     active: this.profile.active,
  //     name: this.profile.name,
  //     proxies: Utils.getProxiesText(this.profile.proxies),
  //     mode: Utils.getModeText(this.profile.mode)
  //   }
  // },
  computed: {
    active: function () {
      return this.profile.active
    },
    name: function () {
      return this.profile.name
    },
    proxies: function () {
      return Utils.getProxiesText(this.profile.proxies)
    },
    mode: function () {
      return Utils.getModeText(this.profile.mode)
    },
    server: function () {
      let proxy = null
      if (/ssr/ig.test(this.profile.proxies)) {
        proxy = this.profile.shadowsocksr
      } else {
        proxy = this.profile.shadowsocks
      }

      if (/kt/ig.test(this.profile.proxies)) {
        proxy = this.profile.kcptun
      }
      return `${proxy.server}:${proxy.server_port}`
    }
  },
  methods: {
  },
  mounted: function () {
    $('.ui.message').dimmer({
      opacity: 0,
      on: 'hover',
      duration: 10
    })
  }
}
</script>

<style>
.ui.message {
  margin: 15px 0 !important;
}
</style>
