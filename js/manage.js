/* eslint-env jquery */
/* global Vue */

const { VRouter } = require('../js/vrouter-local.js')
const { app } = require('electron').remote

let vrouter = new VRouter()
let remote = null
;(async function () {
  remote = await vrouter.connect()
})()

const myApp = new Vue({
  el: '#app',
  data: {
    blinkIntervals: [],
    currentGW: '',
    shadowsocks: vrouter.config.shadowsocks.server,
    kcptun: vrouter.config.kcptun.server,
    firewall: vrouter.config.firewall,
    hideSSPassword: true,
    hideKtPassword: true,
    ssDisabled: true,
    ktDisabled: true,
    btnToggleRouterPopup: '',
    btnToggleRouterText: '启用VRouter网关'
  },
  computed: {
    btnToggleRouterIcon () {
      return {
        pause: this.currentGW === 'vrouter',
        play: this.currentGW !== 'vrouter',
        icon: true
      }
    },
    currentProtocolText () {
      const isSS = this.firewall.currentProtocol === 'shadowsocks'
      return isSS ? 'Shadowsocks only' : 'Shadowsocks over kcptun'
    }
  },
  methods: {
    async btnToggleRouterHandler () {
      const to = this.currentGW === 'vrouter'
      ? 'wifi' : 'vrouter'
      return vrouter.changeRouteTo(to)
      .then(() => {
        this.currentGW = to
        return this.checkTrafficStatus(to)
      })
    },
    btnShutdownHandler () {
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
          this.blinkIntervals.push(interval)
        })
      } else {
        this.blinkIntervals.forEach(intrvl => clearInterval(intrvl))
        this.intervals.length = 0
        setTimeout(() => {
          icons.forEach((icon) => {
            icon.classList.remove('green')
          })
        }, 2000)
      }
    },
    async checkTrafficStatus (gateway) {
      if (!gateway || !this.currentGW) {
        const [gw] = await vrouter.getCurrentGateway()
        if (gw === vrouter.config.vrouter.ip) {
          this.currentGW = 'vrouter'
        } else {
          this.currentGW = 'wifi'
        }
      }
      const isGWVRouter = this.currentGW === 'vrouter'
      this.btnToggleRouterPopup = isGWVRouter ? '停止接管流量' : '开始接管流量'
      this.btnToggleRouterText = isGWVRouter ? '恢复系统网关' : '启用VRouter网关'
      this.toggleBlink(isGWVRouter)
    },
    btnEditHandler () {
      this.ssDisabled = !this.ssDisabled
      this.hideSSPassword = this.ssDisabled

      if (this.firewall.currentProtocol === 'kcptun') {
        this.ktDisabled = !this.ktDisabled
        this.hideKtPassword = this.ktDisabled
      }
    },
    async saveHandler () {
      this.ssDisabled = true
      this.ktDisabled = true
      this.hideKtPassword = true
      this.hideSSPassword = true

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

        await vrouter.restartCrontab()

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
    resetProxyChain () {
      const isSS = this.firewall.currentProtocol === 'shadowsocks'
      this.$refs.protocolText.innerHTML = isSS ? 'Shadowsocks only' : 'Shadowsocks over kcptun'
    },
    protocolDropdownHandler (event) {
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

      let pre = this.firewall.currentProtocol
      if (this.$refs.protocolText.innerHTML === 'Shadowsocks only') {
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
  },
  mounted () {
    this.checkTrafficStatus()
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  $('.tabular.menu .item').tab()
  $('#proxy-chains').dropdown()
  $('#bypass-mode').dropdown()
  $('.help.circle.link.icon').popup()
  $('.ui.button').popup()
  console.log(myApp)
  // const interval = setInterval(async () => {
  //   const state = vrouter.getVMState()
  //   if (state !== 'running') {
  //     const [gw] = await vrouter.getCurrentGateway()
  //     if (gw === vrouter.config.vrouter.ip) {
  //       await vrouter.changeRouteTo('wifi')
  //     }
  //   }
  //   statusTab.checkTrafficStatus()
  // }, 60000)
})
