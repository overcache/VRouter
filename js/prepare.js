/* eslint-env jquery */
/* global Vue */
const { app, getCurrentWindow } = require('electron').remote
const path = require('path')
const fs = require('fs-extra')
const url = require('url')
const { VRouter } = require('../js/vrouter-local.js')
const { getAppDir } = require('../js/helper.js')

function redirect () {
  window.location.replace(url.format({
    pathname: path.join(__dirname, '../html/index.html'),
    protocol: 'file',
    slashes: true
  }))
}
function adjustModal () {
  const win = getCurrentWindow()
  const size = win.getSize()
  win.setSize(size[0], size[1] + 1)
  win.setSize(size[0], size[1])
}

function buildVmListener (msg) {
  vue.data.content += `<li class="ui">${msg}</li>`
  adjustModal()
}
async function buildVmHandler (vrouter) {
  vue.data.buttons = [{
    label: '终止',
    async handler () {
      await vrouter.deletevm(true)
      app.quit()
    }
  }]
  vrouter.process.on('build', buildVmListener)
  vue.data.header = '构建虚拟机'
  vue.data.content = ''
  try {
    await vrouter.buildvm()
    vue.data.content += `<li class="ui">等待虚拟机重新启动</li>`
    await vrouter.startvm('headless', 30000)
    vue.hide()
    return checkRequirement(vrouter)
  } catch (err) {
    vue.data.content += `<br>${err}`
    vue.data.buttons = [
      {
        label: '重试',
        async handler () {
          vrouter.process.removeListener('build', buildVmListener)
          return buildVmHandler(vrouter)
        }
      },
      {
        label: '退出',
        async handler () {
          await vrouter.deletevm(true)
          app.quit()
        }
      }
    ]
  }
}

Vue.component('ui-modal', {
  props: ['data'],
  template: String.raw`
  <div class="ui basic modal" id="modal">
    <h4>{{ data.header }}</h4>
    <div class="ui divider hidden"></div>
    <p v-html="data.content"></p>
    <div class="ui button teal" v-for="button in data.buttons" v-on:click="button.handler">
      {{ button.label }}
    </div>
  </div>
  `
})

const vue = new Vue({
  el: '#app',
  data: {
    data: {
      header: '',
      content: '',
      buttons: [],
      closable: false
    }
  },
  methods: {
    show () {
      $(`#${this.$el.id} .ui.modal`)
      .modal({
        // dimmerSettings: {
          // opacity: 0.2
        // },
        closable: this.$data.data.closable,
        detachable: false
      })
      .modal('show')
    },
    hide () {
      $(`#${this.$el.id} .ui.modal`)
        .modal('hide')
    }
  }
})

async function checkRequirement (vrouter) {
  let ret = await vrouter.isVBInstalled()
  if (!ret) {
    vue.data = {
      header: '检测 VirtualBox',
      content: '没有检测到 Virtualbox, 请前往<a href="https://www.virtualbox.org/"> Virtualbox 官网 </a>下载安装.',
      buttons: [
        {
          label: '重新检测',
          handler () {
            vue.hide()
            return checkRequirement(vrouter)
          }
        },
        {
          label: '退出',
          handler () {
            app.quit()
          }
        }
      ],
      closable: false
    }
    vue.show()
    return false
  }
  ret = await vrouter.isVRouterExisted()
  if (!ret) {
  // if (true) {
    vue.data = {
      header: '检测虚拟机',
      content: '没有检测到 VRouter 虚拟机, 需要下载 openwrt 官方镜像(5MB)进行构建.',
      buttons: [
        {
          label: '下载并构建',
          async handler () {
            await buildVmHandler(vrouter)
          }
        },
        {
          label: '退出',
          handler () {
            app.quit()
          }
        }
      ],
      closable: false
    }
    vue.show()
    return false
  }
  ret = await vrouter.getvmState()
  if (ret !== 'running') {
    const waitTime = ret === 'poweroff' ? 30 : 10
    let countdown = waitTime
    vue.data = {
      header: '启动虚拟机',
      content: '正在启动虚拟机, 请稍候',
      buttons: [],
      closable: false
    }
    vue.show()
    const interval = setInterval(() => {
      let time = countdown > 0 ? --countdown : 0
      vue.data.content = `正在启动虚拟机, 请稍候...${time}`
    }, 1000)
    await vrouter.startvm('headless', waitTime * 1000)
    clearInterval(interval)
    vue.hide()
  }
  redirect()
}

document.addEventListener('DOMContentLoaded', async () => {
  let cfgPath
  let json
  try {
    cfgPath = path.join(getAppDir(), 'VRouter', 'config.json')
    json = fs.readJsonSync(cfgPath)
  } catch (err) {
    console.log('使用config.json模板')
    cfgPath = path.join(__dirname, '..', 'config', 'config.json')
    json = fs.readJsonSync(cfgPath)
  }
  const vrouter = new VRouter(json)
  await vrouter.upgradeCfg()
  checkRequirement(vrouter)
})
