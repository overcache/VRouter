const { exec } = require('child_process')
const Client = require('ssh2').Client
const scpClient = require('scp2')
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

class VRouter {
  constructor () {
    let config
    try {
      config = fs.readJsonSync(path.join(getAppDir(), packageJson.name, 'config.json'))
    } catch (err) {
      config = fs.readJsonSync(path.join(__dirname, '..', 'config', 'config.json'))
    }
    if (!config.host.configDir) {
      config.host.configDir = path.join(getAppDir(), packageJson.name)
    }
    this.config = config
    this.process = new EventEmitter()
    this.remote = null
  }

  // os
  wait (time) {
    return new Promise(resolve => setTimeout(resolve, time))
  }
  sudoExec (cmd) {
    const option = {
      name: 'VRouter',
      icns: path.join(__dirname, '..', 'build', 'icon.icns')
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
    const cmd = `/usr/local/bin/VBoxManage controlvm ${this.config.vrouter.name} keyboardputscancode ${key}`
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
    return this.localExec(cmd)
      .then((output) => {
        const reg = /\(\d+\) (.*)\n\(Hardware Port: .*?, Device: (.*)\)/g
        while (true) {
          const match = reg.exec(output)
          if (!match) break
          if (match[2] === inf) {
            return Promise.resolve(match[1])
          }
        }
        return Promise.reject(Error(`can not find NetworkService match ${inf}`))
      })
  }
  async getCurrentGateway () {
    let networkService

    const inf = await this.getActiveAdapter()
    if (inf.length > 1) {
      return Promise.reject(Error('more than one active adapter'))
    }
    if (inf.length === 0) {
      networkService = 'Wi-Fi'
    } else {
      networkService = await this.getOSXNetworkService(inf[0].split(':')[0].trim())
    }

    const cmd1 = "/usr/sbin/netstat -nr | grep default | awk '{print $2}'"
    const cmd2 = `/usr/sbin/networksetup -getdnsservers ${networkService}`

    return Promise.all([
      this.localExec(cmd1).then((output) => {
        return Promise.resolve((output && output.trim()) || '')
      }),
      this.localExec(cmd2).then((output) => {
        return Promise.resolve((output && output.trim()) || '')
      })
    ])
  }
  async changeRouteTo (dst = 'wifi') {
    let ip
    let networkService
    const inf = await this.getActiveAdapter()
    if (inf.length > 1) {
      return Promise.reject(Error('more than one active adapter'))
    }
    if (inf.length === 0) {
      networkService = 'Wi-Fi'
    } else {
      networkService = await this.getOSXNetworkService(inf[0].split(':')[0].trim())
    }
    if (dst === 'vrouter') {
      ip = this.config.vrouter.ip
    } else {
      // const subCmd = `/usr/sbin/networksetup -getinfo ${networkService} | grep Router | awk -F ": " '{print $2}'`
      const subCmd = `/usr/sbin/networksetup -getinfo ${networkService} | grep Router`
      ip = await this.localExec(subCmd)
        .then((output) => {
          const ipReg = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/ig
          const match = ipReg.exec(output)
          if (match && match[1]) {
            return Promise.resolve(match[1])
          } else {
            return Promise.reject(Error('can not get Router IP'))
          }
        })
    }
    const cmd1 = `/sbin/route change default ${ip}`
    const cmd2 = `/usr/sbin/networksetup -setdnsservers ${networkService} "${ip}"`
    // https://askubuntu.com/questions/634620/when-using-and-sudo-on-the-first-command-is-the-second-command-run-as-sudo-t
    return this.sudoExec(`bash -c "${cmd1} && ${cmd2}"`)
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
      `/usr/local/bin/VBoxManage convertfromraw --format VDI stdin "${vdi}" ${vdiSize}`)

    subCmds.push(`/usr/local/bin/VBoxManage createvm --name ${this.config.vrouter.name} --register`)

    subCmds.push(`/usr/local/bin/VBoxManage modifyvm ${this.config.vrouter.name} ` +
      ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
      ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
      ` --audio "none" `)

    subCmds.push(`/usr/local/bin/VBoxManage storagectl ${this.config.vrouter.name} ` +
      `--name "SATA Controller" --add "sata" --portcount "4" ` +
      `--hostiocache "on" --bootable "on"`)

    subCmds.push(`/usr/local/bin/VBoxManage storageattach ${this.config.vrouter.name} ` +
      `--storagectl "SATA Controller" --port "1" ` +
      `--type "hdd" --nonrotational "on" --medium "${vdi}"`)

    return this.localExec(subCmds.join(' && '))
      .then(() => {
        return this.lockGUIConfig()
      })
      .then(() => {
        return this.hidevm()
      })
      .then(() => {
        return this.toggleSerialPort('on')
          .then(() => {
            this.process.emit('build', '配置虚拟机串口')
          })
      })
      .then(() => {
        return this.configvmNetwork()
          .then(() => {
            this.process.emit('build', '配置虚拟机网络')
          })
          .catch((err) => {
            this.process.emit('err', '配置虚拟机网络失败')
            console.log('error when configvmNetwork. continue following steps')
            console.log(err)
          })
      })
      .then(() => {
        return this.startvm()
          .then(() => {
            this.process.emit('build', '开始启动虚拟机...请稍候30秒')
          })
          .then(() => {
            return this.wait(30000)
          })
      })
      .then(() => {
        return this.changevmPwd()
          .then(() => {
            this.process.emit('build', '修改虚拟机密码')
          })
      })
      .then(() => {
        return this.configDnsmasq()
          .then(() => {
            this.process.emit('build', '配置Dnsmasq')
          })
      })
      .then(() => {
        return this.changevmTZ()
          .then(() => {
            this.process.emit('build', '修改虚拟机时区')
          })
      })
      .then(() => {
        return this.configvmLanIP()
          .then(() => {
            this.process.emit('build', '配置虚拟机网络地址, 请稍候')
          })
          .then(() => {
            return this.wait(10000)
          })
      })
      .then(() => {
        return this.installPackage()
          .then(() => {
            this.process.emit('build', '安装 dnsmasq-full 以及 ipset, 等待30秒')
          })
          .then(() => {
            return this.wait(30000)
          })
      })
      .then(() => {
        const src = path.join(__dirname, '..', 'third_party')
        const dst = this.config.vrouter.configDir + '/third_party/'
        return this.scp(src, dst)
          .then(() => {
            this.process.emit('build', '拷贝 shadowsocks[r] 以及 kcptun 到虚拟机')
          })
          .then(() => {
            return this.serialLog('done: scp third_party')
          })
      })
      .then(() => {
        return this.scpConfigAll()
          .then(() => {
            this.process.emit('build', '拷贝配置文件到虚拟机')
          })
          .then(() => {
            return this.serialLog('done: scpConfigAll')
          })
      })
      .then(() => {
        return this.connect()
          .then((remote) => {
            this.process.emit('build', '登录虚拟机')
            return Promise.resolve(remote)
          })
      })
      .then((remote) => {
        return this.serialLog('done: connect to vm')
          .then(() => {
            return remote.installKt()
          })
          .then(() => {
            return this.serialLog('done: installKt')
              .then(() => {
                this.process.emit('build', '安装 kcptun')
              })
          })
          .then(() => {
            if (this.config.firewall.currentProxies.includes('Kt')) {
              return this.enableService('kcptun')
              .then(() => {
                this.process.emit('build', '设置 kcptun 随虚拟机启动')
              })
              .then(() => {
                return this.serialLog('done: enable kcptun')
              })
            }
          })
          .then(() => {
            return remote.installSs()
              .then(() => {
                this.process.emit('build', '安装 shadowsocks')
              })
              .then(() => {
                return this.serialLog('done: install SS')
              })
          })
          .then(() => {
            const p = this.config.firewall.currentProxies
            if (p === 'ss' || p === 'ssKt') {
              return this.enableService('shadowsocks')
                .then(() => {
                  this.process.emit('build', '设置 shadowsocks 随虚拟机启动')
                })
                .then(() => {
                  return this.serialLog('done: enable SS')
                })
            }
          })
          .then(() => {
            return remote.installSsr()
              .then(() => {
                this.process.emit('build', '安装 shadowsocksr')
              })
              .then(() => {
                return this.serialLog('done: install ssr')
              })
          })
          .then(() => {
            if (this.config.firewall.currentProxies.substr(0, 3) === 'ssr') {
              return this.enableService('shadowsocksr')
                .then(() => {
                  this.process.emit('build', '设置 shadowsocksr 随虚拟机启动')
                })
                .then(() => {
                  return this.serialLog('done: enable ssr')
                })
            }
          })
          .then(() => {
            return this.enableService('cron')
              .then(() => {
                this.process.emit('build', '启用 cron 服务')
              })
              .then(() => {
                return this.serialLog('done: enable cron')
              })
          })
          .then(() => {
            return this.configWatchdog()
              .then(() => {
                this.process.emit('build', '安装守护脚本')
              })
              .then(() => {
                return this.serialLog('done: install watchdog')
              })
          })
          .then(() => {
            return this.serialLog('done: shutting down')
              .then(() => {
                this.process.emit('build', '保存设置, 关闭虚拟机...')
              })
              .then(() => {
                return remote.shutdown()
              })
          })
          .then(() => {
            return remote.closeConn().catch(() => {})
          })
      })
      .then(() => {
        return this.wait(10000)
      })
      .catch((err) => {
        console.log(err)
        return Promise.reject(err)
      })
  }
  guiLogin () {
    const cmd = `VBoxManage startvm ${this.config.vrouter.name} --type separate`
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
          .then(() => {
            return this.wait(35000)
          })
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
    const pre = `echo "" |  nc -U "${serialPath}"`
    const serialCmd = `echo "${cmd}" | /usr/bin/nc -U '${serialPath}'`

    // 先执行两遍pre
    await this.localExec(pre)
      .then(() => {
        return this.localExec(pre)
      })
      .then(() => {
        // console.log(serialCmd)
        return this.localExec(serialCmd)
      })
  }

