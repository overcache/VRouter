const { exec } = require('child_process')
const Client = require('ssh2').Client
const { URL } = require('url')
const http = require('http')
const https = require('https')
const fs = require('fs-extra')
const path = require('path')
const { VRouterRemote } = require('./vrouter-remote.js')
const { getAppDir } = require('./helper.js')
const packageJson = require('../package.json')
const dns = require('dns')
const crypto = require('crypto')
const sudo = require('sudo-prompt')
const { EventEmitter } = require('events')
const os = require('os')
const winston = require('winston')

let VBoxManage

if (os.platform() === 'darwin') {
  VBoxManage = '/usr/local/bin/VBoxManage'
} else if (os.platform() === 'win32') {
  VBoxManage = 'C:\\Program Files\\Oracle\\VirtualBox'
}

class VRouter {
  constructor (cfgObj) {
    let config
    let cfg = path.join(getAppDir(), packageJson.name, 'config.json')
    if (!cfgObj) {
      try {
        config = fs.readJsonSync(cfg)
      } catch (err) {
        const template = path.join(__dirname, '..', 'config', 'config.json')
        config = fs.readJsonSync(template)
        fs.copySync(template, cfg)
      }
      if (!config.host.configDir) {
        config.host.configDir = path.join(getAppDir(), packageJson.name)
      }
    } else {
      config = cfgObj
    }
    this.config = config
    this.process = new EventEmitter()
    this.remote = null
    winston.configure({
      transports: [
        new (winston.transports.File)({
          filename: path.join(this.config.host.configDir, 'vrouter.log'),
          level: 'info'
        }),
        new (winston.transports.Console)({
          level: 'debug'
        })
      ]
    })
  }

