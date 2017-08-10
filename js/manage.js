/* eslint-env jquery */
/* global Vue */

const { VRouter } = require('../js/vrouter-local.js')
const { app, getCurrentWindow } = require('electron').remote
const { shell } = require('electron')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
// const log = require('electron-log')
// log.transports.console.level = 'info'
const winston = require('winston')

let vrouter = new VRouter()
winston.configure({
  transports: [
    new (winston.transports.File)({
      filename: path.join(vrouter.config.host.configDir, 'vrouter.log'),
      level: 'info'
    }),
    new (winston.transports.Console)({
      level: 'debug'
    })
  ]
})

Vue.component('profile', {
  props: ['profiles', 'profile', 'index', 'proxiesTextDict', 'proxiesModeTextDict', 'editingProfile', 'toggleProfileEditor', 'deleteProfile', 'editProfile', 'applyProfile'],
  template: String.raw`
  <div v-bind:class="['ui blurring message dimmable', profiles.activedProfile === index ? 'positive' : '']" v-bind:id="index">
    <div class="header">{{ profile.name }}</div>
    <div class="list">
      <li>{{ (profile.shadowsocks && profile.shadowsocks.address) || profile.shadowsocksr.address }}:{{ (profile.shadowsocks && profile.shadowsocks.port) || profile.shadowsocksr.port }}</li>
      <li>代理: {{ proxiesTextDict[profile.proxies] }}</li>
      <li>模式: {{ proxiesModeTextDict[profile.mode] }}</li>
    </div>
    <div class="ui dimmer">
      <div class="content">
        <div class="center">
          <div class="ui teal icon labeled button" v-on:click="applyProfile(index)">
            <i class="ui check icon"></i>
            应用
          </div>
          <div class="ui icon labeled button" v-on:click="editProfile(index)">
            <i class="ui write icon"></i>
            编辑
          </div>
          <div class="ui red icon labeled button" v-on:click="deleteProfile(index)">
            <i class="ui remove icon"></i>
            删除
          </div>
        </div>
      </div>
    </div>
  </div>
  `
})

