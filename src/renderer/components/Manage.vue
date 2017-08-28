<template>
  <div>
    <div class="ui inverted dimmer" :class="[activeLoader && 'active']">
      <div class="ui loader"></div>
    </div>
    <div class="ui three item top attached tabular menu">
      <a class="item" data-tab="status">
        <i class="dashboard icon"></i>
        状态
      </a>
      <a class="item active" data-tab="proxies">
        <i class="send icon"></i>
        配置
      </a>
      <a class="item" data-tab="system">
        <i class="linux icon"></i>
        系统
      </a>
    </div>

    <div class="ui bottom attached tab segment" data-tab="status">
      <status-tab :routing="routing" :proxies="proxies" :mode="mode" @toggle="toggle"></status-tab>
    </div>
    <div class="ui bottom attached tab segment active" data-tab="proxies">
      <proxies-tab
        :profiles="profiles"
        @editExtraList="editExtraList"
        ></proxies-tab>
    </div>
    <div class="ui bottom attached tab segment" data-tab="system">
      <p>oi142311111</p>
    </div>
  </div>
</template>

<script>
/* global $ */
import StatusTab from './Manage/Status.vue'
import ProxiesTab from './Manage/Proxies.vue'
import Utils from '@/lib/utils.js'
import VRouter from '@/lib/vrouter.js'

const path = require('path')
const fs = require('fs-extra')

// let vueInstance = null

export default {
  name: 'manage',
  components: {
    StatusTab,
    ProxiesTab
  },
  data: function () {
    return {
      vrouter: null,
      profiles: [],
      routing: false,
      activedProfile: null,
      activeLoader: false
    }
  },
  computed: {
    proxies: function () {
      if (this.activedProfile) {
        return Utils.getProxiesText(this.activedProfile.proxies)
      }
    },
    mode: function () {
      if (this.activedProfile) {
        return Utils.getModeText(this.activedProfile.mode)
      }
    }
  },
  methods: {
    toggle: async function () {
      this.activeLoader = true
      if (this.routing) {
        await Utils.resetRoute()
      } else {
        await Utils.changeRouteTo(this.vrouter.ip)
      }
      this.routing = await this.getRoutingState()
      this.activeLoader = false
    },
    getRoutingState: async function () {
      return (await Utils.getCurrentGateway() === this.vrouter.ip) &&
        (await Utils.getCurrentDns() === this.vrouter.ip)
    },
    editExtraList (type) {
      console.log('editExtraList: ', type)
      console.log(this.vrouter)
    }
  },
  watch: {
  },
  async mounted () {
    // vueInstance = this
    const appDir = Utils.getAppDir()
    this.vrouter = new VRouter(fs.readJsonSync(path.join(__static, '/config-templates/config.json')))
    // this.vmName = this.vrouter.config.virtualbox.vmName
    this.profiles = this.vrouter.config.profiles
    this.routing = await this.getRoutingState()
    this.activedProfile = this.vrouter.getActivedProfile()
    Utils.configureLog(path.join(appDir, this.vmName + '.log'))
    $('.tabular.menu .item').tab()
  }
}
</script>

<style>
.ui.attached.segment {
  border: none !important;
}
.ui.item.menu > a.item.active {
  color: #00B5AD;
}
</style>
