<template>
  <div id="prepare">
    <div class="ui icon message positive" v-for="step of steps">
      <i class="check icon"></i>
      <div class="content">
        <div class="header">{{ step}}</div>
      </div>
    </div>
    <ui-modal v-bind:info="modalInfo"></ui-modal>
  </div>
</template>

<script>
import UIModal from '@/components/Prepare/UIModal.vue'
import VBox from '@/lib/vbox.js'
import Utils from '@/lib/utils.js'
import VRouter from '@/lib/vrouter.js'
import winston from '@/lib/logger.js'

const fs = require('fs-extra')
const path = require('path')
const { app, getCurrentWindow } = require('electron').remote
const { EventEmitter } = require('events')

let vueInstance = null

const installVBOrNotModal = {
  header: '检测 VirtualBox',
  content: '没有检测到 Virtualbox, 请前往<a href="https://www.virtualbox.org/"> Virtualbox 官网 </a>下载安装.',
  buttons: [
    {
      label: '重新检测',
      handler: function () {
        return vueInstance.checkRequirement()
      }
    },
    {
      label: '退出',
      handler () {
        app.quit()
      }
    }
  ],
  show: true,
  closable: false
}

const buildVmOrNotModal = {
  header: '检测虚拟机',
  content: '没有检测到 VRouter 虚拟机, 需要下载 openwrt 官方镜像 ( 5 MB ) 进行构建.',
  buttons: [
    {
      label: '下载并构建',
      handler: function () {
        return vueInstance.buildVm()
      }
    },
    {
      label: '退出',
      handler () {
        app.quit()
      }
    }
  ],
  show: true,
  closable: false
}

const buildingVmModal = {
  header: '构建虚拟机',
  content: '',
  buttons: [
    {
      label: '终止',
      handler: function () {
        return vueInstance.abortBuilding()
      }
    }
  ],
  show: true,
  closable: false
}

const errorModal = {
  header: '构建错误',
  content: '',
  buttons: [
    {
      label: '重试',
      handler: function () {
        return vueInstance.buildVm()
      }
    },
    {
      label: '退出',
      handler: function () {
        return vueInstance.abortBuilding()
      }
    }
  ],
  show: true,
  closable: false
}

const startVMErrorModal = {
  header: '启动错误',
  content: '',
  buttons: [
    {
      label: '重试',
      handler: function () {
        return vueInstance.startVm()
      }
    },
    {
      label: '退出',
      handler: function () {
        app.quit()
      }
    }
  ],
  show: true,
  closable: false
}

const startVmModal = {
  header: '启动虚拟机',
  content: '',
  buttons: [],
  show: true,
  closable: false
}

function adjustModal () {
  const win = getCurrentWindow()
  const size = win.getSize()
  win.setSize(size[0], size[1] + 1)
  win.setSize(size[0], size[1])
}

export default {
  name: 'prepare',
  data () {
    return {
      modalInfo: {
        header: '',
        content: '',
        buttons: [],
        show: false,
        closable: true
      },
      vrouter: {},
      vmName: '',
      steps: []
    }
  },
  components: {
    'ui-modal': UIModal
  },
  methods: {
    async checkRequirement () {
      this.modalInfo.show = false
      if (!(await VBox.isVBInstalled())) {
        winston.info('no virtualbox installed')
        this.modalInfo = installVBOrNotModal
        return
      }
      this.steps.push('check virualbox installation')
      if (!(await VBox.isVmExisted(this.vmName))) {
        winston.info('no vrouter vm detected')
        this.modalInfo = buildVmOrNotModal
        return
      }
      this.steps.push('check virtual machine')
      if (!(await VBox.isVmRunning(this.vmName, this.vrouter.config.openwrt.ip))) {
        winston.info('vrouter vm not running')
        return this.startVm()
      }
      this.steps.push('check virtual machine runing state')
      this.$emit('prepared')
      // emit done
    },
    async buildVm () {
      winston.info('building vm')
      this.modalInfo = buildingVmModal
      const process = new EventEmitter()
      process.on('init', (msg) => {
        this.modalInfo.content += `<li class="ui">${msg}</li>`
        adjustModal()
      })
      try {
        await this.vrouter.build(process)
      } catch (error) {
        winston.error(`build error: ${error}`)
        errorModal.content = `<pre>${error.stack}</pre>`
        this.modalInfo = errorModal
        adjustModal()
        return
      }
      return this.checkRequirement()
    },
    async startVm () {
      this.modalInfo.show = false
      const saved = (await VBox.getVmState(this.vmName)) === 'saved'
      const waitTime = saved ? 10 : 30
      const action = saved ? '恢复' : '启动'
      let time = waitTime
      this.modalInfo = startVmModal
      const interval = setInterval(() => {
        time = time > 0 ? --time : 0
        startVmModal.content = `正在${action}虚拟机, 请稍候...${time}`
      }, 1000)
      try {
        await VBox.start(this.vmName, 'headless')
        await Utils.wait(waitTime * 1000)
        winston.debug('vm started')
      } catch (error) {
        clearInterval(interval)
        winston.error('fail to start vm')
        startVMErrorModal.content = `<pre>${error.stack}</pre>`
        this.modalInfo = startVMErrorModal
        this.modalInfo.show = true
        adjustModal()
        return
      }
      clearInterval(interval)
      return this.checkRequirement()
    },
    async abortBuilding () {
      await VBox.delete(this.vmName)
      app.quit()
    }
  },
  created: async function () {
    vueInstance = this
    // prepare 阶段, 永远使用配置模板, 如果使用旧版本的config.json, 可能会无法正确构建虚拟机
    const templateCfg = path.join(__static, 'config-templates', 'config.json')
    this.vrouter = new VRouter(fs.readJsonSync(templateCfg))
    this.vmName = this.vrouter.name
  },
  mounted: async function () {
    await this.checkRequirement()
  }
}
</script>

<style>
#prepare .list {
  list-style: none !important;
  list-style-type: none;
}
</style>