/* eslint-disable */
const myApp = new Vue({
/* eslint-enable */
  el: '#app',
  data: {
    profiles: vrouter.config.profiles,
    editingProfile: {
      shadowsocks: {},
      shadowsocksr: {},
      kcptun: {}
    },
    remote: null,
    status: {
      currentGW: '',
      currentGWIP: '',
      currentDns: '',
      currentDnsIP: '',
      openwrtVersion: '',
      bridgeAdapter: '',
      brLanIP: '',
      lanIP: '',
      macAddress: '',
      ssVersion: '',
      ssrVersion: '',
      ktVersion: '',
      isTunnelDnsRunning: true,
      isSsRunning: true,
      isSsrRunning: true,
      isKtRunning: true
    },
    ui: {
      activeLoader: false,
      btnToggleRouterPopup: '',
      proxiesTextDict: {
        ss: 'Shadowsocks',
        ssr: 'ShadowsocksR',
        ssKt: 'Shadowsocks + Kcptun',
        ssrKt: 'ShadowsocksR + Kcptun'
      },
      proxiesModeTextDict: {
        global: '全局模式',
        whitelist: '绕过白名单',
        blacklist: '仅代理黑名单',
        none: '无代理'
      }
    },
    errorMsg: ''
  },
  computed: {
    // className
    circleIcon () {
      return {
        ui: true,
        circle: true,
        icon: true,
        green: this.status.currentGW === 'vrouter'
      }
    },

    ktOthers () {
      let ktKeys = ['address', 'port', 'key', 'crypt', 'mode']
      let others = []
      Object.keys(this.kcptun).forEach((key) => {
        if (!ktKeys.includes(key)) {
          others.push(`${key}=${this.kcptun[key]}`)
        }
      })
      return others.join(';')
    },
    author () {
      return fs.readJsonSync(path.join(__dirname, '..', 'package.json')).author
    },
    vrouterVersion () {
      return app.getVersion()
    }
  },
  methods: {

// Status Tab
    showErrModal (err) {
      if (err.message === 'User did not grant permission.') {
        return
      }
      winston.error(err)
      this.errorMsg = err.toString()
      $(this.$refs.errorModal)
        .modal({
          blurring: true,
          dimmerSettings: {
            opacity: 0.8
          }
        })
        .modal('show')
    },
    toggleProfileEditor (action = 'show') {
      this.resetProxiesDropdown()
      this.resetProxiesForm()
      this.resetProxiesMode()
      $(this.$refs.profileModal)
        .modal({
          dimmerSettings: {
            opacity: 0.2
          },
          detachable: false,
          closable: false
        })
        .modal(action)
    },
    newProfile () {
      this.editingProfile = {
        'name': '新配置',
        'action': 'new',
        'mode': 'none',
        'proxies': 'ss',
        'relayUDP': false,
        'enableTunnelDns': true,
        'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
        'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
        'shadowsocks': {
          'address': '123.123.123.123',
          'port': '8989',
          'password': 'demo-paswd',
          'timeout': 300,
          'method': 'chacha20',
          'fastopen': false
        },
        'shadowsocksr': {
          'address': '123.123.123.123',
          'port': '9999',
          'password': 'demo-paswd',
          'timeout': 300,
          'method': 'chacha20',
          'protocol': 'auth_aes128_md5',
          'protocol_param': '32',
          'obfs': 'tls1.2_ticket_auth',
          'obfs_param': '',
          'others': '',
          'fastopen': false
        },
        'kcptun': {
          'address': '123.123.123.123',
          'port': '5555',
          'key': 'demo-secret',
          'crypt': 'aes-128',
          'mode': 'fast2',
          'others': 'sndwnd=256;rcvwnd=2048;nocomp=true'
        }
      }
      this.toggleProfileEditor('show')
      // this.resetProxiesMode()
    },
    async deleteProfile (index) {
      this.profiles.profiles.splice(index, 1)
      if (this.profiles.activedProfile === index) {
        this.profiles.activedProfile = -1
      } else if (this.profiles.activedProfile > index) {
        this.profiles.activedProfile -= 1
      }
      await vrouter.saveCfg2File()
      $('#profiles .ui.message.dimmed').dimmer('hide')
    },
    editProfile (index) {
      this.editingProfile = JSON.parse(JSON.stringify(this.profiles.profiles[index]))
      this.editingProfile.shadowsocks = this.editingProfile.shadowsocks || {}
      this.editingProfile.shadowsocksr = this.editingProfile.shadowsocksr || {}
      this.editingProfile.kcptun = this.editingProfile.kcptun || {}
      this.editingProfile.action = 'edit'
      this.editingProfile.id = index
      this.toggleProfileEditor('show')
    },
    async applyProfile (index) {
      $('#profiles .ui.message.dimmed').dimmer('hide')
      this.ui.activeLoader = true
      this.profiles.activedProfile = index
      await vrouter.saveCfg2File()
      await this.remote.applyProfile(index)
      await this.refreshInfos()
      this.ui.activeLoader = false
    },
    initDimmer () {
      $('#profiles .ui.message').dimmer({
        opacity: 0,
        on: 'hover',
        duration: 10
      })
    },
    async importProfile () {
      // TODO:
    },
    async saveProfile () {
      // save: proxies, mode, BWList
      this.saveFields('proxies')

      switch (this.editingProfile.proxies) {
        case 'ss':
          this.editingProfile.shadowsocksr = {}
          this.editingProfile.kcptun = {}
          break
        case 'ssr':
          this.editingProfile.shadowsocks = {}
          this.editingProfile.kcptun = {}
          break
        case 'ssKt':
          this.editingProfile.shadowsocksr = {}
          break
        case 'ssrKt':
          this.editingProfile.shadowsocks = {}
          break
        default:
      }

      this.saveFields('mode')
      this.saveFields('BWList')
      // 添加/保存this.editingProfile到this.profiles.profiles
      const action = this.editingProfile.action
      const id = this.editingProfile.id
      delete this.editingProfile.action
      delete this.editingProfile.id
      if (action === 'new') {
        this.profiles.profiles.push(JSON.parse(JSON.stringify(this.editingProfile)))
        setTimeout(() => {
          this.initDimmer()
        }, 500)
      } else {
        this.profiles.profiles[id] = JSON.parse(JSON.stringify(this.editingProfile))
      }
      await vrouter.saveCfg2File()
      this.toggleProfileEditor('hide')

      if (id === this.profiles.activedProfile) {
        await this.applyProfile(id)
      }
    },
    async toggleVrouter () {
      $('*[data-content]').popup('hide')
      this.ui.activeLoader = true
      const to = this.status.currentGW === 'vrouter'
        ? 'default' : 'vrouter'
      try {
        await vrouter.changeRouteTo(to)
        winston.debug(`changed gateway/dns to: ${to}`)
        this.status.currentGW = to
        await this.checkTrafficStatus()
      } catch (err) {
        winston.error(`failed to change gateway/dns to ${to}`)
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async checkTrafficStatus () {
      const [gw, dns] = await vrouter.getCurrentGateway()
      this.status.currentGWIP = gw
      this.status.currentDnsIP = dns
      if (gw === vrouter.config.vrouter.ip && dns === vrouter.config.vrouter.ip) {
        this.status.currentGW = 'vrouter'
        this.status.currentDns = 'vrouter'
      } else {
        this.status.currentGW = 'default'
        this.status.currentDns = 'default'
      }
      const isGWVRouter = this.status.currentGW === 'vrouter'
      this.ui.btnToggleRouterPopup = isGWVRouter ? '停止接管流量' : '开始接管流量'
      // this.toggleBlink(isGWVRouter)
    },

// Proxies Tab
    resetProxiesDropdown () {
      this.$refs.proxiesText.innerHTML = this.ui.proxiesTextDict[this.editingProfile.proxies]
      const items = document.querySelectorAll('#proxies-chains .menu .item')
      ;[...items].forEach((item) => {
        if (item.dataset.value === this.editingProfile.proxies) {
          item.classList.add('active')
          item.classList.add('selected')
        } else {
          item.classList.remove('active')
          item.classList.remove('selected')
        }
      })
    },
    selectProxies (event) {
      const selectedProxies = event.target.dataset.value
      this.resetProxiesForm(selectedProxies)
    },
    resetProxiesForm (proxies) {
      const arr = []
      switch (proxies || this.editingProfile.proxies) {
        case 'ss':
          arr.push('shadowsocks')
          break
        case 'ssr':
          arr.push('shadowsocksr')
          break
        case 'ssKt':
          arr.push('shadowsocks')
          arr.push('kcptun')
          break
        case 'ssrKt':
          arr.push('shadowsocksr')
          arr.push('kcptun')
          break
      }
      this.toggleProxiesForm(arr)
    },
    toggleProxiesForm (selected) {
      winston.debug(`current proxies: ${selected}`)
      const proxies = ['shadowsocks', 'shadowsocksr', 'kcptun']
      proxies.forEach((proxy) => {
        if (selected.includes(proxy)) {
          document.getElementById(proxy).style.display = ''
        } else {
          document.getElementById(proxy).style.display = 'none'
        }
      })
    },
    saveFields (type) {
      switch (type) {
        case 'proxies':
          const selectedProxies = this.$refs.proxiesDropdown.querySelector('.item.active.selected')
          this.editingProfile.proxies = selectedProxies ? selectedProxies.dataset.value : 'ss'
          break
        case 'mode':
          const selectedMode = document.querySelector('#bypass-mode .menu .item.active.selected')
          this.editingProfile.mode = selectedMode ? selectedMode.dataset.value : 'none'
          break
        case 'BWList':
          const blackListRef = ['gfwDomains', 'extraBlackList']
          blackListRef.forEach((ref) => {
            this.editingProfile.selectedBL[ref] = this.$refs[ref].checked
          })

          const whiteListRef = ['chinaIPs', 'lanNetworks', 'extraWhiteList']
          whiteListRef.forEach((ref) => {
            this.editingProfile.selectedWL[ref] = this.$refs[ref].checked
          })
          break
        default:
          throw Error('unkown fields')
      }
    },

// Mode Tab
    resetProxiesMode () {
      this.$refs.proxiesModeText.innerHTML = this.ui.proxiesModeTextDict[this.editingProfile.mode]
      const items = document.querySelectorAll('#bypass-mode .menu .item')
      ;[...items].forEach((item) => {
        if (item.dataset.value === this.editingProfile.mode) {
          item.classList.add('active')
          item.classList.add('selected')
        } else {
          item.classList.remove('active')
          item.classList.remove('selected')
        }
      })
    },
    openExtraList (type) {
      // if (this.ui.editable.mode) {
      return shell.openItem(path.join(vrouter.config.host.configDir, this.firewall[`extra${type}List`]))
      // }
    },
    async updateChinaIPs () {
      if (this.ui.editable.mode) {
        this.ui.activeLoader = true
        try {
          const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.chinaIPs)
          const url = vrouter.config.firewall.chinaIPsUrl
          await vrouter.downloadFile(url, cfgPath)
        } catch (err) {
          winston.error('failed to update chinaIPs')
          this.showErrModal(err)
        } finally {
          this.ui.activeLoader = false
        }
      }
    },
    async updateGfwList () {
      if (!this.ui.editable.mode) {
        return
      }
      this.ui.activeLoader = true
      try {
        const tmp = path.join(os.tmpdir(), 'gfwList.txt')
        const url = vrouter.config.firewall.gfwListUrl
        await vrouter.downloadFile(url, tmp)

        const b64 = await fs.readFile(tmp, 'utf8')
        const content = Buffer.from(b64, 'base64').toString()
        const fpath = path.join(vrouter.config.host.configDir, 'gfwList.txt')
        await fs.outputFile(fpath, content, 'utf8')
      } catch (error) {
        this.showErrModal(error)
      } finally {
        this.ui.activeLoader = false
      }
    },

// System Tab
    async guiLogin () {
      try {
        await vrouter.guiLogin()
        $(this.$refs.loginModal).modal('hide')
      } catch (err) {
        this.showErrModal(err)
      }
    },
    webLogin () {
      shell.openExternal(`http://${vrouter.config.vrouter.ip}`)
    },
    async sshLogin () {
      try {
        await vrouter.sshLogin()
        $(this.$refs.loginModal).modal('hide')
      } catch (err) {
        this.showErrModal(err)
      }
    },
    async showLoginModal () {
      $('*[data-content]').popup('hide')
      $(this.$refs.loginModal)
        .modal({
          blurring: true,
          dimmerSettings: {
            opacity: 0.8
          }
        })
        .modal('show')
    },
    openLogFile () {
      const file = path.join(vrouter.config.host.configDir, 'vrouter.log')
      return shell.openItem(file)
    },
    toggleDevTools () {
      return getCurrentWindow().toggleDevTools()
    },
    showAboutModal () {
      $(this.$refs.aboutModal)
        .modal({
          blurring: true,
          dimmerSettings: {
            opacity: 0.8
          }
        })
        .modal('show')
    },
    goToHomepage () {
      return shell.openExternal('https://github.com/icymind/VRouter')
    },
    async checkInfos () {
      this.status.openwrtVersion = await this.remote.getOpenwrtVersion()
      this.status.bridgeAdapter = await vrouter.changeBridgeAdapter()
      this.status.brLanIP = await this.remote.getIP('br-lan')
      this.status.lanIP = await this.remote.getIP('eth1')
      this.status.macAddress = await this.remote.getMacAddress('eth1')
      this.status.ssVersion = await this.remote.getSsVersion()
      this.status.ssrVersion = await this.remote.getSsrVersion()
      this.status.ktVersion = await this.remote.getKtVersion()
    },
    async refreshInfos () {
      $('*[data-content]').popup('hide')
      this.ui.activeLoader = true
      try {
        await vrouter.changeBridgeAdapter()
        await this.checkTrafficStatus()
        await this.checkInfos()
        await this.checkProxiesStatus()
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async restartVrouterNetwork () {
      this.ui.activeLoader = true
      $('*[data-content]').popup('hide')
      try {
        await this.remote.service('network', 'restart')
        winston.debug('restarted vrouter network')
      } catch (err) {
        winston.error('failed to restart vrouter netowork')
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async shutdownVRouter () {
      this.ui.activeLoader = true
      try {
        await vrouter.changeRouteTo('default')
        winston.debug('reseted gateway/dns to default')
        await vrouter.stopvm('savestate')
        winston.debug('saved vm state')
        app.quit()
      } catch (err) {
        winston.debug('fail to shutdownVRouter')
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async deleteVRouter () {
      this.ui.activeLoader = true
      try {
        await vrouter.changeRouteTo('default')
        winston.debug('reseted gateway/dns to default')
        await vrouter.removeNwWatchdog()
        await vrouter.deletevm(true)
        winston.debug('vm deleted')
        app.quit()
      } catch (err) {
        winston.error('fail to delete vm')
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async resetGW () {
      this.ui.activeLoader = true
      try {
        await vrouter.changeRouteTo('default')
        winston.debug('reseted gateway/dns to default')
        await this.checkTrafficStatus()
      } catch (err) {
        winston.debug('fail to resetGW')
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async checkProxiesStatus () {
      // todo: review
      this.status.isTunnelDnsRunning = await this.remote.isTunnelDnsRunning()
      this.status.isSsRunning = await this.remote.isSsRunning()
      this.status.isSsrRunning = await this.remote.isSsrRunning()
      this.status.isKtRunning = await this.remote.isKtRunning()
    }
  },
  async mounted () {
    try {
      await vrouter.changeBridgeAdapter()
      this.remote = await vrouter.connect()
      await this.checkTrafficStatus()
      await this.checkInfos()
      await this.checkProxiesStatus()
      this.resetProxiesForm()
      winston.info('vrouter started')
    } catch (err) {
      winston.error('vue can not mounted')
      this.showErrModal(err)
    }
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  $('.tabular.menu .item').tab()
  $('.dropdown').dropdown()
  $('*[data-content]').popup()
  $('#profileModal').modal({
    dimmerSettings: {
      opacity: 0.2
    },
    detachable: false,
    closable: false
  })
  $('#profiles .ui.message').dimmer({
    opacity: 0,
    on: 'hover',
    duration: 10
  })
})
