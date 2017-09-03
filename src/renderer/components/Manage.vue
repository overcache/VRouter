<template>
  <div>
    <div class="ui inverted dimmer" :class="[activeLoader && 'active']">
      <div class="ui text loader">{{ loaderText }}</div>
    </div>
    <div class="ui three item top attached tabular menu">
      <a class="item active" data-tab="status-tab">
        <i class="dashboard icon"></i>
        状态
      </a>
      <a class="item" data-tab="profiles-tab">
        <i class="send icon"></i>
        配置
      </a>
      <a class="item" data-tab="system-tab">
        <i class="linux icon"></i>
        系统
      </a>
    </div>

    <div class="ui bottom attached tab segment active" data-tab="status-tab">
      <status-tab
        :routing="routing"
        :proxies="proxies"
        :mode="mode"
        @toggleRouting="toggleRouting"
      >
      </status-tab>
    </div>

    <div class="ui bottom attached tab segment" data-tab="profiles-tab">
      <profiles-tab
        :profiles="profiles"
        :bus="bus"
      >
      </profiles-tab>
    </div>

    <div class="ui bottom attached tab segment" data-tab="system-tab">
      <system-tab
        :systemInfo="systemInfo"
        :vrouterInfo="vrouterInfo"
        :proxiesInfo="proxiesInfo"
        :bus="bus"
      >
      </system-tab>
    </div>

    <profile-editor
      :editingClone="editingClone"
      :showProfileEditor="showProfileEditor"
      :bus="bus"
    >
    </profile-editor>

    <profile-importer
      :showProfileImporter="showProfileImporter"
      :templateProfile="templateProfile()"
      :bus="bus"
    >
    </profile-importer>

  </div>
</template>

<script>
/* global $ */
import Vue from 'vue'
import Utils from '@/lib/utils.js'
import VRouter from '@/lib/vrouter.js'
import VBox from '@/lib/vbox.js'
import winston from '@/lib/logger.js'
import StatusTab from './Manage/StatusTab.vue'
import ProfilesTab from './Manage/ProfilesTab.vue'
import SystemTab from './Manage/SystemTab'
import ProfileEditor from './Manage/ProfileEditor'
import ProfileImporter from './Manage/ProfileImporter'

const path = require('path')
const { shell } = require('electron')
const { app } = require('electron').remote