  importvm (vmFile) {
    const cmd = `/usr/local/bin/VBoxManage import ${vmFile}`
    return this.localExec(cmd)
  }
  async deletevm (stopFirst = false) {
    const cmd = `/usr/local/bin/VBoxManage unregistervm ${this.config.vrouter.name} --delete`
    const existed = await this.isVRouterExisted()
    if (!existed) {
      return
    }
    const state = await this.getvmState()
    if (state === 'running' && !stopFirst) {
      throw Error('vm must be stopped before delete')
    }
    await this.stopvm('force', 3000)
    return this.localExec(cmd)
  }
  async startvm (type = 'headless', waitTime = 100) {
    const state = await this.getvmState()
    if (state !== 'running') {
      const cmd = `/usr/local/bin/VBoxManage startvm --type ${type} ${this.config.vrouter.name}`
      return this.localExec(cmd)
          .then(() => {
            return this.wait(1000)
              .then(() => {
                // skip grub's waiting time
                return this.sendKeystrokes()
              })
          })
          .then(() => {
            // skip grub's waiting time
            return this.wait(500)
              .then(() => {
                return this.sendKeystrokes()
              })
          })
        .then(() => {
          return this.wait(waitTime)
        })
    }
  }
  async stopvm (action = 'savestate', waitTime = 100) {
    const serialPortState = await this.isSerialPortOn()
    const vmState = await this.getvmState()
    if (vmState === 'running') {
      if (action === 'poweroff') {
        if (serialPortState) {
          // poweroff from inside openwrt is more safer.
          return this.serialExec('poweroff', 'poweroff')
            .then(() => {
              return this.wait(8000)
            })
        } else {
          const cmd = `/usr/local/bin/VBoxManage controlvm ${this.config.vrouter.name} poweroff`
          return this.localExec(cmd)
            .then(() => {
              return this.wait(waitTime)
            })
        }
      }
      if (action === 'savestate') {
        const cmd = `/usr/local/bin/VBoxManage controlvm ${this.config.vrouter.name} savestate`
        return this.localExec(cmd)
          .then(() => {
            return this.wait(waitTime)
          })
      }
    } else if (vmState === 'saved') {
      if (action === 'poweroff') {
        return this.localExec(`/usr/local/bin/VBoxManage discardstate ${this.config.vrouter.name}`)
          .then(() => {
            return this.wait(5000)
          })
      }
    }
  }

