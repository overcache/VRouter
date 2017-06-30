/* eslint-env jquery */
/* global Vue alert */

const { VRouter } = require('../js/vrouter-local.js')
const { app, getCurrentWindow } = require('electron').remote
const { shell } = require('electron')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')

let vrouter = new VRouter()

const myApp = new Vue({
  el: '#app',
  data: {
    shadowsocks: vrouter.config.shadowsocks.server,
    // todo
    shadowsocksr: vrouter.config.shadowsocks.server,
    kcptun: vrouter.config.kcptun.server,
    firewall: vrouter.config.firewall,
    remote: null,
    status: {
      currentGW: '',
      currentGWIP: '',
      currentDns: '',
      currentDnsIP: '',
      openwrtVersion: '',
      brLanIP: '',
      lanIP: '',
      macAddress: '',
      ssVersion: '',
      ktVersion: '',
      isSsRunning: true,
      isKtRunning: true
    },
    ui: {
      blinkIntervals: [],
      pwdVisible: {
        ss: false,
        ssr: false,
        kt: false
      },
      editable: {
        proxies: false,
        mode: false
      },
      activeLoader: false,
      btnToggleRouterPopup: '',
      proxiesTextDic: {
        ss: '仅 Shadowsocks',
        ssr: '仅 ShadowsocksR',
        ssKt: 'Shadowsocks + Kcptun',
        ssrKt: 'ShadowsocksR + Kcptun'
      },
      proxiesModeTextDic: {
        global: '全局模式',
        whitelist: '绕过白名单',
        blacklist: '仅黑名单',
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
    proxiesModeText () {
      return this.ui.proxiesModeTextDic[this.firewall.currentMode]
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
      console.log(err)
      this.errorMsg = err.message
      $(this.$refs.errorModal).modal('show')
    },
    async toggleVrouter () {
      $('*[data-content]').popup('hide')
      this.ui.activeLoader = true
      const to = this.status.currentGW === 'vrouter'
        ? 'wifi' : 'vrouter'
      try {
        await vrouter.changeRouteTo(to)
        this.status.currentGW = to
        await this.checkTrafficStatus()
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async toggleBlink (blink) {
      const icons = [...this.$el.querySelectorAll('#status-tab .ui.circle.icon')]
      this.ui.blinkIntervals.forEach(intrvl => clearInterval(intrvl))
      this.ui.blinkIntervals.length = 0
      setTimeout(() => {
        icons.forEach((icon) => {
          icon.classList.remove('green')
        })
      }, 4010)
      if (blink) {
        icons.forEach((icon) => {
          const interval = setInterval(() => {
            setTimeout(() => {
              $(icon).transition('pulse')
              icon.classList.toggle('green')
            }, Math.random() * 3900)
          }, 4000)
          this.ui.blinkIntervals.push(interval)
        })
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
        this.status.currentGW = 'wifi'
        this.status.currentDns = 'wifi'
      }
      const isGWVRouter = this.status.currentGW === 'vrouter'
      this.ui.btnToggleRouterPopup = isGWVRouter ? '停止接管流量' : '开始接管流量'
      this.toggleBlink(isGWVRouter)
    },

// Proxies Tab
    editProxies () {
      const editing = this.ui.editable.proxies
      this.ui.editable.proxies = !editing
      Object.keys(this.ui.pwdVisible).forEach((key) => {
        this.ui.pwdVisible[key] = this.ui.editable.proxies
      })
      this.resetProxiesDropdown()
      this.resetProxiesForm()
    },
    async applyProxies () {
      this.ui.activeLoader = true

      Object.keys(this.ui.pwdVisible).forEach((key) => {
        this.ui.pwdVisible[key] = false
      })
      this.ui.editable.proxies = false

      // 只保存当前选择的代理的配置
      this.saveFields('proxies')
      this.saveCurrentProxiesFields()

      try {
        await vrouter.saveConfig()

        // 即使ss或者kcptun配置改动, 而协议链没动, 也需要重新生成firewall配置. 不然iptables无法绕过服务器地址.
        // 即使ss没动, 也应该重新生成配置文件, 确保虚拟机配置和当前一致
        await vrouter.generateConfig('shadowsocks')
        await vrouter.scpConfig('shadowsocks')
        await this.remote.restartShadowsocks()

        await vrouter.generateConfig('kcptun')
        await vrouter.scpConfig('kcptun')

        await vrouter.generateWatchdog()
        await vrouter.scpConfig('watchdog')
        if (this.firewall.currentProxies.indexOf('kt') >= 0) {
          await vrouter.enableService('kcptun')
          await this.remote.restartKcptun()
        } else {
          await vrouter.disabledService('kcptun')
          await this.remote.stopKcptun()
            .catch(e => console.log(e))
        }
        await vrouter.restartCrontab()

        await vrouter.generateFWRules(null, null, true)
        await vrouter.scpConfig('firewall')
        await this.remote.restartFirewall()

        await this.refreshInfos()
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    togglePwdVsblt (type) {
      this.ui.pwdVisible[type] = !this.ui.pwdVisible[type]
    },
    resetProxiesDropdown () {
      this.$refs.proxiesText.innerHTML = this.ui.proxiesTextDic[this.firewall.currentProxies]
    },
    selectProxies (event) {
      const selectedProxies = event.target.dataset.value
      this.resetProxiesForm(selectedProxies)
    },
    resetProxiesForm (proxies) {
      const arr = []
      switch (proxies || this.firewall.currentProxies) {
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
      console.log(arr)
      this.toggleProxiesForm(arr)
    },
    toggleProxiesForm (selected) {
      const proxies = ['shadowsocks', 'shadowsocksr', 'kcptun']
      proxies.forEach((proxy) => {
        if (selected.includes(proxy)) {
          document.getElementById(proxy).style.display = ''
        } else {
          document.getElementById(proxy).style.display = 'none'
        }
      })
    },
    saveCurrentProxiesFields () {
      const currentProxies = vrouter.config.firewall.currentProxies
      switch (currentProxies) {
        case 'ss':
          this.saveFields('shadowscoks')
          break
        case 'ssr':
          this.saveFields('shadowsocksr')
          break
        case 'ssKt':
          this.saveFields('shadowscoks')
          this.saveFields('kcptun')
          break
        case 'ssrKt':
          this.saveFields('shadowsocksr')
          this.saveFields('kcptun')
          break
        default:
          throw Error('unkown current proxies')
      }
    },
    async restartCurrentProxies () {
      const currentProxies = vrouter.config.firewall.currentProxies
      switch (currentProxies) {
        case 'ss':
          vrouter.generateConfig('shadowscoks')
          vrouter.scpConfig('shadowscoks')
          this.remote.restartShadowsocks()
          break
        case 'ssr':
          this.saveFields('ssr')
          break
        case 'ssKt':
          this.saveFields('ss')
          this.saveFields('kt')
          break
        case 'ssrKt':
          this.saveFields('ssr')
          this.saveFields('kt')
          break
        default:
          throw Error('unkown current proxies')
      }
    },
    saveAllFileds () {
      let proxiesChanged = false
      let shadowsocksChanged = false
      let kcptunChanged = false

      let pre = this.firewall.currentProxies
      Object.keys(this.ui.proxiesTextDic).forEach((key) => {
        if (this.ui.proxiesTextDic[key] === this.$refs.proxiesText.innerHTML.trim()) {
          this.firewall.currentProxies = key
        }
      })
      proxiesChanged = pre !== this.firewall.currentProxies

      let SsKeys = ['ssAddress', 'ssPort', 'ssPassword', 'ssTimeout', 'ssMethod', 'ssFastOpen']
      for (let i = 0; i < SsKeys.length; i++) {
        if (!shadowsocksChanged) {
          shadowsocksChanged = vrouter.config.shadowsocks.server[SsKeys[i]] !== this.$refs[SsKeys[i]].value.trim()
        }
        vrouter.config.shadowsocks.server[SsKeys[i]] = this.$refs[SsKeys[i]].value.trim()
      }

      const newKt = {}
      let ktOthers = this.$refs.ktOthers.value
      ktOthers.split(';').forEach((pair) => {
        const kv = pair.split('=')
        newKt[kv[0].trim()] = kv[1].trim()
      })
      let ktKeys = ['ktAddress', 'ktPort', 'ktKey', 'ktCrypt', 'ktMode']
      for (let i = 0; i < ktKeys.length; i++) {
        const key = ktKeys.substr(2).toLowerCase()
        newKt[key] = this.$refs[ktKeys[i]].value.trim()
      }
      if (Object.keys(this.kcptun).length !== Object.keys(newKt).length) {
        kcptunChanged = true
      } else {
        Object.keys(newKt).forEach((key) => {
          if (!kcptunChanged) {
            kcptunChanged = newKt[key] !== this.kcptun[key]
          }
          this.kcptun[key] = newKt[key]
        })
      }
      return { proxiesChanged, shadowsocksChanged, kcptunChanged }
    },
    saveFields (type) {
      switch (type) {
        case 'proxies':
          const selected = this.$refs.proxiesDropdown.querySelector('.item.active.selected')
          if (selected) {
            this.firewall.currentProxies = selected.dataset.value
          } else {
            console.log('proxies not selected')
          }
          break
        case 'shadowscoks':
          let ssFields = ['ssAddress', 'ssPort', 'ssPassword', 'ssTimeout', 'ssMethod', 'ssFastOpen']
          ssFields.forEach((field) => {
            const key = field.substr(2).toLowerCase()
            vrouter.config.shadowsocks.server[key] = this.$refs[field].value.trim()
          })
          break
        case 'shadowsocksr':
          let ssrFields = ['ssrAddress', 'ssrPort', 'ssrPassword', 'ssrTimeout', 'ssrMethod', 'ssrFastOpen']
          ssrFields.forEach((field) => {
            const key = field.substr(2).toLowerCase()
            vrouter.config.shadowsocksr.server[key] = this.$refs[field].value.trim()
          })
          // vrouter.config.shadowsocksr.server.others = this.$refs.ssrOthers.value.trim()
          break
        case 'kcptun':
          let ktFields = ['ktAddress', 'ktPort', 'ktKey', 'ktCrypt', 'ktMode']
          ktFields.forEach((field) => {
            const key = field.substr(2).toLowerCase()
            vrouter.config.kcptun.server[key] = this.$refs[field].value.trim()
          })
          vrouter.config.kcptun.server.others = this.$refs.ktOthers.value.trim()
          break
        default:
          throw Error('unkown fields')
      }
    },

// Mode Tab
    resetProxiesMode () {
      this.$refs.proxiesModeText.innerHTML = this.ui.proxiesModeTextDic[this.firewall.currentMode]
    },
    editProxiesMode () {
      this.ui.editable.mode = !this.ui.editable.mode
      this.resetProxiesMode()
    },
    async applyProxiesMode () {
      this.ui.modeDisabled = true
      this.ui.activeLoader = true

      let whiteList = {}
      let blackList = {}

      const selectedText = this.$refs.proxiesModeText.innerHTML.trim()
      let mode = null
      Object.keys(this.ui.proxiesModeTextDic).forEach((key) => {
        if (this.ui.proxiesModeTextDic[key] === selectedText) {
          mode = key
        }
      })
      this.firewall.currentMode = mode

      const blackListRef = ['gfwDomains', 'extraBlackList']
      blackListRef.forEach((ref) => {
        if (this.$refs[ref].checked) {
          blackList[ref] = true
        }
      })
      this.firewall.selectedBL = blackList

      const whiteListRef = ['chinaIPs', 'lanNetworks', 'extraWhiteList']
      whiteListRef.forEach((ref) => {
        if (this.$refs[ref].checked) {
          whiteList[ref] = true
        }
      })
      this.firewall.selectedWL = whiteList

      try {
        await vrouter.saveConfig()

        await vrouter.generateIPsets(true)
        await vrouter.scpConfig('ipset')
        await vrouter.generateDnsmasqCf(true)
        await vrouter.scpConfig('dnsmasq')
        await this.remote.restartDnsmasq()

        await vrouter.generateFWRules(null, null, true)
        await vrouter.scpConfig('firewall')
        await this.remote.restartFirewall()
      } catch (error) {
        this.errorMsg = error.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.ui.activeLoader = false
      }
    },
    openExtraList (type) {
      if (this.ui.editable.mode) {
        shell.openItem(path.join(vrouter.config.host.configDir, this.firewall[`extra${type}List`]))
      }
    },
    async updateChinaIPs () {
      if (this.ui.editable.mode) {
        this.ui.activeLoader = true
        try {
          const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.chinaIPs)
          const url = vrouter.config.firewall.chinaIPsUrl
          await vrouter.downloadFile(url, cfgPath)
        } catch (err) {
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
        console.log(error)
        this.errorMsg = error.message
        $(this.$refs.errorModal).modal('show')
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
        .modal('show')
    },
    toggleDevTools () {
      return getCurrentWindow().toggleDevTools()
    },
    showAboutModal () {
      $(this.$refs.aboutModal).modal('show')
    },
    goToHomepage () {
      return shell.openExternal('https://github.com/icymind/VRouter')
    },
    async checkInfos () {
      this.status.openwrtVersion = await this.remote.getOpenwrtVersion()
      this.status.brLanIP = await this.remote.getIP('br-lan')
      this.status.lanIP = await this.remote.getIP('eth1')
      this.status.macAddress = await this.remote.getMacAddress('eth1')
      this.status.ssVersion = await this.remote.getSsVersion()
      this.status.ktVersion = await this.remote.getKtVersion()
    },
    async refreshInfos () {
      $('*[data-content]').popup('hide')
      this.ui.activeLoader = true
      try {
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
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async shutdownVRouter () {
      this.ui.activeLoader = true
      try {
        await vrouter.changeRouteTo('wifi')
        await vrouter.stopvm('savestate')
        app.quit()
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async deleteVRouter () {
      this.ui.activeLoader = true
      try {
        await vrouter.changeRouteTo('wifi')
        await vrouter.deletevm(true)
        app.quit()
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async resetGW () {
      this.ui.activeLoader = true
      try {
        await vrouter.changeRouteTo('wifi')
        await this.checkTrafficStatus()
      } catch (err) {
        this.showErrModal(err)
      } finally {
        this.ui.activeLoader = false
      }
    },
    async checkProxiesStatus () {
      // todo: review
      this.status.isSsRunning = await this.remote.isSsRunning()
      this.status.isKtRunning = await this.remote.isKtRunning()
    }
  },
  async mounted () {
    try {
      this.remote = await vrouter.connect()
      await this.checkTrafficStatus()
      await this.checkInfos()
      await this.checkProxiesStatus()
      this.resetProxiesForm()
    } catch (err) {
      this.showErrModal(err)
    }
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  $('.tabular.menu .item').tab()
  $('.dropdown').dropdown()
  $('*[data-content]').popup()
})