// let vueInstance = null
const templateProfile = {
  'index': 0, // 编辑配置: index >= 0; 新建配置: index = -1; 导入配置: index = -2

  'active': false,
  'name': '新配置',
  'mode': 'whitelist',
  'proxies': 'ssKt',
  'enableRelayUDP': false,
  'enableTunnelDns': true,
  'dnsServer': '8.8.8.8:53',
  'speedupServerSSH': false,
  'serverSSHPort': 22,
  'selectedBL': {'gfwList': true, 'extraBlackList': true},
  'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
  'shadowsocks': {
    'server': '123.123.123.123',
    'server_port': 8989,
    'password': 'demo-paswd',
    'timeout': 300,
    'method': 'chacha20',
    'fast_open': false
  },
  'shadowsocksr': {
    'server': '123.123.123.123',
    'server_port': 9999,
    'password': 'demo-paswd',
    'timeout': 300,
    'method': 'chacha20',
    'protocol': 'auth_aes128_md5',
    'protocol_param': '32',
    'obfs': 'tls1.2_ticket_auth',
    'obfs_param': '',
    'others': '',
    'fast_open': false
  },
  'kcptun': {
    'server': '123.123.123.123',
    'server_port': 5555,
    'key': 'demo-secret',
    'crypt': 'aes-128',
    'mode': 'fast2',
    'others': 'sndwnd=256;rcvwnd=2048;nocomp=true'
  }
}
export default {
  name: 'manage',
  components: {
    StatusTab,
    ProfilesTab,
    SystemTab,
    ProfileEditor,
    ProfileImporter
  },
  data: function () {
    return {
      vrouter: {},
      profiles: [],
      activeLoader: false,
      loaderText: 'Loading',
      // vue 不能检测用常规方法对对象属性的进行'增加','删除'.
      // https://vuejs.org/v2/guide/list.html#Object-Change-Detection-Caveats
      editingClone: Object.assign({}, templateProfile),
      showProfileEditor: false,
      showProfileImporter: false,
      showAboutModal: false,
      bus: {},
      systemInfo: {
        // 为了和真实值一致, 这些值需要手动维护
        currentGWIP: '',
        currentDnsIP: ''
      },
      vrouterInfo: {
        // 这些值需要手动维护
        openwrtVersion: '',
        brLanIP: '',
        bridgeAdapter: '',
        lanIP: '',
        macAddress: '',
        ssVersion: '',
        ssrVersion: '',
        ktVersion: ''
      },
      proxiesInfo: {
        // 这些值需要手动维护
        enableTunnelDns: false,
        isTunnelDnsRunning: false,
        enableSs: false,
        isSsRunning: false,
        enableSsr: false,
        isSsrRunning: false,
        enableKt: false,
        isKtRunning: false
      }
    }
  },
  computed: {
    activedProfile: function () {
      let profile = {}
      this.profiles.forEach(p => {
        if (p.active) {
          profile = p
        }
      })
      return profile
    },
    proxies: function () {
      return Utils.getProxiesText(this.activedProfile.proxies)
    },
    mode: function () {
      if (this.activedProfile) {
        return Utils.getModeText(this.activedProfile.mode)
      }
    },
    routing: function () {
      return (this.systemInfo.currentGWIP === this.vrouter.ip) && (this.systemInfo.currentDnsIP === this.vrouter.ip)
    }
  },
  methods: {
    toggleRouting: async function () {
      this.activeLoader = true
      if (await this.routing) {
        await Utils.resetRoute()
      } else {
        await Utils.changeRouteTo(this.vrouter.ip)
      }
      await this.getSystemInfo()
      this.activeLoader = false
    },
    getSystemInfo: async function () {
      this.systemInfo.currentGWIP = await Utils.getCurrentGateway()
      this.systemInfo.currentDnsIP = await Utils.getCurrentDns()
    },
    getVrouterInfo: async function () {
      // can not make vrouterinfo an asyncComputed attribute for unkown error
      this.vrouterInfo.openwrtVersion = await this.vrouter.getOpenwrtVersion()
      this.vrouterInfo.brLanIP = await this.vrouter.getLan()
      this.vrouterInfo.bridgeAdapter = await VBox.getAssignedBridgeService(this.vrouter.name)
      this.vrouterInfo.lanIP = await this.vrouter.getWan()
      this.vrouterInfo.macAddress = await this.vrouter.getMacAddress()
      this.vrouterInfo.ssVersion = await this.vrouter.getSsVersion('shadowsocks', this.vrouter.config.proxiesInfo)
      this.vrouterInfo.ssrVersion = await this.vrouter.getSsVersion('shadowsocksr', this.vrouter.config.proxiesInfo)
      this.vrouterInfo.ktVersion = await this.vrouter.getKtVersion(this.vrouter.config.proxiesInfo)
    },
    getProxiesInfo: async function () {
      const proxiesInfo = this.vrouter.config.proxiesInfo

      this.proxiesInfo.enableTunnelDns = this.activedProfile.enableTunnelDns
      this.proxiesInfo.isTunnelDnsRunning = await this.vrouter.isTunnelDnsRunning(this.activedProfile.proxies, proxiesInfo)

      this.proxiesInfo.enableSs = /^(ss|ssKt)$/ig.test(this.activedProfile.proxies)
      this.proxiesInfo.isSsRunning = await this.vrouter.isSsRunning(this.activedProfile.proxies, proxiesInfo)
      this.proxiesInfo.enableSsr = /ssr/ig.test(this.activedProfile.proxies)
      this.proxiesInfo.isSsrRunning = await this.vrouter.isSsRunning(this.activedProfile.proxies, proxiesInfo)

      this.proxiesInfo.enableKt = /kt/ig.test(this.activedProfile.proxies)
      this.proxiesInfo.isKtRunning = await this.vrouter.isKtRunning(proxiesInfo)
    },
    editExtraList: async function (type) {
      type = type[0].toUpperCase() + type.toLowerCase().slice(1)
      return shell.openItem(path.join(this.vrouter.cfgDirPath, this.vrouter.config.firewallInfo.lists[`extra${type}ListFname`]))
    },
    templateProfile: function () {
      return Object.assign({}, templateProfile)
    },
    newProfile: function () {
      // 编辑配置: index >= 0; 新建配置: index = -1; 导入配置: index = -2
      this.editingClone.index = -1
      this.showProfileEditor = true
    },
    importProfile: function (profile) {
      // 编辑配置: index >= 0; 新建配置: index = -1; 导入配置: index = -2
      this.editingClone = Object.assign({}, profile)
      this.editingClone.index = -2
      this.showProfileImporter = false
      this.showProfileEditor = true
    },
    editProfile: function (index) {
      this.editingClone = Object.assign({}, this.vrouter.config.profiles[index])
      // 编辑配置: index >= 0; 新建配置: index = -1; 导入配置: index = -2
      this.editingClone.index = index
      this.showProfileEditor = true
    },
    applyProfile: async function (index) {
      this.activeLoader = true
      this.activedProfile.active = false
      this.profiles[index].active = true
      // 耗时较长的原因在于重启dnsmasq, 设置ipset需要处理很多条目
      await this.vrouter.applyActivedProfile()
      await this.vrouter.saveCfg2File()
      await this.getProxiesInfo()
      this.activeLoader = false
      winston.info(`apply profile: ${this.activedProfile.name}`)
    },
    deleteProfile: async function (index) {
      this.profiles.splice(index, 1)
      await this.vrouter.saveCfg2File()
    },
    editorSave: async function (profile) {
      // 子组件传回的 profile 对象, 是 this.editingClone 的深度拷贝
      // console.log(profile === this.editingClone) // false

      this.showProfileEditor = false
      const index = profile.index
      delete profile.index
      if (index >= 0) {
        this.profiles.splice(index, 1, profile)
      } else {
        this.profiles.push(profile)
      }
      winston.info(`save profile: ${profile.name} to disk`)
      await this.vrouter.saveCfg2File()

      if (profile.active) {
        this.loaderText = 'Applying Profile'
        this.activeLoader = true
        await this.vrouter.applyActivedProfile()
        this.activeLoader = false
        winston.info(`apply editting profile: ${this.activedProfile.name}`)
        this.loaderText = 'Loading'
      }
    },
    refreshInfos: async function (silent = true) {
      if (!silent) this.activeLoader = true
      await this.vrouter.updateBridgedAdapter()
      this.getSystemInfo()
      await this.getProxiesInfo()
      await this.getVrouterInfo()
      if (!silent) this.activeLoader = false
    },
    openLogFile: function () {
      const file = path.join(this.vrouter.cfgDirPath, 'vrouter.log')
      return shell.openItem(file)
    },
    shutdownVRouter: async function () {
      this.activeLoader = true
      await Utils.resetRoute()
      await VBox.saveState(this.vrouter.name)
      this.activeLoader = false
      app.quit()
    },
    deleteVRouter: async function () {
      this.activeLoader = true
      await Utils.resetRoute()
      await VBox.delete(this.vrouter.name)
      this.activeLoader = false
      app.quit()
    },
    loginVRouter: function () {
      VBox.attachHeadless(this.vrouter.name)
      Utils.wait(3000)
      VBox.sendKeystrokesTo(this.vrouter.name)
    }
  },
  mounted: function () {
    $('.tabular.menu .item').tab()

    setInterval(async () => {
      // 每15分钟检测一遍状态, 目前和虚拟机直接只要一个ssh连接, 所以暂时不能并发.
      await this.refreshInfos()
    }, 900000)

    $(document).on('click', 'a[href^="http"]', function (event) {
      event.preventDefault()
      shell.openExternal(this.href)
    })
  },
  created: async function () {
    this.vrouter = new VRouter(await VRouter.getLatestCfg())
    this.profiles = this.vrouter.config.profiles

    this.bus = new Vue()
    this.bus.$on('editExtraList', this.editExtraList)
    this.bus.$on('newProfile', this.newProfile)
    this.bus.$on('openProfileImporter', () => { this.showProfileImporter = true })
    this.bus.$on('importerCancel', () => { this.showProfileImporter = false })
    this.bus.$on('importProfile', this.importProfile)
    this.bus.$on('editProfile', this.editProfile)
    this.bus.$on('applyProfile', this.applyProfile)
    this.bus.$on('deleteProfile', this.deleteProfile)
    this.bus.$on('editorCancel', () => { this.showProfileEditor = false })
    this.bus.$on('editorSave', this.editorSave)
    this.bus.$on('deleteVRouter', this.deleteVRouter)
    this.bus.$on('shutdownVRouter', this.shutdownVRouter)
    this.bus.$on('openLogFile', this.openLogFile)
    this.bus.$on('showAboutModal', () => { this.showAboutModal = true })
    this.bus.$on('refreshInfos', this.refreshInfos)
    this.bus.$on('loginVRouter', this.loginVRouter)

    await this.refreshInfos()
  }
}
</script>

<style>
.ui.attached.segment {
  border: none !important;
}
#app .ui.item.menu {
  margin-bottom: 20px !important;
  border-bottom: none;
}
#app .ui.item.menu > a.item {
  border-top: none;
  border-left: none;
  border-right: none;
  border-bottom: 2px solid #E0E1E2;
}
#app .ui.item.menu > a.item.active {
  color: #00B5AD;
  border-top: none;
  border-left: none;
  border-right: none;
  border-bottom: 3px solid #00B5AD;
}
</style>