  hidevm (action = true) {
    const cmd = `/usr/local/bin/VBoxManage setextradata ${this.config.vrouter.name} GUI/HideFromManager ${action}`
    return this.localExec(cmd)
  }
  lockGUIConfig (action = true) {
    const cmd = `/usr/local/bin/VBoxManage setextradata ${this.config.vrouter.name} GUI/PreventReconfiguration ${action}`
    return this.localExec(cmd)
  }

  isVBInstalled () {
    const cmd = '/usr/local/bin/VBoxManage --version'
    return this.localExec(cmd)
      .then(() => {
        return Promise.resolve(true)
      })
      .catch(() => {
        return Promise.resolve(false)
      })
  }
  isVRouterExisted () {
    const cmd = `/usr/local/bin/VBoxManage showvminfo ${this.config.vrouter.name}`
    return this.localExec(cmd)
      .then(() => {
        return Promise.resolve(true)
      })
      .catch(() => {
        return Promise.resolve(false)
      })
  }
  getvmState () {
    // much slow than 'VBoxManage list runningvms'
    const cmd = `/usr/local/bin/VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable | grep VMState=`
    return this.localExec(cmd)
      .then((output) => {
        const state = output.trim().split('=')[1].replace(/"/g, '')
        return state
      })
  }
  isVRouterRunning () {
    // State:           running (since 2017-06-16T02:13:09.066000000)
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep vmState
    // vmState="running"
    const cmd = '/usr/local/bin/VBoxManage list runningvms'
    return this.localExec(cmd)
      .then((stdout) => {
        const vms = stdout
          .trim().split('\n')
          .map(e => e.split(' ')[0].trim().replace(/"/g, ''))
        if (vms.includes(this.config.vrouter.name)) {
          return Promise.resolve(true)
        } else {
          return Promise.resolve(false)
        }
      })
  }

  getInfIP (inf) {
    const cmd = `/sbin/ifconfig ${inf}`
    return this.localExec(cmd)
      .then((output) => {
        const ipMatch = /inet (\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}) netmask/ig.exec(output)
        const ip = (ipMatch && ipMatch[1]) || ''
        return Promise.resolve(ip)
      })
  }
  getAllInf () {
    const cmd = '/sbin/ifconfig'
    return this.localExec(cmd)
  }
  getHostonlyInf () {
    // return [correspondingInf, firstAvailableInf]
    return this.getAllInf()
      .then((infs) => {
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
      })
  }
  createHostonlyInf () {
    const cmd = `/usr/local/bin/VBoxManage hostonlyif create`
    return this.localExec(cmd)
      .then((output) => {
        const infMatch = /Interface '(.*)'/ig.exec(output)
        return infMatch && infMatch[1]
      })
  }
  removeHostonlyInf (inf) {
    const cmd = `/usr/local/bin/VBoxManage hostonlyif remove ${inf}`
    return this.localExec(cmd)
  }
  async configHostonlyInf (inf, netmask = '255.255.255.0') {
    let iinf = inf
    if (!inf) {
      const infs = await this.getHostonlyInf()
      iinf = infs[0] || infs[1] || await this.createHostonlyInf()
    }
    const cmd = `/usr/local/bin/VBoxManage hostonlyif ipconfig ${iinf} --ip ${this.config.host.ip} --netmask ${netmask}`
    return this.localExec(cmd)
      .then(() => {
        return Promise.resolve(iinf)
      })
  }

  getActiveAdapter () {
    return this.getAllInf()
      .then((output) => {
        const reg = /^\w+:.*\n(?:\t.*\n)*/img
        let infs = []
        while (true) {
          let infMatch = reg.exec(output)
          if (!infMatch) break
          let infConfig = infMatch[0]
          if (!/status: active/ig.test(infConfig)) continue
          if (!/inet \d+\.\d+\.\d+\.\d+ netmask/ig.test(infConfig)) continue
          infs.push(/^(\w+):.*/ig.exec(infConfig)[1])
        }
        return infs
      })
      .then((infs) => {
        const cmd = '/usr/local/bin/VBoxManage list bridgedifs'
        return this.localExec(cmd)
          .then((bridgedIfs) => {
            return infs.map((element) => {
              const raw = String.raw`^Name:\s*(${element}.*)`
              const reg = new RegExp(raw, 'ig')
              const nameMatch = reg.exec(bridgedIfs)
              return nameMatch && nameMatch[1]
            })
          })
          .then((arr) => {
            return arr.filter(element => element !== null)
          })
      })
  }
  async specifyHostonlyAdapter (inf, nic = '1') {
    let iinf = inf
    if (!iinf) {
      iinf = await this.configHostonlyInf()
    }
    const cmd = `/usr/local/bin/VBoxManage modifyvm ${this.config.vrouter.name} ` +
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
    let iinf = inf
    if (!iinf) {
      let arr = await this.getActiveAdapter()
      if (arr.length === 0) {
        // return Promise.resolve('en0: Wi-Fi (AirPort)')
        iinf = 'en0: Wi-Fi (AirPort)'
      } else if (arr.length > 1) {
        console.log(arr)
        return Promise.reject(Error(`more than one active adapter: ${arr}`))
      } else {
        iinf = arr[0]
      }
    }
    const cmd = `/usr/local/bin/VBoxManage modifyvm ${this.config.vrouter.name} ` +
      `--nic${nic} bridged ` +
      ` --nictype${nic} "82540EM" ` +
      `--bridgeadapter${nic} "${iinf.replace(/["']/g, '')}" ` +
      `--cableconnected${nic} "on"`
    const vmState = await this.getvmState()
    if (vmState !== 'poweroff') {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
  }

  isNIC1ConfigedAsHostonly () {
    let cmd = `/usr/local/bin/VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable | grep 'nic1\\|hostonlyadapter1'`
    return this.localExec(cmd)
      .then((output) => {
        // hostonlyadapter1="vboxnet4"
        // nic1="hostonly"
        const infos = new Map()
        output.trim().split('\n').map((element) => {
          const temp = element.split('=')
          infos.set(temp[0].replace(/"/g, ''), temp[1].replace(/"/g, ''))
        })
        if (infos.get('nic1') !== 'hostonly') {
          return Promise.reject(Error("NIC1 isn't hostonly network"))
        }
        if (!/^vboxnet\d+$/ig.test(infos.get('hostonlyadapter1'))) {
          return Promise.reject(Error("NIC1 doesn't specify host-only adapter"))
        }
        return infos.get('hostonlyadapter1')
      })
      .then((inf) => {
        return this.getInfIP(inf)
          .then((ip) => [inf, ip])
      })
      .then(([inf, ip]) => {
        if (ip !== this.config.host.ip) {
          return Promise.reject(Error("host-only adapter doesn't config as hostIP"))
        }
        return inf
      })
  }
  isNIC2ConfigedAsBridged () {
    let cmd = `/usr/local/bin/VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable | grep 'nic2\\|bridgeadapter2'`
    return this.localExec(cmd)
      .then((output) => {
        const infos = new Map()
        output.trim().split('\n').map((element) => {
          const temp = element.split('=')
          infos.set(temp[0].replace(/"/g, ''), temp[1].replace(/"/g, ''))
        })
        if (infos.get('nic2') !== 'bridged') {
          return Promise.reject(Error("NIC2 isn't bridged network"))
        }
        const inf = infos.get('bridgeadapter2')
        if (!inf) {
          return Promise.reject(Error("NIC2 doesn't specify bridged adapter"))
        }
        cmd = `/sbin/ifconfig ${inf.trim().split(':')[0]}`
        return this.localExec(cmd)
          .then((infConfig) => {
            const statusMatch = /status: active/ig.exec(infConfig)
            if (!statusMatch) return Promise.reject(Error("bridged adapter doesn't active"))
            return inf
          })
      })
  }

  configvmNetwork () {
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
    return this.isNIC1ConfigedAsHostonly(this.config.vrouter.name, this.config.host.ip)
      .catch(() => {
        return this.specifyHostonlyAdapter()
      })
      .then(() => {
        return this.isNIC2ConfigedAsBridged(this.config.vrouter.name)
      })
      .catch(() => {
        return this.specifyBridgeAdapter()
      })
  }

  isSerialPortOn () {
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep "uart\(mode\)\?1"
    // uart1="0x03f8,4"
    // uartmode1="server,/Users/simon/Library/Application Support/VRouter/serial"
    const cmd = `/usr/local/bin/VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable  | grep "uart\\(mode\\)\\?1"`
    return this.localExec(cmd)
      .then((output) => {
        const infos = new Map()
        output.trim().split('\n').map((element) => {
          const temp = element.split('=')
          infos.set(temp[0].replace(/"/g, ''), temp[1].replace(/"/g, ''))
        })
        return infos.get('uart1') === '0x03f8,4' &&
          infos.get('uartmode1') === `server,${path.join(this.config.host.configDir, this.config.host.serialFile)}`
      })
  }
  async toggleSerialPort (action = 'on', num = 1) {
    const serialPath = path.join(this.config.host.configDir, this.config.host.serialFile)
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${num} server "${serialPath}"` : 'off'
    const cmd = `/usr/local/bin/VBoxManage modifyvm ${this.config.vrouter.name} --uart${num} ${subCmd}`
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
    return this.serialExec(subCmds.join(' && '), 'config lan ipaddr')
      .then(() => {
        return this.serialLog('done: configvmLanIP')
      })
  }

  configDnsmasq () {
    const cmd = "mkdir /etc/dnsmasq.d && echo 'conf-dir=/etc/dnsmasq.d/' > /etc/dnsmasq.conf"
    return this.serialExec(cmd, 'configDnsmasq')
      .then(() => {
        return this.serialLog('done: configDnsmasq')
      })
  }
  enableService (service) {
    const cmd1 = `chmod +x /etc/init.d/${service} && /etc/init.d/${service} enable`
    // const cmd2 = `/etc/init.d/${service} restart`
    return this.serialExec(cmd1, `enable ${service}`)
    // .then(() => {
    // return this.serialExec(cmd2, `start ${service}`)
    // })
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
        uci set system.@system[0].hostname='VRouter'
        uci set system.@system[0].timezone='HKT-8'
        uci set system.@system[0].zonename='Asia/Hong Kong'
        uci commit system`
    return this.serialExec(cc.trim().split('\n').map(line => line.trim()).join(' && '), 'change timezone')
      .then(() => {
        return this.serialLog('done: changevmTZ')
      })
  }
  async changevmPwd () {
    return this.serialExec("echo -e 'root\\nroot' | (passwd root)", 'change password')
      .then(() => {
        return this.serialLog('done: changevmPwd')
      })
  }
  serialLog (msg) {
    const cmd = `echo '${msg}' >> /vrouter.log`
    return this.serialExec(cmd, 'log to file')
  }
  async installPackage () {
    const subCmds = []
    subCmds.push(`sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\\/openwrt/g' /etc/opkg/distfeeds.conf`)
    subCmds.push('opkg update')
    subCmds.push('opkg remove dnsmasq && opkg install dnsmasq-full ipset openssh-sftp-server')
    subCmds.push('/etc/init.d/dropbear restart')
    return this.serialExec(subCmds.join(' && '), 'install packages')
      .then(() => {
        return this.serialLog('done: install package && restart dropbear')
      })
  }

  deleteCfgFile (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    return fs.remove(filePath)
      .catch(() => {
        // don't panic. that's unnecessary to delete a non existed file.
      })
  }
  getCfgContent (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    return fs.readFile(filePath, 'utf8')
      .catch(() => {
        const template = path.join(__dirname, '../config', fileName)
        return fs.copy(template, filePath)
          .then(() => {
            return fs.readFile(filePath, 'utf8')
          })
      })
  }
  async generateIPsets (overwrite = false) {
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.ipsetsFile)
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

    // create or flush ipset
    ws.write(`create ${this.config.firewall.ipsets.lan}   hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`create ${this.config.firewall.ipsets.white} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`create ${this.config.firewall.ipsets.black} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)

    // "selectedBL": {"gfwDomains":true, "extraBlackList":true},
    // "selectedWL": {"chinaIPs":true, "lanNetworks":true, "extraWhiteList":true},
    if (this.config.firewall.selectedWL.lanNetworks) {
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
    const cfg = this.config[proxy]
    const ipPatthen = /^\d+.\d+.\d+.\d+$/ig
    if (ipPatthen.test(cfg.server.address)) {
      return Promise.resolve(cfg.server.address)
    }
    return new Promise((resolve, reject) => {
      dns.lookup(cfg.server.address, { family: 4 }, (err, address, family) => {
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
    const proxies = p || this.config.firewall.currentProxies
    const mode = m || this.config.firewall.currentMode
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
        throw Error('unkown proxies')
    }

    ws.write('# com.icymind.vrouter\n')
    ws.write(`# workMode: ${mode}\n`)
    ws.write('ipset flush\n')
    ws.write(`/usr/sbin/ipset restore -f -! ${this.config.vrouter.configDir}/${this.config.firewall.ipsetsFile} &> /dev/null\n`)

    // if kcp protocol: speedup ssh
    // if (proxy === 'kcptun' && this.config.server.sshPort) {
      // ws.write('# speedup ssh connection if current proxy is kcptun\n')
      // const rule = `-d ${ssServerIP} -p tcp --dport ${this.config.server.sshPort} -j REDIRECT --to-port ${redirPort}`
      // ws.write(this.generateFWRulesHelper(rule))
    // }

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
      `127.0.0.1#${this.config.ssDns.dnsPort}`
    ]
  }
  async generateDnsmasqCf (overwrite = false) {
    // const mode = m || this.config.firewall.currentMode
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

    if (this.config.firewall.currentMode === 'none') {
      ws.write('# stay in wall\n')
      ws.end()
      return promise
    }
    if (this.config.firewall.selectedBL.gfwDomains) {
      const gfwDomains = await this.getCfgContent(this.config.firewall.gfwDomains)
      gfwDomains.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          ws.write(`server=/${trimLine}/${DNSs[1]}\n`)
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
            ws.write(`server=/${trimLine}/${DNSs[1]}\n`)
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
            ws.write(`server=/${trimLine}/${DNSs[0]}\n`)
            ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.white}\n`)
          }
        }
      })
    }

    ws.end()
    return promise
  }
  generateCronJob () {
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.cronFile)
    const content = `* * * * * ${this.config.vrouter.configDir}/${this.config.firewall.watchdogFile}\n`
    return fs.outputFile(cfgPath, content, 'utf8')
      .then(() => {
        return Promise.resolve(cfgPath)
      })
  }
  generateWatchdog (p) {
    const proxies = p || this.config.firewall.currentProxies
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.watchdogFile)
    let content = '#!/bin/sh\n'
    const ssDns = String.raw`
      ssDns=$(ps -w| grep "[s]s-tunnel -c .*ss-dns.json")
      if [[ -z "$ssDns" ]];then
        /etc/init.d/${this.config.ssDns.service} restart
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
    if (this.config.firewall.enableSsDns) {
      content += ssDns
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
    return fs.outputFile(cfgPath, content, 'utf8')
      .then(() => {
        return Promise.resolve(cfgPath)
      })
  }
  generateService (type = 'shadowsocks') {
    // type=ssDns/shadowsocks/shadowsocksr/kcptun
    const cfgPath = path.join(this.config.host.configDir, this.config[type].service)
    let content = ''
    switch (type) {
      case 'ssDns':
        content = String.raw`#!/bin/sh /etc/rc.common
          # Copyright (C) 2006-2011 OpenWrt.org
          START=85
          SERVICE_USE_PID=1
          SERVICE_WRITE_PID=1
          SERVICE_DAEMONIZE=1
          start() {
              service_start /usr/bin/ss-tunnel -c ${this.config.vrouter.configDir}/${this.config.ssDns.dns}
          }
          stop() {
              service_stop /usr/bin/ss-tunnel
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
              ${this.config.firewall.currentProxies.includes('Kt') ? overKt : noKt}
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
    return fs.outputFile(cfgPath, content)
      .then(() => {
        return Promise.resolve(cfgPath)
      })
  }
  async generateConfig (type = 'shadowsocks') {
    const cfgs = []
    switch (type) {
      case 'shadowsocks':
        cfgs.push(this.config.shadowsocks.client)
        if (this.config.firewall.currentProxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocks.overKt)
        }
        break
      case 'shadowsocksr':
        cfgs.push(this.config.shadowsocksr.client)
        if (this.config.firewall.currentProxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocksr.overKt)
        }
        break
      case 'ssDns':
        cfgs.push(this.config.ssDns.dns)
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
  generateConfigHeler (type = 'ss-client') {
    let cfg
    let content = {}
    switch (type) {
      case this.config.shadowsocks.client:
        cfg = this.config.shadowsocks.client
        content = {
          'server': this.config.shadowsocks.server.address,
          'server_port': this.config.shadowsocks.server.port,
          'local_address': '0.0.0.0',
          'local_port': this.config.shadowsocks.clientPort,
          'password': this.config.shadowsocks.server.password,
          'timeout': this.config.shadowsocks.server.timeout,
          'method': this.config.shadowsocks.server.method,
          'fast_open': true,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocks.overKt:
        cfg = this.config.shadowsocks.overKt
        content = {
          'server': '127.0.0.1',
          'server_port': this.config.kcptun.clientPort,
          'local_address': '0.0.0.0',
          'local_port': this.config.shadowsocks.overKtPort,
          'password': this.config.shadowsocks.server.password,
          'timeout': 20,
          'method': this.config.shadowsocks.server.method,
          'fast_open': true,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocksr.client:
        cfg = this.config.shadowsocksr.client
        content = {
          'server': this.config.shadowsocksr.server.address,
          'server_port': this.config.shadowsocksr.server.port,
          'local_address': '0.0.0.0',
          'local_port': this.config.shadowsocksr.clientPort,
          'password': this.config.shadowsocksr.server.password,
          'timeout': this.config.shadowsocksr.server.timeout,
          'method': this.config.shadowsocksr.server.method,
          'fast_open': true,
          'mode': 'tcp_only'
        }
        this.config.shadowsocksr.server.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.shadowsocksr.overKt:
        cfg = this.config.shadowsocksr.overKt
        content = {
          'server': '127.0.0.1',
          'server_port': this.config.kcptun.clientPort,
          'local_address': '0.0.0.0',
          'local_port': this.config.shadowsocksr.overKtPort,
          'password': this.config.shadowsocksr.server.password,
          'timeout': 20,
          'method': this.config.shadowsocksr.server.method,
          'fast_open': true,
          'mode': 'tcp_only'
        }
        this.config.shadowsocksr.server.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.ssDns.dns:
        cfg = this.config.ssDns.dns
        const isSsr = this.config.firewall.currentProxies.includes('ssr')
        const obj = isSsr ? this.config.shadowsocksr : this.config.shadowsocks
        content = {
          'server': obj.server.address,
          'server_port': obj.server.port,
          'local_address': '0.0.0.0',
          'local_port': this.config.ssDns.dnsPort,
          'password': obj.server.password,
          'timeout': obj.server.timeout,
          'method': obj.server.method,
          'fast_open': true,
          'tunnel_address': '8.8.8.8:53',
          'mode': 'udp_only'
        }
        if (isSsr) {
          obj.server.others.split(';').forEach((kv) => {
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
          'remoteaddr': `${this.config.kcptun.server.address}:${this.config.kcptun.server.port}`,
          'localaddr': `:${this.config.kcptun.clientPort}`,
          'key': this.config.kcptun.server.key,
          'crypt': this.config.kcptun.server.crypt,
          'mode': this.config.kcptun.server.mode
        }
        this.config.kcptun.server.others.split(';').forEach((kv) => {
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
    return fs.writeJson(cfgPath, content, {spaces: 2})
      .then(() => {
        return Promise.resolve(cfgPath)
      })
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
  scp (src, dst) {
    if (!src) {
      throw Error('must specify src for scp')
    }
    let dest = dst || this.config.vrouter.configDir
    const opt = {
      host: this.config.vrouter.ip,
      username: this.config.vrouter.username,
      password: this.config.vrouter.password,
      path: dest
    }
    return new Promise((resolve, reject) => {
      scpClient.scp(src, opt, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve(dest)
        }
      })
    })
  }
  copyTemplate (fileName) {
    const template = path.join(__dirname, '..', 'config', fileName)
    const dest = path.join(this.config.host.configDir, fileName)
    return fs.stat(dest)
      .then(() => {
        return Promise.resolve(dest)
      })
      .catch(() => {
        console.log(`${dest} not exist, copy template to it.`)
        return fs.copy(template, dest)
          .then(() => {
            return Promise.resolve(dest)
          })
      })
  }
  async scpConfig (type = 'shadowsocks', overwrite = false) {
    switch (type) {
      case 'ssDnsService':
        await this.generateService('ssDns')
          .then((p) => {
            return this.scp(p, '/etc/init.d/')
              .then(() => {
                return this.serialExec(`chmod +x /etc/init.d/ssDns`)
              })
          })
        break
      case 'ssService':
        await this.generateService('shadowsocks')
          .then((p) => {
            return this.scp(p, '/etc/init.d/')
              .then(() => {
                return this.serialExec(`chmod +x /etc/init.d/shadowsocks`)
              })
          })
        break
      case 'ssrService':
        await this.generateService('shadowsocksr')
          .then((p) => {
            return this.scp(p, '/etc/init.d/')
              .then(() => {
                return this.serialExec(`chmod +x /etc/init.d/shadowsocksr`)
              })
          })
        break
      case 'ktService':
        await this.generateService('kcptun')
          .then((p) => {
            return this.scp(p, '/etc/init.d/')
              .then(() => {
                return this.serialExec(`chmod +x /etc/init.d/kcptun`)
              })
          })
        break
      case 'ssDns':
      case 'shadowsocks':
      case 'shadowsocksr':
      case 'kcptun':
        await this.generateConfig(type)
          .then(async (p) => {
            for (let i = 0; i < p.length; i++) {
              await this.scp(p[i], this.config.vrouter.configDir)
            }
          })
        break
      case 'dnsmasq':
        await this.generateDnsmasqCf(overwrite)
          .then((p) => {
            return this.scp(p, '/etc/dnsmasq.d/')
          })
        break
      case 'ipset':
        await this.generateIPsets(overwrite)
          .then((p) => {
            return this.scp(p, this.config.vrouter.configDir)
          })
        break
      case 'firewall':
        await this.generateFWRules(null, null, overwrite)
          .then((p) => {
            return this.scp(p, '/etc/')
          })
        break
      case 'watchdog':
        await this.generateWatchdog()
          .then((p) => {
            return this.scp(p, this.config.vrouter.configDir)
              .then(() => {
                return this.serialExec(`chmod +x ${this.config.vrouter.configDir}/${this.config.firewall.watchdogFile}`)
              })
          })
        break
      case 'cron':
        await this.generateCronJob()
          .then((p) => {
            return this.scp(p, this.config.vrouter.configDir)
          })
        break
    }
  }
  async scpConfigAll (overwrite) {
    const types = [
      'dnsmasq',
      'ipset',
      'firewall',
      'watchdog',
      'cron'
    ]
    if (this.config.firewall.enableSsDns) {
      types.push('ssDnsService')
      types.push('ssDns')
    }
    const proxies = this.config.firewall.currentProxies
    if (proxies.includes('Kt')) {
      types.push('kcptun')
      types.push('ktService')
    }
    if (proxies.substr(0, 3) === 'ssr') {
      types.push('shadowsocksr')
      types.push('ssrService')
    } else if (proxies.substr(0, 2) === 'ss') {
      types.push('shadowsocks')
      types.push('ssService')
    }
    for (let i = 0; i < types.length; i += 1) {
      await this.scpConfig(types[i], overwrite)
    }
  }
  connect (startFirst) {
    return this.getvmState()
      .then((state) => {
        if (state !== 'running') {
          return Promise.reject(Error("vm doesn't running."))
        }
      })
      .then(() => {
        return new Promise((resolve, reject) => {
          const conn = new Client()
          conn.on('ready', () => {
            resolve(new VRouterRemote(conn, this.config, this))
          }).connect({
            host: this.config.vrouter.ip,
            port: this.config.vrouter.port,
            username: this.config.vrouter.username,
            password: this.config.vrouter.password,
            keepaliveInterval: 60000,
            readyTimeout: 1500
          })
        })
      })
  }
}

module.exports = {
  VRouter
}
