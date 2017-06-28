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
    remote: null,
    blinkIntervals: [],
    currentGW: '',
    currentGWIP: '',
    currentDns: '',
    currentDnsIP: '',
    shadowsocks: vrouter.config.shadowsocks.server,
    kcptun: vrouter.config.kcptun.server,
    firewall: vrouter.config.firewall,
    hideSSPassword: true,
    hideKtPassword: true,
    ssDisabled: true,
    ktDisabled: true,
    btnToggleRouterPopup: '',
    btnToggleRouterText: '启用VRouter网关',
    openwrtVersion: '',
    brLanIP: '',
    lanIP: '',
    ssVersion: '',
    ktVersion: '',
    ssStatus: '',
    ktStatus: '',
    refreshing: false,
    proxyModeDisabled: true,
    proxyModeTextDic: {
      global: '全局模式',
      whitelist: '绕过白名单',
      blacklist: '仅黑名单',
      none: '无代理'
    },
    activeLoader: false,
    errorMsg: ''
  },
  computed: {
    author () {
      return fs.readJsonSync(path.join(__dirname, '..', 'package.json')).author
    },
    vrouterVersion () {
      return app.getVersion()
    },
    circleIcon () {
      return {
        ui: true,
        circle: true,
        icon: true,
        green: this.currentGW === 'vrouter'
      }
    },
    cubeIcon () {
      return {
        ui: true,
        huge: true,
        cube: true,
        icon: true,
        teal: this.currentGW === 'vrouter'
      }
    },
    btnToggleRouterIcon () {
      return {
        pause: this.currentGW === 'vrouter',
        play: this.currentGW !== 'vrouter',
        icon: true
      }
    },
    ssStatusIcon () {
      const isRunning = this.ssStatus === '运行中'
      return {
        ui: true,
        check: isRunning,
        remove: !isRunning,
        circle: true,
        teal: isRunning,
        icon: true
      }
    },
    ktStatusIcon () {
      const isRunning = this.ktStatus === '运行中'
      return {
        ui: true,
        check: isRunning,
        remove: !isRunning,
        circle: true,
        teal: isRunning,
        icon: true
      }
    },
    currentProtocolText () {
      return this.resetProxyChain(false)
      // // const isSS = this.firewall.currentProtocol === 'shadowsocks'
      // // return isSS ? '仅 Shadowsocks' : 'Shadowsocks + kcptun'
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
    proxyModeText () {
      return this.proxyModeTextDic[this.firewall.currentMode]
    }
  },
  methods: {
    async btnToggleRouterHandler () {
      $('*[data-content]').popup('hide')
      this.activeLoader = true
      const to = this.currentGW === 'vrouter'
        ? 'wifi' : 'vrouter'
      try {
        await vrouter.changeRouteTo(to)
        this.currentGW = to
        await this.checkTrafficStatus()
      } catch (err) {
        console.log(err)
        this.errorMsg = err.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.activeLoader = false
      }
    },
    async btnMoreHandlerModal () {
      $(this.$refs.moreModal)
        .modal('show')
    },
    async btnShutdownHandler () {
      this.activeLoader = true
      try {
        await vrouter.changeRouteTo('wifi')
        await vrouter.stopVM('savestate')
        app.quit()
      } catch (err) {
        this.errorMsg = err.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.activeLoader = false
      }
      app.quit()
    },
    async btnDeleteHandler () {
      this.activeLoader = true
      try {
        await vrouter.changeRouteTo('wifi')
        await vrouter.deleteVM(true)
        app.quit()
      } catch (err) {
        this.errorMsg = err.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.activeLoader = false
      }
    },
    async btnResetGW () {
      this.activeLoader = true
      try {
        await vrouter.changeRouteTo('wifi')
        await this.checkTrafficStatus()
      } catch (err) {
        this.errorMsg = err.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.activeLoader = false
      }
    },
    async toggleBlink (blink) {
      const icons = [...this.$el.querySelectorAll('#status-tab .ui.circle.icon')]
      this.blinkIntervals.forEach(intrvl => clearInterval(intrvl))
      this.blinkIntervals.length = 0
      setTimeout(() => {
        icons.forEach((icon) => {
          icon.classList.remove('green')
        })
      }, 2000)
      if (blink) {
        icons.forEach((icon) => {
          const interval = setInterval(() => {
            setTimeout(() => {
              $(icon).transition('pulse')
              icon.classList.toggle('green')
            }, Math.random() * 3900)
          }, 4000)
          this.blinkIntervals.push(interval)
        })
      }
    },
    async checkPID () {
      this.ssStatus = await this.remote.getSSStatus()
        .then((output) => {
          if (!output) {
            throw Error('false')
          }
          return Promise.resolve('运行中')
        })
        .catch(() => {
          return Promise.resolve('已停止')
        })
      this.ktStatus = await this.remote.getKTProcess()
        .then((output) => {
          if (!output) {
            throw Error('false')
          }
          return Promise.resolve('运行中')
        })
        .catch(() => {
          return Promise.resolve('已停止')
        })
    },
    async checkVersions () {
      this.openwrtVersion = await this.remote.getOpenwrtVersion()
      this.brLanIP = await this.remote.getIP('br-lan')
      this.lanIP = await this.remote.getIP('eth1')
      this.ssVersion = await this.remote.getSSVersion()
      this.ktVersion = await this.remote.getKTVersion()
    },
    async checkTrafficStatus () {
      const [gw, dns] = await vrouter.getCurrentGateway()
      this.currentGWIP = gw
      this.currentDnsIP = dns
      if (gw === vrouter.config.vrouter.ip && dns === vrouter.config.vrouter.ip) {
        this.currentGW = 'vrouter'
        this.currentDns = 'vrouter'
      } else {
        this.currentGW = 'wifi'
        this.currentDns = 'wifi'
      }
      const isGWVRouter = this.currentGW === 'vrouter'
      this.btnToggleRouterPopup = isGWVRouter ? '停止接管流量' : '开始接管流量'
      this.btnToggleRouterText = isGWVRouter ? '恢复系统网关' : '启用VRouter网关'
      this.toggleBlink(isGWVRouter)
    },
    btnEditHandler () {
      const isDiscards = !this.ssDisabled
      if (isDiscards) {
        this.ssDisabled = true
        this.hideSSPassword = true
        this.ktDisabled = true
        this.hideKtPassword = true
        if (this.firewall.currentProtocol === 'kcptun') {
          this.ktDisabled = true
          this.hideKtPassword = true
        }
        this.resetProxyChain()
      } else {
        this.ssDisabled = false
        this.hideSSPassword = false
        this.ktDisabled = false
        this.hideKtPassword = false
      }
    },
    async saveHandler () {
      this.activeLoader = true
      this.ssDisabled = true
      this.ktDisabled = true
      this.hideKtPassword = true
      this.hideSSPassword = true

      this.syncFileds()

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
        if (this.firewall.currentProtocol === 'kcptun') {
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
        this.errorMsg = err.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.activeLoader = false
      }
    },

    toggleSSPassword () {
      this.hideSSPassword = !this.hideSSPassword
    },
    toggleKtPassword () {
      this.hideKtPassword = !this.hideKtPassword
    },
    resetProxyChain (set = true) {
      const isSS = this.firewall.currentProtocol === 'shadowsocks'
      const text = isSS ? '仅 Shadowsocks' : 'Shadowsocks + kcptun'
      if (set) {
        this.$refs.protocolText.innerHTML = text
      }
      return text
    },
    protocolDropdownHandler (event) {
      const selectedText = event.target.innerHTML.trim()
      if (selectedText === '仅 Shadowsocks') {
        this.ktDisabled = true
        this.hideKtPassword = true
      } else {
        this.ktDisabled = false
        this.hideKtPassword = false
      }
    },
    syncFileds () {
      let protocolChanged = false
      let shadowsocksChanged = false
      let kcptunChanged = false

      let pre = this.firewall.currentProtocol
      if (this.$refs.protocolText.innerHTML === '仅 Shadowsocks') {
        this.firewall.currentProtocol = 'shadowsocks'
      } else {
        this.firewall.currentProtocol = 'kcptun'
      }
      protocolChanged = pre !== this.firewall.currentProtocol

      let SSKeys = ['address', 'port', 'password', 'timeout', 'method', 'fastOpen']
      for (let i = 0; i < SSKeys.length; i++) {
        if (!shadowsocksChanged) {
          shadowsocksChanged = vrouter.config.shadowsocks.server[SSKeys[i]] !== this.$refs[SSKeys[i]].value.trim()
        }
        vrouter.config.shadowsocks.server[SSKeys[i]] = this.$refs[SSKeys[i]].value.trim()
      }

      const newKt = {}
      let ktOthers = this.$refs.ktOthers.value
      ktOthers.split(';').forEach((pair) => {
        const kv = pair.split('=')
        newKt[kv[0].trim()] = kv[1].trim()
      })
      let ktKeys = ['address', 'port', 'key', 'crypt', 'mode']
      for (let i = 0; i < ktKeys.length; i++) {
        let temp = ktKeys[i].split('')
        temp[0] = temp[0].toUpperCase()
        const refKey = `kt${temp.join('')}`

        newKt[ktKeys[i]] = this.$refs[refKey].value.trim()
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
      return { protocolChanged, shadowsocksChanged, kcptunChanged }
    },
    resetProxyMode () {
      this.$refs.proxyModeText.innerHTML = this.proxyModeTextDic[this.firewall.currentMode]
    },
    btnProxyModeHandler () {
      if (this.proxyModeDisabled) {
        this.proxyModeDisabled = false
      } else {
        this.proxyModeDisabled = true
        this.resetProxyMode()
      }
    },
    async refreshInfos () {
      $('*[data-content]').popup('hide')
      this.activeLoader = true
      try {
        await this.checkTrafficStatus()
        await this.checkVersions()
        await this.checkPID()
      } catch (err) {
        this.errorMsg = err.message
        $(this.$refs.errorModal).moal('show')
      } finally {
        this.activeLoader = false
      }
    },
    async saveProxyModeHandler () {
      this.proxyModeDisabled = true
      this.activeLoader = true

      let whiteList = {}
      let blackList = {}

      const selectedText = this.$refs.proxyModeText.innerHTML.trim()
      let mode = null
      Object.keys(this.proxyModeTextDic).forEach((key) => {
        if (this.proxyModeTextDic[key] === selectedText) {
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
        this.activeLoader = false
      }
    },
    async restartVrouterNetwork () {
      this.activeLoader = true
      $('*[data-content]').popup('hide')
      await this.remote.restartNetwork()
      this.activeLoader = false
    },
    openExtraBlackList () {
      if (!this.proxyModeDisabled) {
        shell.openItem(path.join(vrouter.config.host.configDir, this.firewall.extraBlackList))
      }
    },
    openExtraWhiteList () {
      if (!this.proxyModeDisabled) {
        shell.openItem(path.join(vrouter.config.host.configDir, this.firewall.extraWhiteList))
      }
    },
    async updateChinaIPs () {
      if (this.proxyModeDisabled) {
        return
      }
      this.activeLoader = true
      try {
        const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.chinaIPs)
        const url = vrouter.config.firewall.chinaIPsUrl
        await vrouter.downloadFile(url, cfgPath)
      } catch (error) {
        this.errorMsg = error.message
        $(this.$refs.errorModal).modal('show')
      } finally {
        this.activeLoader = false
      }
    },
    async updateGfwList () {
      if (this.proxyModeDisabled) {
        return
      }
      this.activeLoader = true
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
        this.activeLoader = false
      }
    },
    async guiLogin () {
      const cmd = `VBoxManage startvm ${vrouter.config.vrouter.name} --type separate`
      await vrouter.localExec(cmd)
      $(this.$refs.loginModal).modal('hide')
    },
    async loginVRouter () {
      const applescript = String.raw`
      tell application "Terminal"
          do script ("ssh root@${vrouter.config.vrouter.ip};")
          activate
          delay 1
          tell application "System Events" to keystroke "root"
          tell application "System Events" to key code 36
      end tell
      `
      const cmd = `osascript -e '${applescript}'`
      try {
        await vrouter.localExec(cmd)
      } catch (err) {
        console.log(err)
      }
    },
    async loginVRouterModal () {
      // alert('登录后请尽量避免修改虚拟机.')
      $('*[data-content]').popup('hide')
      const vueApp = this
      $(this.$refs.loginModal)
        .modal({
          async onDeny () {
            await vueApp.loginVRouter()
          }
        })
        .modal('show')
    },
    btnConsole () {
      return getCurrentWindow().toggleDevTools()
    },
    async btnAbout () {
      $(this.$refs.aboutModal).modal('show')
    },
    goToHomepage () {
      return shell.openExternal('https://github.com/icymind/VRouter')
    }
  },
  async mounted () {
    try {
      this.remote = await vrouter.connect()
      await this.checkTrafficStatus()
      await this.checkVersions()
      await this.checkPID()
    } catch (err) {
      alert(err)
    }
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  $('.tabular.menu .item').tab()
  $('.dropdown').dropdown()
  $('*[data-content]').popup()
})
