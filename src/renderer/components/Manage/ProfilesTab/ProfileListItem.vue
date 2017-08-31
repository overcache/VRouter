<template>
  <div id="profile-list-item" class="ui blurring message dimmable profile-list-item" :class="{positive: active}">

    <div class="ui top left attached label" :class="{green: active}">{{ name }}</div>

    <div class="ui dimmer">
      <div class="content">
        <div class="center">
          <div class="ui teal icon labeled button" @click="applyHandler">
            <i class="ui check icon"></i>
            应用
          </div>
          <div class="ui icon labeled button" @click="editHandler">
            <i class="ui write icon"></i>
            编辑
          </div>
          <div class="ui red icon labeled button" @click="deleteHandler">
            <i class="ui remove icon"></i>
            删除
          </div>
        </div>
      </div>
    </div>

    <div class="list">
      <li>{{ server }}</li>
      <li>{{ proxies }}
      <li>
        <span>{{ mode }}</span>
        <span>{ 转发 DNS 查询 <i class="ui toggle on icon teal" :class="enableTunnelDns ? 'on teal': 'off'"></i>}</span>
        <span>{ 转发 UDP 流量 <i class="ui toggle off icon" :class="enableRelayUDP ? 'on teal' : 'off'"></i>}</span>
      </li>
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
    enableTunnelDns: function () {
      return this.profile.enableTunnelDns
    },
    enableRelayUDP: function () {
      return this.profile.enableRelayUDP
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
    hideBtns: function () {
      $('.ui.message').dimmer('hide')
    },
    editHandler: function () {
      this.bus.$emit('editProfile', this.index)
      this.hideBtns()
    },
    applyHandler: function () {
      this.bus.$emit('applyProfile', this.index)
      this.hideBtns()
    },
    deleteHandler: function () {
      this.bus.$emit('deleteProfile', this.index)
      this.hideBtns()
    }
  },
  mounted: function () {
    $('.ui.message').dimmer({
      opacity: 0,
      on: 'hover',
      duration: 100
    })
  }
}
</script>

<style>
.ui.message.profile-list-item {
  margin-bottom: 25px;
  padding-top: 30px;
}
.ui.message#profile-list-item .dimmer {
  margin-top: 0 !important;
}
</style>