  // os
  wait (time) {
    return new Promise(resolve => setTimeout(resolve, time))
  }
  sudoExec (cmd) {
    const option = {
      name: 'VRouter',
      icns: path.join(__dirname, '..', 'img', 'icon.icns')
    }
    return new Promise((resolve, reject) => {
      sudo.exec(cmd, option, (err, stdout, stderr) => {
        if (err) {
          // console.log(err)
          reject(err)
        } else {
          // stderr && console.log(stderr)
          resolve(stdout || stderr)
        }
      })
    })
  }
  localExec (cmd) {
    // const specialCmd = [
      // /^VBoxManage hostonlyif .*$/ig,
      // /^VBoxManage startvm/ig,
      // /^VBoxManage controlvm .* poweroff/ig,
      // /^VBoxManage convertfromraw .ig
     // ]

    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          // console.log(err)
          reject(err)
        } else {
          // stderr && console.log(stderr)
          resolve(stdout || stderr)
        }
      })
    })
  }
  sendKeystrokes (key = '1c 9c') {
    const cmd = `${VBoxManage} controlvm ${this.config.vrouter.name} keyboardputscancode ${key}`
    return this.localExec(cmd)
  }
  sshLogin () {
    const applescript = String.raw`
      tell application "Terminal"
          do script ("ssh ${this.config.vrouter.username}@${this.config.vrouter.ip};")
          activate
          delay 3
          tell application "System Events" to keystroke "${this.config.vrouter.password}"
          tell application "System Events" to key code 36
      end tell
      `
    const cmd = `osascript -e '${applescript}'`
    return this.localExec(cmd)
  }
  async getOSXNetworkService (inf) {
    const cmd = `/usr/sbin/networksetup -listnetworkserviceorder`
    const output = await this.localExec(cmd)
    const reg = /\(\d+\) (.*)\n\(Hardware Port: .*?, Device: (.*)\)/g
    while (true) {
      const match = reg.exec(output)
      if (!match) break
      if (match[2] === inf) {
        return match[1]
      }
    }
    throw Error(`can not find NetworkService match ${inf}`)
  }
  async getCurrentGateway () {
    let info
    try {
      info = await this.getActiveAdapter()
    } catch (error) {
      return ['', '']
    }

    const cmd1 = "/sbin/route -n get default | grep gateway | awk '{print $2}'"
    const cmd2 = `/usr/sbin/networksetup -getdnsservers "${info[0]}"`

    return Promise.all([
      this.localExec(cmd1).then((output) => {
        return Promise.resolve((output && output.trim()) || '')
      }),
      this.localExec(cmd2).then((output) => {
        return Promise.resolve((output && output.trim()) || '')
      })
    ])
  }
  async changeRouteTo (dst) {
    let ip
    const info = await this.getActiveAdapter()

    if (dst === 'vrouter') {
      ip = this.config.vrouter.ip
    } else {
      ip = info[2]
    }
    const cmd1 = `/sbin/route change default ${ip}`
    const cmd2 = `/usr/sbin/networksetup -setdnsservers "${info[0]}" "${ip}"`
    // https://askubuntu.com/questions/634620/when-using-and-sudo-on-the-first-command-is-the-second-command-run-as-sudo-t
    return this.sudoExec(`bash -c '${cmd1} && ${cmd2}'`)
  }
  async getActiveAdapter () {
    let cmd = String.raw`cat <<EOF | scutil
open
get State:/Network/Global/IPv4
d.show
EOF`
    const output = await this.localExec(cmd)

    const infReg = /PrimaryInterface : (.*)$/mg
    const inf = infReg.exec(output)[1]

    const serviceReg = /PrimaryService : (.*)$/mg
    const service = serviceReg.exec(output)[1]

    const routerReg = /Router : (.*)$/mg
    const router = routerReg.exec(output)[1]

    cmd = String.raw`cat <<EOF | scutil | grep "UserDefinedName" | awk -F': ' '{print $2}'
open
get Setup:/Network/Service/${service}
d.show
EOF`
    const serviceName = await this.localExec(cmd)

    return [serviceName.trim(), inf, router]
  }

  async installNwWatchdog () {
    await this.generateNetworkSh()
    await this.localExec(`chmod +x "${path.join(this.config.host.configDir, this.config.host.networkSh)}"`)
    await this.generateNetworkPlist()
    await this.sudoExec(`cp "${path.join(this.config.host.configDir, this.config.host.networkPlist)}" /Library/LaunchDaemons`)
    await this.sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await this.sudoExec(`launchctl bootstrap system /Library/LaunchDaemons/${this.config.host.networkPlist}`)
  }
  async removeNwWatchdog () {
    await this.sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await this.sudoExec(`rm /Library/LaunchDaemons/${this.config.host.networkPlist}`).catch(e => {})
    await this.sudoExec(`rm "${path.join(this.config.host.configDir, path.basename(this.config.host.networkSh, '.sh') + '.log')}"`).catch(e => {})
  }

  // vm
  async buildvm (imagePath, deleteFirst = true) {
    let image = imagePath
    if (!image) {
      // download
      const oldImage = path.join(this.config.host.configDir, path.basename(this.config.vrouter.imageUrl))
      const hashValue = await this.hashFile(oldImage)
      if (hashValue === this.config.vrouter.imageSha256) {
        image = oldImage
        this.process.emit('build', '使用缓存镜像')
      } else {
        try {
          image = await this.downloadFile(this.config.vrouter.imageUrl)
          this.process.emit('build', '下载镜像')
        } catch (err) {
          this.process.emit('build', '下载失败')
          throw Error(err)
        }
      }
    }
    const existed = await this.isVRouterExisted()

    if (!deleteFirst && existed) {
      throw Error('vrouter already existed')
    }
    if (existed) {
      if (this.config.debug) {
        // console.log('vm existed. delete it now.')
        await this.deletevm(true)
        this.process.emit('build', '删除原有虚拟机')
      }
    }
    // specify size: 64M
    const vdiSize = 67108864
    const subCmds = []
    const vdi = path.join(this.config.host.configDir, this.config.vrouter.name + '.vdi')
    await fs.remove(vdi)
    subCmds.push(`cat "${image}" | gunzip | ` +
      `${VBoxManage} convertfromraw --format VDI stdin "${vdi}" ${vdiSize}`)

    subCmds.push(`${VBoxManage} createvm --name ${this.config.vrouter.name} --register`)

    subCmds.push(`${VBoxManage} modifyvm ${this.config.vrouter.name} ` +
      ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
      ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
      ` --audio "none" --vram "16"`)

    subCmds.push(`${VBoxManage} storagectl ${this.config.vrouter.name} ` +
      `--name "SATA Controller" --add "sata" --portcount "4" ` +
      `--hostiocache "on" --bootable "on"`)

    subCmds.push(`${VBoxManage} storageattach ${this.config.vrouter.name} ` +
      `--storagectl "SATA Controller" --port "1" ` +
      `--type "hdd" --nonrotational "on" --medium "${vdi}"`)

    try {
      await this.localExec(subCmds.join(' && '))
      await this.lockGUIConfig()
      await this.hidevm()

      await this.toggleSerialPort('on')
      this.process.emit('build', '配置虚拟机串口')

      await this.configvmNetwork()
      this.process.emit('build', '配置虚拟机网络')

      await this.startvm()
      this.process.emit('build', '开始启动虚拟机...请稍候30秒')
      await this.wait(30000)

      await this.changevmPwd()
      this.process.emit('build', '修改虚拟机密码')

      await this.configDnsmasq()
      this.process.emit('build', '配置Dnsmasq')

      await this.changevmTZ()
      this.process.emit('build', '修改虚拟机时区')

      await this.turnOnFastOpen()
      this.process.emit('build', '打开tcp fast open')

      await this.configvmLanIP()
      this.process.emit('build', '配置虚拟机网络地址, 请稍候10秒')
      await this.wait(10000)

      await this.installPackage()
      this.process.emit('build', '更新软件源并安装必要软件包, 请稍候20-60秒')
      await this.wait(20000)
      // return this.serialLog('done: install package && restart dropbear')

      let remote
      let retry = -1
      while (true) {
        try {
          retry += 1
          remote = await this.connect()
          const output = await remote.remoteExec('tail -n 1 /vrouter.log')
          if (output === 'done: install package && restart dropbear') {
            winston.debug('安装软件包完成')
            this.process.emit('build', '安装软件包完成')
            break
          } else {
            throw Error('未完成')
          }
        } catch (err) {
          if (retry >= 4) {
            throw Error('未能安装软件包, 请确保网络通畅后重试')
          }
          winston.debug('安装软件包未完成, 10秒后重试')
          // this.process.emit('buid', '无法登录到虚拟机, 10秒后重试')
          await this.wait(10000)
        }
      }
      this.process.emit('build', '成功登录虚拟机')
      await this.serialLog('done: connect to vm')

      const src = path.join(__dirname, '..', 'third_party')
      const dst = this.config.vrouter.configDir + '/third_party/'
      await remote.scp(src, dst)
        .catch((error) => {
          throw error
        })
      this.process.emit('build', '拷贝 shadowsocks[r] 以及 kcptun 到虚拟机')
      await this.serialLog('done: scp third_party')

      await remote.scpConfigAll()
      this.process.emit('build', '拷贝配置文件到虚拟机')
      await this.serialLog('done: scpConfigAll')

      await remote.installKt()
      await this.serialLog('done: installKt')
      this.process.emit('build', '安装 kcptun')
      if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
        await this.enableService('kcptun')
        this.process.emit('build', '设置 kcptun 随虚拟机启动')
        await this.serialLog('done: enable kcptun')
      }

      await remote.installSs()
      this.process.emit('build', '安装 shadowsocks')
      await this.serialLog('done: install SS')
      const p = this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
      if (p === 'ss' || p === 'ssKt') {
        await this.enableService('shadowsocks')
        this.process.emit('build', '设置 shadowsocks 随虚拟机启动')
        await this.serialLog('done: enable SS')
      }

      await remote.installSsr()
      this.process.emit('build', '安装 shadowsocksr')
      await this.serialLog('done: install ssr')
      if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('ssr')) {
        await this.enableService('shadowsocksr')
        this.process.emit('build', '设置 shadowsocksr 随虚拟机启动')
        await this.serialLog('done: enable ssr')
      }

      await this.enableService('cron')
      this.process.emit('build', '启用 cron 服务')
      await this.serialLog('done: enable cron')

      await this.configWatchdog()
      this.process.emit('build', '安装守护脚本')
      await this.serialLog('done: install watchdog')

      this.process.emit('build', '保存设置, 关闭虚拟机...')
      await this.serialLog('done: shutting down')
      await remote.shutdown()
      await remote.closeConn().catch(() => {})
      await this.wait(10000)

      this.process.emit('build', '在宿主安装守护脚本, 维持dns和网关的一致.')
      await this.installNwWatchdog()
    } catch (error) {
      throw error
    }
  }

  guiLogin () {
    const cmd = `${VBoxManage} startvm ${this.config.vrouter.name} --type separate`
    return this.localExec(cmd)
  }
  async serialExec (cmd, msg) {
    const serialPortState = await this.isSerialPortOn()

    // toggleSerialPort on
    if (!serialPortState) {
      // turn vm off if necessary
      await this.stopvm('poweroff', 8000)
      await this.toggleSerialPort('on')
    }

    const state = await this.getvmState()
    // startvm if necessary
    if (state !== 'running') {
      try {
        await this.startvm()
        await this.wait(35000)
      } catch (err) {
        console.log(err)
        console.log('startvm error')
        console.log('try again')
        await this.serialExec('poweroff', 'poweroff')
        await this.wait(8000)
        // await this.stopvm('poweroff', 8000)
        console.log('turn vm off finish')
        console.log('now try to turn vm on')
        await this.startvm()
      }
    }

    const serialPath = path.join(this.config.host.configDir, this.config.host.serialFile)
    const pre = `echo "" |  /usr/bin/nc -U "${serialPath}"`
    const serialCmd = `echo "${cmd}" | /usr/bin/nc -U '${serialPath}'`

    // 先执行两遍pre
    await this.localExec(pre)
    await this.localExec(pre)
    // console.log(serialCmd)
    return this.localExec(serialCmd)
  }

  importvm (vmFile) {
    const cmd = `${VBoxManage} import ${vmFile}`
    return this.localExec(cmd)
  }
  async deletevm (stopFirst = false) {
    const cmd = `${VBoxManage} unregistervm ${this.config.vrouter.name} --delete`
    const existed = await this.isVRouterExisted()
    if (!existed) {
      return
    }
    const state = await this.getvmState()
    if (state === 'running' && !stopFirst) {
      throw Error('vm must be stopped before delete')
    }
    await this.stopvm('poweroff', 3000)
    return this.localExec(cmd)
  }
  async startvm (type = 'headless', waitTime = 100) {
    const state = await this.getvmState()
    if (state !== 'running') {
      const cmd = `${VBoxManage} startvm --type ${type} ${this.config.vrouter.name}`
      await this.localExec(cmd)
      await this.wait(1000)
      await this.sendKeystrokes()
      // skip grub's waiting time
      await this.wait(500)
      await this.sendKeystrokes()
      await this.wait(waitTime)
    }
  }
  async stopvm (action = 'savestate', waitTime = 100) {
    const serialPortState = await this.isSerialPortOn()
    const vmState = await this.getvmState()
    if (vmState === 'running') {
      winston.debug(`about to stop vm. current State: ${vmState}. action: ${action}`)
      if (action === 'force') {
        const cmd = `${VBoxManage} controlvm ${this.config.vrouter.name} poweroff`
        await this.localExec(cmd)
        return this.wait(waitTime)
      } else if (action === 'poweroff') {
        if (serialPortState) {
          // poweroff from inside openwrt is more safer.
          await this.serialExec('poweroff', 'poweroff')
          return this.wait(8000)
        } else {
          const cmd = `${VBoxManage} controlvm ${this.config.vrouter.name} poweroff`
          await this.localExec(cmd)
          return this.wait(waitTime)
        }
      } else if (action === 'savestate') {
        const cmd = `${VBoxManage} controlvm ${this.config.vrouter.name} savestate`
        await this.localExec(cmd)
        return this.wait(waitTime)
      }
    } else if (vmState === 'saved') {
      if (action === 'poweroff') {
        await this.localExec(`${VBoxManage} discardstate ${this.config.vrouter.name}`)
        return this.wait(5000)
      }
    }
  }

  hidevm (action = true) {
    const cmd = `${VBoxManage} setextradata ${this.config.vrouter.name} GUI/HideFromManager ${action}`
    return this.localExec(cmd)
  }
  lockGUIConfig (action = true) {
    const cmd = `${VBoxManage} setextradata ${this.config.vrouter.name} GUI/PreventReconfiguration ${action}`
    return this.localExec(cmd)
  }

  async isVBInstalled () {
    const cmd = `${VBoxManage} --version`
    try {
      await this.localExec(cmd)
      return true
    } catch (error) {
      return false
    }
  }
  async isVRouterExisted () {
    const cmd = `${VBoxManage} showvminfo ${this.config.vrouter.name}`
    try {
      await this.localExec(cmd)
      return true
    } catch (error) {
      return false
    }
  }
  async getvmState () {
    // much slow than 'VBoxManage list runningvms'
    const cmd = `${VBoxManage} showvminfo ${this.config.vrouter.name} --machinereadable | grep VMState=`
    const output = await this.localExec(cmd)
    const state = output.trim().split('=')[1].replace(/"/g, '')
    return state
  }
  async isVRouterRunning () {
    // State:           running (since 2017-06-16T02:13:09.066000000)
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep vmState
    // vmState="running"
    const cmd = `${VBoxManage} list runningvms`
    const stdout = await this.localExec(cmd)
    const vms = stdout
      .trim().split('\n')
      .map(e => e.split(' ')[0].trim().replace(/"/g, ''))
    if (vms.includes(this.config.vrouter.name)) {
      return true
    } else {
      return false
    }
  }

  async getInfIP (inf) {
    const cmd = `/sbin/ifconfig ${inf}`
    const output = await this.localExec(cmd)
    const ipMatch = /inet (\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}) netmask/ig.exec(output)
    const ip = (ipMatch && ipMatch[1]) || ''
    return ip
  }
  getAllInf () {
    const cmd = '/sbin/ifconfig'
    return this.localExec(cmd)
  }
  async getHostonlyInf () {
    // return [correspondingInf, firstAvailableInf]
    const infs = await this.getAllInf()
    const reg = /^vboxnet\d+.*\n(?:\t.*\n)*/img
    let correspondingInf = null
    let firstAvailableInf = null
    while (true) {
      const result = reg.exec(infs)
      if (!result) break
      const infConfig = result[0]
      const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(infConfig)
      const nameMatch = /^(vboxnet\d+):/ig.exec(infConfig)
      if (!ipMatch && !firstAvailableInf && nameMatch) {
        // console.log(infConfig)
        firstAvailableInf = nameMatch[1]
      }
      if (ipMatch && nameMatch && ipMatch[1] === this.config.host.ip) {
        correspondingInf = nameMatch[1]
      }
    }
    return [correspondingInf, firstAvailableInf]
  }
  async createHostonlyInf () {
    const cmd = `${VBoxManage} hostonlyif create`
    const output = await this.localExec(cmd)
    const infMatch = /Interface '(.*)'/ig.exec(output)
    return infMatch && infMatch[1]
  }
  removeHostonlyInf (inf) {
    const cmd = `${VBoxManage} hostonlyif remove ${inf}`
    return this.localExec(cmd)
  }
  async configHostonlyInf (inf, netmask = '255.255.255.0') {
    let iinf = inf
    if (!inf) {
      const infs = await this.getHostonlyInf()
      iinf = infs[0] || infs[1] || await this.createHostonlyInf()
    }
    const cmd = `${VBoxManage} hostonlyif ipconfig ${iinf} --ip ${this.config.host.ip} --netmask ${netmask}`
    await this.localExec(cmd)
    return iinf
  }

  async specifyHostonlyAdapter (inf, nic = '1') {
    let iinf = inf
    if (!iinf) {
      iinf = await this.configHostonlyInf()
    }
    const cmd = `${VBoxManage} modifyvm ${this.config.vrouter.name} ` +
      ` --nic${nic} hostonly ` +
      ` --nictype${nic} "82540EM" ` +
      ` --hostonlyadapter${nic} ${iinf} ` +
      ` --cableconnected${nic} "on"`

    const vmState = await this.getvmState()
    if (vmState !== 'poweroff') {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
  }
  async specifyBridgeAdapter (inf, nic = '2') {
    // VBoxManage modifyvm com.icymind.vrouter --nic2 bridged --bridgeadapter1 en0
    let service
    if (!inf) {
      try {
        let info = await this.getActiveAdapter()
        service = info[0]
      } catch (error) {
        service = 'Wi-Fi'
      }
    }

    const subCmd = `${VBoxManage} list bridgedifs | grep "${service}"`
    const output = await this.localExec(subCmd)
    const raw = String.raw`^Name:\s*(.*)`
    const reg = new RegExp(raw, 'mg')
    const iinf = reg.exec(output)[1]

    const cmd = `${VBoxManage} modifyvm ${this.config.vrouter.name} ` +
      `--nic${nic} bridged ` +
      ` --nictype${nic} "82540EM" ` +
      `--bridgeadapter${nic} "${iinf.replace(/["']/g, '')}" ` +
      `--cableconnected${nic} "on" ` +
      `--macaddress${nic} "080027a8b841"`
    const vmState = await this.getvmState()
    if (vmState !== 'poweroff') {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
  }

  async changeBridgeAdapter (nic = '2') {
    const info = await this.getActiveAdapter()
    let subCmd = `${VBoxManage} list bridgedifs | grep "${info[0]}"`
    let output = await this.localExec(subCmd)
    const raw = String.raw`^Name:\s*(.*)`
    let reg = new RegExp(raw, 'mg')
    const activeBridge = reg.exec(output)[1]

    subCmd = `${VBoxManage} showvminfo ${this.config.vrouter.name} --machinereadable | grep bridgeadapter`
    output = await this.localExec(subCmd)
    reg = /^bridgeadapter2="(.*)"/mg
    const specifyBridge = reg.exec(output)[1]

    if (activeBridge !== specifyBridge) {
      winston.info(`PrimaryInterface change from ${specifyBridge} to ${activeBridge}. now change vm's bridged to ${activeBridge}`)
      const cmd = `${VBoxManage} controlvm ${this.config.vrouter.name} nic${nic} bridged "${activeBridge}"`
      await this.localExec(cmd)
    }
    return activeBridge
  }

  async isNIC1ConfigedAsHostonly () {
    let cmd = `${VBoxManage} showvminfo ${this.config.vrouter.name} --machinereadable | grep 'nic1\\|hostonlyadapter1'`
    const output = await this.localExec(cmd)
    // hostonlyadapter1="vboxnet4"
    // nic1="hostonly"
    const infos = new Map()
    output.trim().split('\n').map((element) => {
      const temp = element.split('=')
      infos.set(temp[0].replace(/"/g, ''), temp[1].replace(/"/g, ''))
    })
    if (infos.get('nic1') !== 'hostonly') {
      throw Error("NIC1 isn't hostonly network")
    }
    if (!/^vboxnet\d+$/ig.test(infos.get('hostonlyadapter1'))) {
      throw Error("NIC1 doesn't specify host-only adapter")
    }
    const inf = infos.get('hostonlyadapter1')
    const ip = await this.getInfIP(inf)
    if (ip !== this.config.host.ip) {
      throw Error("host-only adapter doesn't config as hostIP")
    }
    return inf
  }
  async isNIC2ConfigedAsBridged () {
    let cmd = `${VBoxManage} showvminfo ${this.config.vrouter.name} --machinereadable | grep 'nic2\\|bridgeadapter2'`
    const output = await this.localExec(cmd)
    const infos = new Map()
    output.trim().split('\n').map((element) => {
      const temp = element.split('=')
      infos.set(temp[0].replace(/"/g, ''), temp[1].replace(/"/g, ''))
    })
    if (infos.get('nic2') !== 'bridged') {
      throw Error("NIC2 isn't bridged network")
    }
    const inf = infos.get('bridgeadapter2')
    if (!inf) {
      throw Error("NIC2 doesn't specify bridged adapter")
    }
    cmd = `/sbin/ifconfig ${inf.trim().split(':')[0]}`
    const infConfig = await this.localExec(cmd)
    const statusMatch = /status: active/ig.exec(infConfig)
    if (!statusMatch) throw Error("bridged adapter doesn't active")
    return inf
  }

  async configvmNetwork () {
    /*
     * 1. make sure two ip in same network
     * 2. make sure vm adapters are : hostonlyif, bridged
     * 3. make sure hostonlyif ip equal config.host.ip
     * 4. make sure vm bridged interface choose right host-network
     * 5. make sure vm lan's ip equal config.vrouter.ip
     */

    if (this.config.vrouter.ip.split('.').slice(0, 3).join('.') !==
      this.config.host.ip.split('.').slice(0, 3).join('.')) {
      return Promise.reject(Error('VRouterIP and hostIP must in a same subnet'))
    }
    await this.isNIC1ConfigedAsHostonly(this.config.vrouter.name, this.config.host.ip)
      .catch(() => {
        winston.debug(`isNIC1ConfigedAsHostonly return false. vrouter: ${this.config.vrouter.name}, hostip: ${this.config.host.ip}`)
        return this.specifyHostonlyAdapter()
      })
    await this.isNIC2ConfigedAsBridged(this.config.vrouter.name)
      .catch(() => {
        winston.debug(`isNIC2ConfigedAsBridged return false. vrouter: ${this.config.vrouter.name}, hostip: ${this.config.host.ip}`)
        return this.specifyBridgeAdapter()
      })
  }

  async isSerialPortOn () {
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep "uart\(mode\)\?1"
    // uart1="0x03f8,4"
    // uartmode1="server,/Users/simon/Library/Application Support/VRouter/serial"
    const cmd = `${VBoxManage} showvminfo ${this.config.vrouter.name} --machinereadable  | grep "uart\\(mode\\)\\?1"`
    const output = await this.localExec(cmd)
    const infos = new Map()
    output.trim().split('\n').map((element) => {
      const temp = element.split('=')
      infos.set(temp[0].replace(/"/g, ''), temp[1].replace(/"/g, ''))
    })
    return infos.get('uart1') === '0x03f8,4' &&
      infos.get('uartmode1') === `server,${path.join(this.config.host.configDir, this.config.host.serialFile)}`
  }
  async toggleSerialPort (action = 'on', num = 1) {
    const serialPath = path.join(this.config.host.configDir, this.config.host.serialFile)
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${num} server "${serialPath}"` : 'off'
    const cmd = `${VBoxManage} modifyvm ${this.config.vrouter.name} --uart${num} ${subCmd}`
    const vmState = await this.getvmState()
    if (vmState !== 'poweroff') {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
  }
  async configvmLanIP () {
    // execute cmd
    const subCmds = []
    subCmds.push(`uci set network.lan.ipaddr='${this.config.vrouter.ip}'`)
    subCmds.push('uci commit network')
    subCmds.push('/etc/init.d/network restart')
    await this.serialExec(subCmds.join(' && '), 'config lan ipaddr')
    return this.serialLog('done: configvmLanIP')
  }

  async configDnsmasq () {
    const cmd = "mkdir /etc/dnsmasq.d && echo 'conf-dir=/etc/dnsmasq.d/' > /etc/dnsmasq.conf"
    await this.serialExec(cmd, 'configDnsmasq')
    return this.serialLog('done: configDnsmasq')
  }
  enableService (service) {
    const cmd1 = `chmod +x /etc/init.d/${service} && /etc/init.d/${service} enable`
    return this.serialExec(cmd1, `enable ${service}`)
  }
  disabledService (service) {
    const cmd = `/etc/init.d/${service} disable && /etc/init.d/${service} stop`
    return this.serialExec(cmd, `disable ${service}`)
  }
  configWatchdog () {
    const watchdogPath = `${this.config.vrouter.configDir}/${this.config.firewall.watchdogFile}`
    const cronPath = `${this.config.vrouter.configDir}/${this.config.firewall.cronFile}`

    const cmd = `chmod +x '${watchdogPath}' && crontab '${cronPath}'`
    return this.serialExec(cmd, 'config watchdog')
  }
  restartCrontab () {
    const cmd = '/etc/init.d/cron restart'
    return this.serialExec(cmd)
  }
  async changevmTZ () {
    const cc = String.raw`
        uci set system.@system[0].hostname='${this.config.vrouter.name}'
        uci set system.@system[0].timezone='HKT-8'
        uci set system.@system[0].zonename='Asia/Hong Kong'
        uci commit system`
    await this.serialExec(cc.trim().split('\n').map(line => line.trim()).join(' && '), 'change timezone')
    return this.serialLog('done: changevmTZ')
  }
  async changevmPwd () {
    await this.serialExec("echo -e 'root\\nroot' | (passwd root)", 'change password')
    return this.serialLog('done: changevmPwd')
  }
  async turnOnFastOpen () {
    await this.serialExec('echo "net.ipv4.tcp_fastopen = 3" >> /etc/sysctl.conf && sysctl -p /etc/sysctl.conf')
    return this.serialLog('done: trunOn fast_open')
  }
  serialLog (msg) {
    const cmd = `echo '${msg}' >> /vrouter.log`
    return this.serialExec(cmd, 'log to file')
  }
  async installPackage () {
    const subCmds = []
    subCmds.push(`sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\\/openwrt/g' /etc/opkg/distfeeds.conf`)
    subCmds.push('opkg update')
    subCmds.push('opkg remove dnsmasq && opkg install dnsmasq-full ipset openssh-sftp-server libopenssl rng-tools')
    subCmds.push('/etc/init.d/dropbear restart')
    await this.serialExec(subCmds.join(' && '), 'install packages')
    return this.serialLog('done: install package && restart dropbear')
  }

  deleteCfgFile (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    return fs.remove(filePath)
      .catch(() => {
        // don't panic. that's unnecessary to delete a non existed file.
      })
  }
  async getCfgContent (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return content
    } catch (error) {
      const template = path.join(__dirname, '../config', fileName)
      winston.debug(`can not find ${filePath}, copy template ${template} to appdir`)
      await fs.copy(template, filePath)
      return fs.readFile(filePath, 'utf8')
    }
  }
  async generateIPsets (overwrite = false) {
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.ipsetsFile)
    const stats = await fs.stat(cfgPath)
      .catch(() => null)
    if (stats && stats.isFile() && !overwrite) {
      return cfgPath
    }
    const ws = fs.createWriteStream(cfgPath)
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', () => {
        resolve(cfgPath)
      })
      ws.on('error', (err) => {
        reject(err)
      })
    })

    // create or flush ipset
    ws.write(`create ${this.config.firewall.ipsets.lan}   hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`create ${this.config.firewall.ipsets.white} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`create ${this.config.firewall.ipsets.black} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)

    // "selectedBL": {"gfwDomains":true, "extraBlackList":true},
    // "selectedWL": {"chinaIPs":true, "lanNetworks":true, "extraWhiteList":true},
    if (this.config.firewall.selectedWL.lanNetworks) {
      winston.debug(`getCfgContent: ${this.config.firewall.lanNetworks}`)
      const lan = await this.getCfgContent(this.config.firewall.lanNetworks)
      lan.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          ws.write(`add ${this.config.firewall.ipsets.lan} ${trimLine}\n`)
        }
      })
    }

    if (this.config.firewall.selectedWL.chinaIPs) {
      const chinaIPs = await this.getCfgContent(this.config.firewall.chinaIPs)
      chinaIPs.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          ws.write(`add ${this.config.firewall.ipsets.white} ${trimLine}\n`)
        }
      })
    }

    if (this.config.firewall.selectedWL.extraWhiteList) {
      const extraList = await this.getCfgContent(this.config.firewall.extraWhiteList)
      extraList.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          const ip = /^\d+\.\d+\.\d+\.\d+$/g
          if (ip.test(trimLine)) {
            ws.write(`add ${this.config.firewall.ipsets.white} ${trimLine}\n`)
          }
        }
      })
    }

    if (this.config.firewall.selectedBL.extraBlackList) {
      // add extra_blocked_ips to blacklist_ipset
      const extraList = await this.getCfgContent(this.config.firewall.extraBlackList)
      extraList.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          const ip = /^\d+\.\d+\.\d+\.\d+$/g
          if (ip.test(trimLine)) {
            ws.write(`add ${this.config.firewall.ipsets.black} ${trimLine}\n`)
          }
        }
      })
    }

    ws.end()
    return promise
  }

  getServerIP (proxy = 'shadowsocks') {
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
    const cfg = profile[proxy]
    const ipPatthen = /^\d+.\d+.\d+.\d+$/ig
    if (ipPatthen.test(cfg.address)) {
      return Promise.resolve(cfg.address)
    }
    return new Promise((resolve, reject) => {
      dns.lookup(cfg.address, { family: 4 }, (err, address, family) => {
        if (err) reject(err)
        resolve(address)
      })
    })
  }
  generateFWRulesHelper (str) {
    return `iptables -t nat -A PREROUTING ${str}\niptables -t nat -A OUTPUT ${str}\n`
  }
  // files
  async generateFWRules (m, p, overwrite = false) {
    // whitelist/blacklist/global/none
    const proxies = p || this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
    const mode = m || this.config.profiles.profiles[this.config.profiles.activedProfile].mode

    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.firewallFile)

    const stats = await fs.stat(cfgPath)
      .catch(() => null)
    if (stats && stats.isFile() && !overwrite) {
      return Promise.resolve(cfgPath)
    }

    const ws = fs.createWriteStream(cfgPath)
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', () => {
        resolve(cfgPath)
      })
      ws.on('error', (err) => {
        reject(err)
      })
    })

    let redirPort = ''
    let ip = ''
    const serverIPs = []

    switch (proxies) {
      // todo: in case of can not get ip
      case 'ss':
        redirPort = this.config.shadowsocks.clientPort
        ip = await this.getServerIP('shadowsocks')
        serverIPs.push(ip)
        break
      case 'ssKt':
        redirPort = this.config.shadowsocks.overKtPort
        ip = await this.getServerIP('shadowsocks')
        serverIPs.push(ip)
        ip = await this.getServerIP('kcptun')
        serverIPs.push(ip)
        break
      case 'ssr':
        redirPort = this.config.shadowsocksr.clientPort
        ip = await this.getServerIP('shadowsocksr')
        serverIPs.push(ip)
        break
      case 'ssrKt':
        redirPort = this.config.shadowsocksr.overKtPort
        ip = await this.getServerIP('shadowsocksr')
        serverIPs.push(ip)
        ip = await this.getServerIP('kcptun')
        serverIPs.push(ip)
        break
      default:
        throw Error(`unkown proxies: ${proxies}`)
    }

    ws.write('# com.icymind.vrouter\n')
    ws.write(`# workMode: ${mode}\n`)
    ws.write('ipset flush\n')
    ws.write(`/usr/sbin/ipset restore -f -! ${this.config.vrouter.configDir}/${this.config.firewall.ipsetsFile} &> /dev/null\n`)

    // if kcp protocol: speedup ssh
    // if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt') && this.config.server.sshPort) {
    /*
     * if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
     *   ws.write('# speedup ssh connection if current proxy is kcptun\n')
     *   serverIPs.forEach((ip) => {
     *     // const rule = `-d ${ssServerIP} -p tcp --dport ${this.config.server.sshPort} -j REDIRECT --to-port ${redirPort}`
     *     const rule = `-d ${ip} -p tcp --dport 11235 -j REDIRECT --to-port ${redirPort}`
     *     ws.write(this.generateFWRulesHelper(rule))
     *   })
     * }
     */

    // bypass serverIPs
    // bypass shadowsocks server_ip
    ws.write('# bypass server ip\n')
    serverIPs.forEach((ip) => {
      ws.write(this.generateFWRulesHelper(`-d ${ip} -j RETURN`))
    })

    let rule = ''

    // bypass lan_networks. 如果不想绕过lan, 生成一个空的lan ipset集合即可
    ws.write('# bypass lan networks\n')
    rule = `-m set --match-set ${this.config.firewall.ipsets.lan} dst -j RETURN`
    ws.write(this.generateFWRulesHelper(rule))

    // whitelist mode: bypass whitelist and route others
    if (mode === 'whitelist') {
      // "绕过白名单"模式下, 先将黑名单导向代理(如果自定义黑名单中存在白名单相同项, 先处理黑名单符合预期)
      ws.write('# route all blacklist traffic\n')
      rule = `-p tcp -m set --match-set ${this.config.firewall.ipsets.black} dst -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))

      ws.write('# bypass whitelist\n')
      rule = `-m set --match-set ${this.config.firewall.ipsets.white} dst -j RETURN`
      ws.write(this.generateFWRulesHelper(rule))

      ws.write('# route all other traffic\n')
      rule = `-p tcp -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    if (mode === 'blacklist') {
      // 仅代理黑名单模式下, 先将白名单返回(如果自定义白名单中存在黑名单相同项, 先处理白名单符合预期)
      ws.write('# bypass whitelist\n')
      rule = `-m set --match-set ${this.config.firewall.ipsets.white} dst -j RETURN`
      ws.write(this.generateFWRulesHelper(rule))

      ws.write('# route all blacklist traffic\n')
      rule = `-p tcp -m set --match-set ${this.config.firewall.ipsets.black} dst -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    if (mode === 'global') {
      ws.write('# route all traffic\n')
      rule = `-p tcp -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }
    ws.end()
    return promise
  }
  getDNSServer () {
    const dnsmasq = '53'
    return [
      `127.0.0.1#${dnsmasq}`,
      `127.0.0.1#${this.config.tunnelDns.dnsPort}`
    ]
  }
  async generateDnsmasqCf (overwrite = false) {
    const DNSs = this.getDNSServer()
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.dnsmasqFile)

    const stats = await fs.stat(cfgPath)
      .catch(() => null)
    if (stats && stats.isFile() && !overwrite) {
      return Promise.resolve(cfgPath)
    }

    const ws = fs.createWriteStream(cfgPath)
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', () => {
        resolve(cfgPath)
      })
      ws.on('error', (err) => {
        reject(err)
      })
    })

    if (this.config.profiles.profiles[this.config.profiles.activedProfile].mode === 'none') {
      ws.write('# stay in wall\n')
      ws.end()
      return promise
    }
    if (this.config.firewall.selectedBL.gfwDomains) {
      const gfwDomains = await this.getCfgContent(this.config.firewall.gfwDomains)
      gfwDomains.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          if (this.config.firewall.enableTunnelDns) {
            ws.write(`server=/${trimLine}/${DNSs[1]}\n`)
          }
          ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.black}\n`)
        }
      })
    }

    if (this.config.firewall.selectedBL.extraBlackList) {
      // add extra_blocked_ips to blacklist_ipset
      const extraList = await this.getCfgContent(this.config.firewall.extraBlackList)
      extraList.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          const ip = /^\d+\.\d+\.\d+\.\d+$/g
          if (!ip.test(trimLine)) {
            if (this.config.firewall.enableTunnelDns) {
              ws.write(`server=/${trimLine}/${DNSs[1]}\n`)
            }
            ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.black}\n`)
          }
        }
      })
    }

    if (this.config.firewall.selectedWL.extraWhiteList) {
      const extraList = await this.getCfgContent(this.config.firewall.extraWhiteList)
      extraList.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          const ip = /^\d+\.\d+\.\d+\.\d+$/g
          if (!ip.test(trimLine)) {
            // ws.write(`server=/${trimLine}/${DNSs[0]}\n`)
            ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.white}\n`)
          }
        }
      })
    }

    ws.end()
    return promise
  }
  async generateCronJob () {
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.cronFile)
    const content = `* * * * * ${this.config.vrouter.configDir}/${this.config.firewall.watchdogFile}\n`
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }
  async generateWatchdog (p) {
    const proxies = p || this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.watchdogFile)
    let content = '#!/bin/sh\n'
    const tunnelBinName = proxies.substr(0, 3) === 'ssr' ? 'sr-tunnel' : 's-tunnel'
    const tunnelDns = String.raw`
      tunnelDns=$(ps -w| grep "[s]${tunnelBinName} -c .*tunnel-dns.json")
      if [[ -z "$tunnelDns" ]];then
        /etc/init.d/${this.config.tunnelDns.service} restart
      fi`
    const shadowsocks = String.raw`
      ssClient=$(ps -w| grep "[s]s-redir -c .*ss-client.json")
      if [[ -z "$ssClient" ]];then
          /etc/init.d/${this.config.shadowsocks.service} restart
      fi`
    const ssKt = String.raw`
      ssOverKt=$(ps -w| grep "[s]s-redir -c .*ss-over-kt.json")
      ssClient=$(ps -w| grep "[s]s-redir -c .*ss-client.json")
      if [[ -z "$ssOverKt" || -z "$ssClient" ]];then
          /etc/init.d/${this.config.shadowsocks.service} restart
      fi`
    const shadowsocksr = String.raw`
      ssrClient=$(ps -w| grep "[s]sr-redir -c .*ssr-client.json")
      if [[ -z "$ssrClient" ]];then
          /etc/init.d/${this.config.shadowsocksr.service} restart
      fi`
    const ssrKt = String.raw`
      ssrOverKt=$(ps -w| grep "[s]sr-redir -c .*ssr-over-kt.json")
      ssrClient=$(ps -w| grep "[s]sr-redir -c .*ssr-client.json")
      if [[ -z "$ssrOverKt" || -z "$ssrClient" ]];then
          /etc/init.d/${this.config.shadowsocksr.service} restart
      fi`
    const kcptun = String.raw`
      if ! pgrep kcptun;then
          /etc/init.d/${this.config.kcptun.service} restart
      fi
      `
    if (this.config.firewall.enableTunnelDns) {
      content += tunnelDns
    }
    if (proxies.includes('Kt')) {
      if (proxies === 'ssKt') {
        content += ssKt
      } else if (proxies === 'ssrKt') {
        content += ssrKt
      }
      content += kcptun
    } else {
      if (proxies === 'ss') {
        content += shadowsocks
      } else if (proxies === 'ssr') {
        content += shadowsocksr
      }
    }
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }
  async generateService (type = 'shadowsocks') {
    // type=tunnelDns/shadowsocks/shadowsocksr/kcptun
    const cfgPath = path.join(this.config.host.configDir, this.config[type].service)
    let content = ''
    switch (type) {
      case 'tunnelDns':
        const tunnelBinName = this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('ssr') ? 'ssr-tunnel' : 'ss-tunnel'
        content = String.raw`#!/bin/sh /etc/rc.common
          # Copyright (C) 2006-2011 OpenWrt.org
          START=85
          SERVICE_USE_PID=1
          SERVICE_WRITE_PID=1
          SERVICE_DAEMONIZE=1
          start() {
              service_start /usr/bin/${tunnelBinName} -c ${this.config.vrouter.configDir}/${this.config.tunnelDns.dns}
          }
          stop() {
              service_stop /usr/bin/${tunnelBinName}
          }`
        break
      case 'shadowsocks':
      case 'shadowsocksr':
        const binName = type === 'shadowsocks' ? 'ss-redir' : 'ssr-redir'
        const noKt = `service_start /usr/bin/${binName} -c ${this.config.vrouter.configDir}/${this.config[type].client}`
        const overKt = `service_start /usr/bin/${binName} -c ${this.config.vrouter.configDir}/${this.config[type].overKt}`
        content = String.raw`#!/bin/sh /etc/rc.common
          # Copyright (C) 2006-2011 OpenWrt.org
          START=90
          SERVICE_USE_PID=1
          SERVICE_WRITE_PID=1
          SERVICE_DAEMONIZE=1
          start() {
              ${this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt') ? overKt : noKt}
          }
          stop() {
              service_stop /usr/bin/${binName}
          }`
        break
      case 'kcptun':
        content = String.raw`#!/bin/sh /etc/rc.common
      # Copyright (C) 2006-2011 OpenWrt.org
      START=88
      SERVICE_USE_PID=1
      SERVICE_WRITE_PID=1
      SERVICE_DAEMONIZE=1
      start() {
          # kcptun will fail if network not ready
          service_start /usr/bin/kcptun -c ${this.config.vrouter.configDir}/${this.config.kcptun.client}
      }
      stop() {
          service_stop /usr/bin/kcptun
      }`
        break
      default:
        throw Error(`unkown service type: ${type}`)
    }
    await fs.outputFile(cfgPath, content)
    return cfgPath
  }
  async generateConfig (type = 'shadowsocks') {
    const cfgs = []
    switch (type) {
      case 'shadowsocks':
        cfgs.push(this.config.shadowsocks.client)
        if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocks.overKt)
        }
        break
      case 'shadowsocksr':
        cfgs.push(this.config.shadowsocksr.client)
        if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocksr.overKt)
        }
        break
      case 'tunnelDns':
        // generateConfigHeler('tunnel-dns.json')
        cfgs.push(this.config.tunnelDns.dns)
        break
      case 'kcptun':
        cfgs.push(this.config.kcptun.client)
        break
      default:
        throw Error(`unkown config type: ${type}`)
    }
    const promises = []
    cfgs.forEach((cfg) => {
      promises.push(this.generateConfigHeler(cfg))
    })
    return Promise.all(promises)
  }
  async generateConfigHeler (type = 'ss-client.json') {
    let cfg
    let fastopen
    let content = {}
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
    switch (type) {
      case this.config.shadowsocks.client:
        cfg = this.config.shadowsocks.client
        fastopen = profile.shadowsocks.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': profile.shadowsocks.address,
          'server_port': parseInt(profile.shadowsocks.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocks.clientPort),
          'password': profile.shadowsocks.password,
          'timeout': parseInt(profile.shadowsocks.timeout),
          'method': profile.shadowsocks.method,
          'fast_open': fastopen,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocks.overKt:
        cfg = this.config.shadowsocks.overKt
        fastopen = profile.shadowsocks.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': '127.0.0.1',
          'server_port': parseInt(this.config.kcptun.clientPort),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocks.overKtPort),
          'password': profile.shadowsocks.password,
          'timeout': 20,
          'method': profile.shadowsocks.method,
          'fast_open': fastopen,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocksr.client:
        cfg = this.config.shadowsocksr.client
        fastopen = profile.shadowsocksr.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': profile.shadowsocksr.address,
          'server_port': parseInt(profile.shadowsocksr.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocksr.clientPort),
          'password': profile.shadowsocksr.password,
          'timeout': parseInt(profile.shadowsocksr.timeout),
          'method': profile.shadowsocksr.method,
          'fast_open': fastopen,
          'mode': 'tcp_only',
          'protocol': profile.shadowsocksr.protocol,
          'protocol_param': profile.shadowsocksr.protocol_param,
          'obfs': profile.shadowsocksr.obfs,
          'obfs_param': profile.shadowsocksr.obfs_param
        }
        profile.shadowsocksr.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.shadowsocksr.overKt:
        cfg = this.config.shadowsocksr.overKt
        fastopen = profile.shadowsocksr.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': '127.0.0.1',
          'server_port': parseInt(this.config.kcptun.clientPort),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocksr.overKtPort),
          'password': profile.shadowsocksr.password,
          'timeout': 20,
          'method': profile.shadowsocksr.method,
          'fast_open': fastopen,
          'mode': 'tcp_only',
          'protocol': profile.shadowsocksr.protocol,
          'protocol_param': profile.shadowsocksr.protocol_param,
          'obfs': profile.shadowsocksr.obfs,
          'obfs_param': profile.shadowsocksr.obfs_param
        }
        profile.shadowsocksr.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.tunnelDns.dns:
        cfg = this.config.tunnelDns.dns
        const isSsr = profile.proxies.includes('ssr')
        const server = isSsr ? profile.shadowsocksr : profile.shadowsocks
        fastopen = server.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': server.address,
          'server_port': parseInt(server.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.tunnelDns.dnsPort),
          'password': server.password,
          'timeout': parseInt(server.timeout),
          'method': server.method,
          'fast_open': fastopen,
          'tunnel_address': '8.8.8.8:53',
          'mode': 'udp_only'
        }
        if (isSsr) {
          const moreFields = ['protocol', 'protocol_param', 'obfs', 'obfs_param']
          moreFields.forEach((field) => {
            content[field] = server[field]
          })
          server.others.split(';').forEach((kv) => {
            if (kv.trim()) {
              const [k, v] = kv.split('=')
              content[k.trim()] = v.trim()
            }
          })
        }
        break
      case this.config.kcptun.client:
        cfg = this.config.kcptun.client
        content = {
          'remoteaddr': `${profile.kcptun.address}:${profile.kcptun.port}`,
          'localaddr': `:${this.config.kcptun.clientPort}`,
          'key': profile.kcptun.key,
          'crypt': profile.kcptun.crypt,
          'mode': profile.kcptun.mode
        }
        profile.kcptun.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            const value = v.trim().replace(/"/g, '')
            const key = k.trim()
            // kcptun can not parse a config file with quote-wrapped value of number/boolean
            if (/^\d+$/g.test(value)) {
              content[key] = parseInt(value)
            } else if (/^true|false$/g.test(value)) {
              content[key] = value === 'true'
            } else {
              content[key] = value
            }
          }
        })
        break
      default:
        throw Error(`unkown type: ${type}`)
    }
    const cfgPath = path.join(this.config.host.configDir, cfg)
    await fs.writeJson(cfgPath, content, {spaces: 2})
    return cfgPath
  }

  async generateNetworkPlist () {
    const content = String.raw`
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>${this.config.host.networkPlistName}</string>

        <key>ProgramArguments</key>
        <array>
            <string>${path.join(this.config.host.configDir, this.config.host.networkSh)}</string>
        </array>

        <key>WatchPaths</key>
        <array>
            <string>/etc/resolv.conf</string>
            <string>/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist</string>
            <string>/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist</string>
        </array>

        <key>RunAtLoad</key>
        <true/>
        <key>StandardErrorPath</key>
        <string>${path.join(this.config.host.configDir, path.basename(this.config.host.networkSh, '.sh') + '.log')}</string>
        <key>StandardOutPath</key>
        <string>${path.join(this.config.host.configDir, path.basename(this.config.host.networkSh, '.sh') + '.log')}</string>
      </dict>
    </plist>`

    const cfgPath = path.join(this.config.host.configDir, this.config.host.networkPlist)
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }

  async generateNetworkSh () {
    // TODO: reduce log size
    const username = await this.localExec('whoami')
    const content = String.raw`#!/bin/bash
    echo "$(date)"
    echo "Network change"
    echo "==============="
scutil_query() {
    key=$1

    scutil<<EOT
    open
    get $key
    d.show
    close
EOT
}

get_primary_service() {
    local SERVICE_GUID=$(scutil_query State:/Network/Global/IPv4 | grep "PrimaryService" | awk '{print $3}')

    local SERVICE_NAME=$(scutil_query Setup:/Network/Service/$SERVICE_GUID | grep "UserDefinedName" | awk -F': ' '{print $2}')

    echo $SERVICE_NAME
}

get_primary_router() {
    local ROUTER_IP=$(scutil_query State:/Network/Global/IPv4 | grep "Router" | awk '{print $3}')
    echo $ROUTER_IP
}

VROUTERIP="${this.config.vrouter.ip}"
VROUTERNAME="${this.config.vrouter.name}"

# current router
ROUTERIP=$(get_primary_router)
echo "ROUTERIP: $ROUTERIP"
INTERFACE=$(get_primary_service)
echo "INTERFACE: $INTERFACE"

# check gateway & dns
GATEWAY=$(route -n get default | grep gateway | awk '{print $2}')
echo "GATEWAY: $GATEWAY"
DNS=$(/usr/sbin/networksetup -getdnsservers "$INTERFACE")
# echo "DNS: $DNS"

# check vm status
VMSTATE=$(su ${username.trim()} -c "/usr/local/bin/VBoxManage list runningvms | grep $VROUTERNAME")
echo "VMState: $VMSTATE"

# change route/dns
if [[ $GATEWAY ==  $VROUTERIP && $DNS != $VROUTERIP ]]; then
    if [[ -z $VMSTATE ]]; then
        echo "# vm is stopped. reset gateway to router"
        sudo /sbin/route change default $ROUTERIP
    else
        echo "# vm is running. change dns to vrouter"
        sudo /usr/sbin/networksetup -setdnsservers "$INTERFACE" "$VROUTERIP"
    fi
fi

if [[ $GATEWAY != $VROUTERIP && $DNS == $VROUTERIP ]]; then
    if [[ -z $VMSTATE ]]; then
        echo "# vm is stopped. reset DNS to router"
        sudo /usr/sbin/networksetup -setdnsservers "$INTERFACE" "$ROUTERIP"
    else
        echo "#vm is running. change gateway to vrouter"
        sudo /sbin/route change default $VROUTERIP
    fi
fi
echo ""`

    const cfgPath = path.join(this.config.host.configDir, this.config.host.networkSh)
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }

  downloadFile (src, dest) {
    const protocol = (new URL(src)).protocol
    const method = protocol === 'https:' ? https : http
    let destination = dest
    if (!dest) {
      destination = path.join(this.config.host.configDir, path.basename(src))
    }
    const tmp = path.join(os.tmpdir(), path.basename(src))
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmp)
      method.get(src, (response) => {
        response.pipe(file)
        file.on('finish', async () => {
          file.close()
          return fs.copy(tmp, destination)
            .then(() => {
              return resolve(destination)
            })
            .catch((err) => {
              return reject(err)
            })
        })
      }).on('error', (err) => {
        fs.unlink(tmp)
        return reject(err)
      })
    })
  }
  async hashFile (file) {
    try {
      const stats = await fs.stat(file)
      if (!stats.isFile()) {
        throw Error('file not existed')
      }
    } catch (err) {
      return ''
    }

    var algo = 'sha256'
    var shasum = crypto.createHash(algo)
    var s = fs.ReadStream(file)
    return new Promise((resolve, reject) => {
      s.on('data', function (d) { shasum.update(d) })
      s.on('end', function () {
        var d = shasum.digest('hex')
        resolve(d)
      })
    })
  }

  saveCfg2File () {
    const cfgPath = path.join(this.config.host.configDir, 'config.json')
    return fs.writeJson(cfgPath, this.config, {spaces: 2})
  }
  async upgradeCfg () {
    const template = path.join(__dirname, '..', 'config', 'config.json')
    const newCfg = fs.readJsonSync(template)
    // const oldCfg = fs.readJsonSync(path.join(this.config.host.configDir, 'config.json'))
    if (this.config.version === newCfg.version) {
      return
    }
    if (!this.config.version) {
      // version 0.1 to 0.2
      const ssFields = ['address', 'port', 'password', 'timeout', 'method', 'fastopen']
      ssFields.forEach((field) => {
        newCfg.shadowsocks.server[field] = this.config.shadowsocks.server[field]
      })
      const ktFields = ['address', 'port', 'key', 'crypt', 'mode']
      const others = []
      Object.keys(this.config.kcptun.server).forEach((key) => {
        if (ktFields.includes(key)) {
          newCfg.kcptun.server[key] = this.config.kcptun.server[key]
        } else {
          others.push(`${key}=${this.config.kcptun.server[key]}`)
        }
      })
      newCfg.kcptun.server.others = others.join(';')

      newCfg.firewall.currentMode = this.config.firewall.currentMode
      const dict = {
        'shadowsocks': 'ss',
        'kcptun': 'ssKt'
      }
      newCfg.firewall.currentProxies = dict[this.config.firewall.currentProtocol]

      newCfg.host.configDir = this.config.host.configDir
      this.config = newCfg

      const thirdParty = path.join(__dirname, '..', 'third_party')
      const remote = await this.connect()
      await remote.scp(`${thirdParty}/ssr-tunnel`, '/usr/bin/')
      await remote.scp(`${thirdParty}/ssr-redir`, '/usr/bin/')
      await remote.remoteExec('chmod +x /usr/bin/ssr-*')
      await remote.remoteExec('opkg update && opkg install libopenssl')
      await remote.service('shadowsocks', 'stop').catch(() => {})
      await remote.service('kcptun', 'stop').catch(() => {})
      await remote.remoteExec('rm /etc/com.icymind.vrouter/ss-dns.json').catch(() => {})
      await remote.changeProxies()
      await remote.closeConn()
    }
    return this.saveCfg2File()
  }
  async copyTemplate (fileName) {
    const template = path.join(__dirname, '..', 'config', fileName)
    const dest = path.join(this.config.host.configDir, fileName)
    try {
      await fs.stat(dest)
      return dest
    } catch (error) {
      winston.debug(`copy template: ${fileName}`)
      await fs.copy(template, dest)
      return dest
    }
  }
  async connect (startFirst) {
    const state = await this.getvmState()
    if (state !== 'running') {
      throw Error("vm doesn't running.")
    }
    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            reject(err)
          } else {
            resolve(new VRouterRemote(conn, sftp, this.config, this))
          }
        })
      }).connect({
        host: this.config.vrouter.ip,
        port: this.config.vrouter.port,
        username: this.config.vrouter.username,
        password: this.config.vrouter.password,
        keepaliveInterval: 60000,
        readyTimeout: 1500
      })
    })
  }
}
module.exports = {
  VRouter
}
