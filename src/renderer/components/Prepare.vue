<template>
  <div id="prepare">
    <h2 class="ui header teal">checking Requirement...</h2>
    <ui-modal v-bind:info="modalInfo"></ui-modal>
  </div>
</template>

<script>
import UIModal from '@/components/Prepare/UIModal.vue'
import VBox from '@/lib/vbox.js'
import Utils from '@/lib/utils.js'
import VRouter from '@/lib/vrouter.js'

const fs = require('fs-extra')
const path = require('path')
const { app } = require('electron').remote
const { EventEmitter } = require('events')
const winston = require('winston')

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

const startVmModal = {
  header: '启动虚拟机',
  content: '',
  buttons: [],
  show: true,
  closable: false
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
      vmName: ''
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
      if (!(await VBox.isVmExisted(this.vmName))) {
        winston.info('no vrouter vm detected')
        this.modalInfo = buildVmOrNotModal
        return
      }
      if (!(await VBox.isVmRunning(this.vmName))) {
        winston.info('vrouter vm not running')
        return this.startVm()
      }
      this.$emit('prepared')
      // emit done
    },
    async buildVm () {
      winston.info('building vm')
      this.modalInfo = buildingVmModal
      const process = new EventEmitter()
      process.on('init', (msg) => {
        this.modalInfo.content += `<li class="ui">${msg}</li>`
      })
      try {
        await this.vrouter.build(process)
      } catch (error) {
        errorModal.content = `<pre>${error.stack}</pre>`
        this.modalInfo = errorModal
        return
      }
      return this.checkRequirement()
    },
    async startVm () {
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
        winston.error('fail to start vm')
      }
      clearInterval(interval)
      return this.checkRequirement()
    },
    async abortBuilding () {
      await VBox.delete(this.vmName)
      app.quit()
    }
  },
  async mounted () {
    vueInstance = this
    const appDir = Utils.getAppDir()
    this.vrouter = new VRouter(fs.readJsonSync(path.join(__static, '/config-templates/config.json')))
    this.vmName = this.vrouter.config.virtualbox.vmName
    Utils.configureLog(path.join(appDir, this.vmName + '.log'))
    await this.checkRequirement()
  }
}
</script>

<style>
</style>
