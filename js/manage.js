/* eslint-env jquery */

// const fs = require('fs-extra')
// const path = require('path')
const { VRouter } = require('../js/vrouter-local.js')
const { app } = require('electron').remote
// const dom = require('../js/vrouter-dom.js')

// const cfgPath = path.join(__dirname, '..', 'config', 'config.json')
// const vrouter = new VRouter(fs.readJsonSync(cfgPath))
let vrouter = new VRouter()
let remote = null
;(async function () {
  remote = await vrouter.connect()
})()

// TODO: mem leak
// TODO: vm pulse

const statusTab = new Vue({
  el: '#status-tab',
  data: {
    intervals: [],
    currentGW: '',
    toggleRouterMsg: '',
    toggleRouterLabel: '启用VRouter网关',
    firewall: vrouter.config.firewall
  },
  computed: {
    toggleRouterClass () {
      return {
        pause: this.currentGW === 'vrouter',
        play: this.currentGW !== 'vrouter',
        icon: true
      }
    },
    currentProtocolText () {
      return this.firewall.currentProtocol === 'shadowsocks' ? 'Shadowsocks only' : 'Shadowsocks over kcptun'
    }
  },
  methods: {
    async toggleRouterHandler () {
      const to = this.currentGW === 'vrouter'
        ? 'wifi' : 'vrouter'
      return vrouter.changeRouteTo(to)
        .then(() => {
          this.currentGW = to
          return this.checkTrafficStatus(to)
        })
    },
    shutdownHandler () {
      return vrouter.changeRouteTo('wifi')
        .then(() => {
          return vrouter.stopVM('savestate')
        })
        .then(() => {
          app.quit()
        })
    },
    async toggleBlink (blink) {
      const icons = [...this.$el.querySelectorAll('.ui.circle.icon')]
      if (blink) {
        icons.forEach((icon) => {
          const interval = setInterval(() => {
            setTimeout(() => {
              $(icon).transition('pulse')
              icon.classList.toggle('green')
            }, Math.random() * 1400)
          }, 1500)
          this.intervals.push(interval)
        })
      } else {
        this.intervals.forEach(intrvl => clearInterval(intrvl))
        this.intervals.length = 0
        setTimeout(() => {
          icons.forEach((icon) => {
            icon.classList.remove('green')
          })
        }, 2000)
      }
    },
    async checkTrafficStatus (gateway) {
      // let current = this.currentGW
      if (!gateway || !this.currentGW) {
        const [gw] = await vrouter.getCurrentGateway()
        // if (gateway === vrouter.config.vrouter.ip) {
        if (gw === vrouter.config.vrouter.ip) {
          this.currentGW = 'vrouter'
        } else {
          this.currentGW = 'wifi'
        }
      }
      let blink = this.currentGW === 'vrouter'
      this.toggleRouterMsg = blink ? '停止接管流量' : '开始接管流量'
      this.toggleRouterLabel = blink ? '恢复系统网关' : '启用VRouter网关'
      this.toggleBlink(blink)
    }
  },
  mounted () {
    this.checkTrafficStatus()
  }
})
const proxyTab = new Vue({
  el: '#proxy-tab',
  data: {
    shadowsocks: vrouter.config.shadowsocks,
    kcptun: vrouter.config.kcptun,
    firewall: vrouter.config.firewall,
    hideSSPassword: true,
    hideKtPassword: true,
    disabled: true,
    ktDisabled: true
  },
  computed: {
    currentProtocolText () {
      return this.firewall.currentProtocol === 'shadowsocks' ? 'Shadowsocks only' : 'Shadowsocks over kcptun'
    },
    ktOthers () {
      let ktKeys = ['address', 'port', 'key', 'crypt', 'mode']
      let others = []
      Object.keys(this.kcptun.server).forEach((key) => {
        if (!ktKeys.includes(key)) {
          others.push(`${key}=${this.kcptun.server[key]}`)
        }
      })
      return others.join(';')
    }
  },
  methods: {
    editHandler () {
      if (this.disabled) {
        this.hideSSPassword = false
        this.disabled = false
        if (this.firewall.currentProtocol === 'kcptun') {
          this.ktDisabled = false
          this.hideKtPassword = false
        }
      } else {
        this.resetDropdown()
        this.disabled = true
        this.ktDisabled = true
        this.hideKtPassword = true
        this.hideSSPassword = true
      }
    },
    async saveHandler () {
      this.disabled = true
      this.ktDisabled = true
      this.hideKtPassword = true
      this.hideSSPassword = true
      // TODO: take care of kcptun
      // TODO: unneccissary restart
      // TODO: unneccissary watchdog
      const changed = this.syncFileds()
      if (!changed.shadowsocksChanged && !changed.kcptunChanged && !changed.protocolChanged) {
        return
      }
      await vrouter.saveConfig()

      if (changed.shadowsocksChanged) {
        await vrouter.generateConfig('shadowsocks')
        await vrouter.scpConfig('shadowsocks')
        await remote.restartShadowsocks()
      }

      if (this.firewall.currentProtocol === 'kcptun' && changed.kcptunChanged) {
        await vrouter.generateConfig('kcptun')
        await vrouter.scpConfig('kcptun')
      }

      if (changed.protocolChanged) {
        await vrouter.generateWatchdog()
        await vrouter.scpConfig('watchdog')
        if (this.firewall.currentProtocol === 'kcptun') {
          await vrouter.enableService('kcptun')
        } else {
          await vrouter.disabledService('kcptun')
          await remote.stopKcptun()
            .catch(e => console.log(e))
        }

        await vrouter.restartCrontab ()

        await vrouter.generateFWRules(null, null, true)
        await vrouter.scpConfig('firewall')

        await remote.restartFirewall()
      }
    },
    toggleSSPassword () {
      this.hideSSPassword = !this.hideSSPassword
    },
    toggleKtPassword () {
      this.hideKtPassword = !this.hideKtPassword
    },
    resetDropdown () {
      // const text = this.$el.querySelector('div.text')
      // text.innerHTML = this.currentProtocol
      this.$refs.protocolText.innerHTML = this.firewall.currentProtocol === 'shadowsocks' ? 'Shadowsocks only' : 'Shadowsocks over kcptun'

    },
    changeProtocolText (event) {
      // const pre = this.$refs.protocolText.innerHTML
      const selectedText = event.target.innerHTML.trim()
      if (selectedText === 'Shadowsocks only') {
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

      let pre = vrouter.config.firewall.currentProtocol
      if (this.$refs.protocolText.innerHTML === 'Shadowsocks only') {
        vrouter.config.firewall.currentProtocol = 'shadowsocks'
      } else {
        vrouter.config.firewall.currentProtocol = 'kcptun'
      }
      protocolChanged = pre !== vrouter.config.firewall.currentProtocol

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
      if (Object.keys(this.kcptun.server).length !== Object.keys(newKt).length) {
        kcptunChanged = true
      } else {
        Object.keys(newKt).forEach((key) => {
          if (!kcptunChanged) {
            kcptunChanged = newKt[key] !== this.kcptun.server[key]
          }
          this.kcptun.server[key] = newKt[key]
        })
      }
      return { protocolChanged, shadowsocksChanged, kcptunChanged }
    }
  }
})
document.addEventListener('DOMContentLoaded', async () => {
  $('.tabular.menu .item').tab()
  $('#proxy-chains').dropdown()
  $('#bypass-mode').dropdown()
  $('.help.circle.link.icon').popup()
  $('.ui.button').popup()
  const interval = setInterval(async () => {
    const state = vrouter.getVMState()
    if (state !== 'running') {
      const [gw] = await vrouter.getCurrentGateway()
      if (gw === vrouter.config.vrouter.ip) {
        await vrouter.changeRouteTo('wifi')
      }
    }
    statusTab.checkTrafficStatus()
  }, 60000)
})
