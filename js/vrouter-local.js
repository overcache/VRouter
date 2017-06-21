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

class VRouter {
  constructor (config) {
    if (!config.host.configDir) {
      config.host.configDir = path.join(getAppDir(), packageJson.name)
    }
    this.config = config
  }

  wait (time) {
    return new Promise(resolve => setTimeout(resolve, time))
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
          resolve(stdout)
        }
      })
    })
  }
  async serialExec (cmd) {
    const serialPortState = await this.isSerialPortOn()

    // toggleSerialPort on
    if (!serialPortState) {
      // turn vm off if necessary
      await this.stopVM('poweroff')
      await this.toggleSerialPort('on')
    }

    const state = await this.getVMState()
    // startVM if necessary
    if (state !== 'running') {
      try {
        await this.startVM()
          .then(() => {
            return this.wait(35000)
          })
      } catch (err) {
        console.log(err)
        console.log('startvm error')
        console.log('try again')
        await this.stopVM('poweroff')
        console.log('turn vm off finish')
        console.log('now try to turn vm on')
        await this.startVM()
      }
    }

    const serialPath = path.join(this.config.host.configDir, this.config.host.serialFile)
    const pre = `echo "" |  nc -U "${serialPath}"`
    const serialCmd = `echo "${cmd}" | nc -U '${serialPath}'`
    await this.localExec(pre)
      .then(() => {
        return this.localExec(pre)
      })
      .then(() => {
        console.log(serialCmd)
        return this.localExec(serialCmd)
      })
  }

  async buildVM (imagePath, deleteFirst = false) {
    let image = imagePath
    if (!image) {
      // download
      try {
        image = await this.downloadFile(this.config.vrouter.imageUrl)
        console.log('download sucess.')
        console.log(image)
      } catch (err) {
        console.log(err)
        throw Error('download failed')
      }
    }
    const existed = await this.isVRouterExisted()
      .then(() => true)
      .catch(() => false)

    console.log(existed)
    if (!deleteFirst && existed) {
      throw Error('vrouter already existed')
    }
    if (existed) {
      console.log('deleting')
      await this.deleteVM(true)
      console.log('deleted')
    }
    // specify size: 64M
    const vdiSize = 67108864
    const subCmds = []
    const vdi = path.join(this.config.host.configDir, this.config.vrouter.name + '.vdi')
    await fs.remove(vdi)
    subCmds.push(`cat "${image}" | gunzip | ` +
      `VBoxManage convertfromraw --format VDI stdin "${vdi}" ${vdiSize}`)

    subCmds.push(`VBoxManage createvm --name ${this.config.vrouter.name} --register`)

    subCmds.push(`VBoxManage modifyvm ${this.config.vrouter.name} ` +
      ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
      ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
      ` --audio "none" `)

    subCmds.push(`VBoxManage storagectl ${this.config.vrouter.name} ` +
      `--name "SATA Controller" --add "sata" --portcount "4" ` +
      `--hostiocache "on" --bootable "on"`)

    subCmds.push(`VBoxManage storageattach ${this.config.vrouter.name} ` +
      `--storagectl "SATA Controller" --port "1" ` +
      `--type "hdd" --nonrotational "on" --medium "${vdi}"`)

    return this.localExec(subCmds.join(' && '))
      .then(() => {
        return this.toggleSerialPort('on')
      })
      .then(() => {
        return this.configVMNetwork()
      })
      .then(() => {
        return this.startVM('gui')
          .then(() => {
            return this.wait(30000)
          })
      })
      .then(() => {
        return this.configVMLanIP({
          changepassword: true,
          reboot: true,
          changeTZ: true,
          installPackage: true
        })
      })
      .then(() => {
        const src = path.join(__dirname, '..', 'third_party')
        const dst = this.config.vrouter.configDir
        return this.scp(src, dst)
      })
      .then(() => {
        return this.connect()
      })
      .then((remote) => {
        return remote.installKt()
          .then(() => {
            return remote.installSS()
          })
          .then(() => {
            remote.shutdown()
          })
      })
      .then(() => {
        return this.wait(4000)
      })
  }

  initVM () {
    /*
     * 0. copy files to vm, save to right dir
     * 1. remove dnsmasq && install dnsmasq-full
     * 2. install ipset
     * 3. install kcptun
     * 4. install shadowsocks
     * 5. exec watchdog by crontab
     * 5. enable kcptun/shadowsocks/crontab service
     * 6. restart kcptun/shadowsocks/dnsmasq/firewall
     */
    const src = path.join(this.config.host.configDir, 'third_party')
    const dst = this.config.vrouter.configDir
    return this.scp(src, dst)
      .then(() => {
      })
  }
  importVM (vmFile) {
    const cmd = `VBoxManage import ${vmFile}`
    return this.localExec(cmd)
  }
  async deleteVM (stopFirst = false) {
    const cmd = `VBoxManage unregistervm ${this.config.vrouter.name} --delete`
    const state = await this.getVMState()
    if (state === 'running' && !stopFirst) {
      throw Error('vm must be stopped before delete')
    }
    await this.stopVM('poweroff')
    return this.localExec(cmd)
  }
  async startVM (type = 'headless') {
    const state = await this.getVMState()
    if (state !== 'running') {
      const cmd = `VBoxManage startvm --type ${type} ${this.config.vrouter.name}`
      return this.localExec(cmd)
    }
  }
  stopVM (action = 'savestate') {
    const cmd = `VBoxManage controlvm ${this.config.vrouter.name} ${action}`
    return this.getVMState()
      .then((state) => {
        // "saved" "poweroff" "running"
        if (state === 'saved' && action === 'poweroff') {
          return this.localExec(`VBoxManage discardstate ${this.config.vrouter.name}`)
        } else if (state === 'running') {
          return this.localExec(cmd)
            .then(() => {
              return this.wait(3000)
            })
        }
      })
  }

  hideVM (action = true) {
    const cmd = `VBoxManage setextradata ${this.config.vrouter.name} GUI/HideFromManager ${action}`
    return this.localExec(cmd)
  }

  isVBInstalled () {
    const cmd = 'VBoxManage --version'
    return this.localExec(cmd)
  }
  isVRouterExisted () {
    const cmd = 'VBoxManage list vms'
    return this.localExec(cmd)
      .then((stdout) => {
        if (stdout.indexOf(this.config.vrouter.name) < 0) {
          return Promise.reject(Error('vm not existed'))
        }
      })
  }
  getVMState () {
    // much slow then 'VBoxManage list runningvms'
    const cmd = `VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable | grep VMState=`
    return this.localExec(cmd)
      .then((output) => {
        const state = output.trim().split('=')[1].replace(/"/g, '')
        return state
      })
  }
  isVRouterRunning () {
    // State:           running (since 2017-06-16T02:13:09.066000000)
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep VMState
    // VMState="running"
    const cmd = 'VBoxManage list runningvms'
    return this.localExec(cmd)
      .then((stdout) => {
        if (stdout.indexOf(this.config.vrouter.name) < 0) {
          return Promise.reject(Error('vm not running'))
        }
      })
  }

  getInfIP (inf) {
    const cmd = `ifconfig ${inf}`
    return this.localExec(cmd)
      .then((output) => {
        const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(output)
        const ip = (ipMatch && ipMatch[1]) || ''
        return ip
      })
  }
  getAllInf () {
    const cmd = 'ifconfig'
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
    const cmd = `VBoxManage hostonlyif create`
    return this.localExec(cmd)
      .then((output) => {
        const infMatch = /Interface '(.*)'/ig.exec(output)
        return infMatch && infMatch[1]
      })
  }
  removeHostonlyInf (inf) {
    const cmd = `VBoxManage hostonlyif remove ${inf}`
    return this.localExec(cmd)
  }
  async configHostonlyInf (inf, netmask = '255.255.255.0') {
    let iinf = inf
    if (!inf) {
      const infs = await this.getHostonlyInf()
      iinf = infs[0] || infs[1] || await this.createHostonlyInf()
    }
    const cmd = `VBoxManage hostonlyif ipconfig ${iinf} --ip ${this.config.host.ip} --netmask ${netmask}`
    return this.localExec(cmd)
      .then(() => iinf)
  }

  getActiveAdapter () {
    // VBoxManage list bridgedifs | grep ^Name: | grep en0
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
        const cmd = 'VBoxManage list bridgedifs'
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
    // VBoxManage modifyvm com.icymind.vrouter --nic1 hostonly --hostonlyadapter1 vboxnet1
    let iinf = inf
    if (!iinf) {
      iinf = await this.configHostonlyInf()
    }
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} ` +
      ` --nic${nic} hostonly ` +
      ` --nictype${nic} "82540EM" ` +
      ` --hostonlyadapter${nic} ${iinf} ` +
      ` --cableconnected${nic} "on"`

    const vmState = await this.getVMState()
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
      if (arr.length !== 1) {
        console.log(arr)
        return Promise.reject(Error(`more than one active adapter: ${arr}`))
      }
      iinf = arr[0]
    }
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} ` +
      `--nic${nic} bridged ` +
      ` --nictype${nic} "82540EM" ` +
      `--bridgeadapter${nic} "${iinf.replace(/["']/g, '')}" ` +
      `--cableconnected${nic} "on"`
    const vmState = await this.getVMState()
    if (vmState !== 'poweroff') {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
  }

  isNIC1ConfigedAsHostonly () {
    let cmd = `VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable | grep 'nic1\\|hostonlyadapter1'`
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
    let cmd = `VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable | grep 'nic2\\|bridgeadapter2'`
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
        cmd = `ifconfig ${inf.trim().split(':')[0]}`
        return this.localExec(cmd)
          .then((infConfig) => {
            const statusMatch = /status: active/ig.exec(infConfig)
            if (!statusMatch) return Promise.reject(Error("bridged adapter doesn't active"))
            return inf
          })
      })
  }

  configVMNetwork () {
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
    const cmd = `VBoxManage showvminfo ${this.config.vrouter.name} --machinereadable  | grep "uart\\(mode\\)\\?1"`
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
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --uart${num} ${subCmd}`
    const vmState = await this.getVMState()
    if (vmState !== 'poweroff') {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
  }

  async changeVMTZ () {
    const cc = String.raw`
        uci set system.@system[0].hostname='VRouter'
        uci set system.@system[0].timezone='HKT-8'
        uci set system.@system[0].zonename='Asia/Hong Kong'
        uci commit system`
    return this.serialExec(cc.trim().split('\n').map(line => line.trim()).join(' && '))
  }
  async changeVMPasswd () {
    return this.serialExec("echo -e 'root\\nroot' | (passwd root)")
  }
  async installPackage () {
    const subCmds = []
    subCmds.push(`sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\\/openwrt/g' /etc/opkg/distfeeds.conf`)
    subCmds.push('sleep 8')
    subCmds.push('opkg update >> /vrouter.log')
    subCmds.push('opkg remove dnsmasq && opkg install dnsmasq-full ipset openssh-sftp-server >> /vrouter.log')
    return this.serialExec(subCmds.join(' && '))
  }

  async configVMLanIP () {
    // execute cmd
    const subCmds = []
    subCmds.push(`uci set network.lan.ipaddr='${this.config.vrouter.ip}'`)
    subCmds.push('uci commit network')
    subCmds.push('/etc/init.d/network restart >> /vrouter.log')
    return this.serialExec(subCmds.join(' && '))
  }

  // need fixed. think about global mode.
  async generateIPsets () {
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.ipsetsFile))
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('error', reject)
    })

    // create or flush ipset
    ws.write(`create ${this.config.firewall.ipsets.lan}   hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`create ${this.config.firewall.ipsets.white} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`create ${this.config.firewall.ipsets.black} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)

    const lan = await this.getCfgContent(this.config.firewall.lanNetworks)
    lan.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`add ${this.config.firewall.ipsets.lan} ${line}\n`)
      }
    })

    const chinaIPs = await this.getCfgContent(this.config.firewall.chinaIPs)
    chinaIPs.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`add ${this.config.firewall.ipsets.white} ${line}\n`)
      }
    })

    // add extra_blocked_ips to blacklist_ipset
    const extraBlockedIPs = await this.getCfgContent(this.config.firewall.extraBlockedIPs)
    extraBlockedIPs.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`add ${this.config.firewall.ipsets.black} ${line}\n`)
      }
    })
    ws.end()
    return promise
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

  getServerIP () {
    if (this.config.server.ip) {
      return Promise.resolve(this.config.server.ip)
    }
    if (!this.config.server.domain) {
      return Promise.resolve('')
    }
    return new Promise((resolve, reject) => {
      dns.lookup(this.config.server.domain, { family: 4 }, (err, address, family) => {
        if (err) reject(err)
        resolve(address)
      })
    })
  }
  generateFWRulesHelper (str) {
    return `iptables -t nat -A PREROUTING -d ${str}\niptables -t nat -A OUTPUT ${str}\n`
  }

  async generateFWRules (protocol, mode = 'whitelist') {
    // whitelist/blacklist/global/none
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.firewallFile))
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('error', reject)
    })
    const redirPort = protocol === 'kcptun'
      ? this.config.shadowsocks.overKtPort
      : this.config.shadowsocks.clientPort

    ws.write('# com.icymind.vrouter\n')
    ws.write(`# workMode: ${mode}\n`)
    ws.write('# create ipsets in order to avoid errors when run firewall.user\n')
    ws.write(`ipset create ${this.config.firewall.ipsets.lan}   hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`ipset create ${this.config.firewall.ipsets.white} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`ipset create ${this.config.firewall.ipsets.black} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)
    ws.write(`/usr/sbin/ipset restore -exist -file ${this.config.vrouter.configDir}/${this.config.firewall.ipsetsFile} &> /dev/null\n`)

    const serverIP = await this.getServerIP()
    if (!serverIP) {
      ws.end()
      return promise
    }

    // if kcp protocol: speedup ssh
    if (protocol === 'kcptun' && this.config.server.sshPort) {
      ws.write('# speedup ssh connection if current protocol is kcptun\n')
      const rule = `-d ${serverIP} -p tcp --dport ${this.config.server.sshPort} -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    // bypass server_ip
    ws.write('# bypass server ip\n')
    ws.write(this.generateFWRulesHelper(`-d ${serverIP} -j RETURN`))

    // bypass lan_networks
    ws.write('# bypass lan networks\n')
    let rule = `-m set --match-set ${this.config.firewall.ipsets.lan} dst -j RETURN`
    ws.write(this.generateFWRulesHelper(rule))

    // whitelist mode: bypass whitelist and route others
    if (mode === 'whitelist') {
      ws.write('# bypass whitelist\n')
      rule = `-m set --match-set ${this.config.firewall.ipsets.white} dst -j RETURN`
      ws.write(this.generateFWRulesHelper(rule))
      ws.write('# route all other traffic\n')
      rule = `-p tcp -j REDIRECT --to-ports ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    if (mode === 'blacklist') {
      ws.write('# route all blacklist traffic\n')
      rule = `-p tcp -m set --match-set ${this.config.firewall.ipsets.black} dst -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    if (mode === 'global') {
      ws.write('# route all traffic\n')
      rule = `-p tcp -j REDIRECT --to-ports ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }
    ws.end()
    return promise
  }
  getDNSServer () {
    const dnsmasq = '53'
    return [
      `127.0.0.1#${dnsmasq}`,
      `127.0.0.1#${this.config.shadowsocks.dnsPort}`
    ]
  }
  generateNetworkCfg () {
    const cfg = String.raw`
config interface 'loopback'
        option ifname 'lo'
        option proto 'static'
        option ipaddr '127.0.0.1'
        option netmask '255.0.0.0'

config interface 'lan'
        option ifname 'eth0'
        option type 'bridge'
        option proto 'static'
        option ipaddr '${this.config.vrouter.ip}'
        option netmask '255.255.255.0'
        option ip6assign '60'

config interface 'wan'
        option ifname 'eth1'
        option proto 'dhcp'

config interface 'wan6'
        option ifname 'eth1'
        option proto 'dhcpv6'

config globals 'globals'
        # option ula_prefix 'fd2c:a5b2:c85d::/48'
`
    return cfg.trim()
  }
  async generateDnsmasqCf (mode) {
    const DNSs = this.getDNSServer()
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.dnsmasqFile))
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('reject', reject)
    })

    if (mode === 'none') {
      ws.write('# stay in wall\n')
      ws.end()
      return promise
    }

    const whiteDomains = await this.getCfgContent(this.config.firewall.whiteDomains)
    whiteDomains.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`server=/${line}/${DNSs[0]}\n`)
        ws.write(`ipset=/${line}/${this.config.firewall.ipsets.white}\n`)
      }
    })

    const gfwDomains = await this.getCfgContent(this.config.firewall.gfwDomains)
    gfwDomains.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`server=/${line}/${DNSs[1]}\n`)
        ws.write(`ipset=/${line}/${this.config.firewall.ipsets.black}\n`)
      }
    })

    const extraBlockedDomains = await this.getCfgContent(this.config.firewall.extraBlockedDomains)
    extraBlockedDomains.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`server=/${line}/${DNSs[1]}\n`)
        ws.write(`ipset=/${line}/${this.config.firewall.ipsets.black}\n`)
      }
    })
    ws.end()
    return promise
  }
  generateWatchdog () {
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.watchdogFile)
    const content = String.raw`
#!/bin/sh
# KCPTUN
if ! pgrep kcptun;then
    /etc/init.d/${this.config.kcptun.service} restart
    date >> /root/watchdog.log
    echo "restart kcptun" >> /root/watchdog.log
fi
# SHADOWSOCKS
if ! (pgrep ss-redir && pgrep ss-tunnel);then
    /etc/init.d/${this.config.shadowsocks.service} restart
    date >> /root/watchdog.log
    echo "restart ss" >> /root/watchdog.log
fi`
    return fs.outputFile(cfgPath, content, 'utf8')
  }
  generateService (type = 'shadowsocks') {
    const cfgPath = path.join(this.config.host.configDir,
      type === 'shadowsocks' ? this.config.shadowsocks.service : this.config.kcptun.service)
    const ss = String.raw`
#!/bin/sh /etc/rc.common
# Copyright (C) 2006-2011 OpenWrt.org

START=90

SERVICE_USE_PID=1
SERVICE_WRITE_PID=1
SERVICE_DAEMONIZE=1


start() {
    # ss-tunnel cannot work fine with kcptun.
    service_start /usr/bin/ss-tunnel -c ${this.config.vrouter.configDir}/${this.config.shadowsocks.dns}
    service_start /usr/bin/ss-redir  -c ${this.config.vrouter.configDir}/${this.config.shadowsocks.client}
    service_start /usr/bin/ss-redir  -c ${this.config.vrouter.configDir}/${this.config.shadowsocks.overKt}
}

stop() {
    service_stop /usr/bin/ss-tunnel
    service_stop /usr/bin/ss-redir
    killall ss-redir
}`
    const kt = String.raw`
#!/bin/sh /etc/rc.common
# Copyright (C) 2006-2011 OpenWrt.org

START=88

SERVICE_USE_PID=1
SERVICE_WRITE_PID=1
SERVICE_DAEMONIZE=1

start() {
    # kcptun will fail if network not ready
    while true;do
        service_start /usr/bin/kcptun -c ${this.config.vrouter.configDir}/${this.config.kcptun.client}
        sleep 30
        (pgrep kcptun) && break
    done
}

stop() {
    killall kcptun
}`
    return fs.outputFile(cfgPath, type === 'shadowsocks' ? ss : kt)
  }
  generateConfig (type = 'shadowsocks') {
    let cfg
    let content
    switch (type) {
      case 'ss-client':
        cfg = this.config.shadowsocks.client
        content = String.raw`
{
    "server":"${this.config.shadowsocks.server.ip}",
    "server_port":${this.config.shadowsocks.server.port},
    "local_address": "0.0.0.0",
    "local_port":${this.config.shadowsocks.clientPort},
    "password":"${this.config.shadowsocks.server.password}",
    "timeout":${this.config.shadowsocks.server.timeout},
    "method":"${this.config.shadowsocks.server.method}",
    "fast_open": ${this.config.shadowsocks.server.fastOpen},
    "mode": "tcp_only"
}`
        break
      case 'ss-overKt':
        cfg = this.config.shadowsocks.overKt
        content = String.raw`
{
    "server":       "127.0.0.1",
    "server_port":  ${this.config.kcptun.clientPort},
    "local_address": "0.0.0.0",
    "local_port":   ${this.config.shadowsocks.overKtPort},
    "password":     "${this.config.shadowsocks.server.password}",
    "timeout":      20,
    "method":       "${this.config.shadowsocks.server.method}",
    "fast_open":    ${this.config.shadowsocks.server.fastOpen},
    "mode":         "tcp_only"
}`
        break
      case 'ss-dns':
        cfg = this.config.shadowsocks.dns
        content = String.raw`
{
    "server":"${this.config.shadowsocks.server.ip}",
    "server_port":${this.config.shadowsocks.server.port},
    "local_address": "0.0.0.0",
    "local_port":${this.config.shadowsocks.clientPort},
    "password":"${this.config.shadowsocks.server.password}",
    "timeout":${this.config.shadowsocks.server.timeout},
    "method":"${this.config.shadowsocks.server.method}",
    "fast_open": ${this.config.shadowsocks.server.fastOpen},
    "mode": "udp_only"
}`
        break
      case 'kcptun':
        cfg = this.config.kcptun.client
        content = String.raw`
{
    "remoteaddr": "${this.config.kcptun.server.ip}:${this.config.kcptun.server.port}",
    "localaddr": ":${this.config.kcptun.clientPort}",
    "key": "${this.config.kcptun.server.key}",
    "crypt":    "${this.config.kcptun.server.crypt}",
    "mode":     "${this.config.kcptun.server.mode}",
    "sndwnd":   ${this.config.kcptun.server.sndwnd},
    "rcvwnd":   ${this.config.kcptun.server.rcvwnd},
    "nocomp":    ${this.config.kcptun.server.nocomp}
}`
    }
    const cfgPath = path.join(this.config.host.configDir, cfg)
    return fs.outputFile(cfgPath, content)
  }

  generateTZCfg () {
    const content = String.raw`
config system
        option hostname VRouter
        option zonename 'Asia/Hong Kong'
        option timezone 'HKT-8'
        option conloglevel '8'
        option cronloglevel '8'
config timeserver ntp
        list server     0.openwrt.pool.ntp.org
        list server     1.openwrt.pool.ntp.org
        list server     2.openwrt.pool.ntp.org
        list server     3.openwrt.pool.ntp.org
        option enabled 1
        option enable_server 0
`
    return content
  }

  downloadFile (src, dest) {
    const protocol = (new URL(src)).protocol
    console.log(protocol)
    const method = protocol === 'https:' ? https : http
    let destination = dest
    if (!dest) {
      destination = path.join(this.config.host.configDir, path.basename(src))
    }
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destination)
      method.get(src, (response) => {
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve(destination)
        })
      }).on('error', (err) => {
        fs.unlink(dest)
        reject(err)
      })
    })
  }
  hashFile (file) {
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

  scp (src, dst) {
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

  connect (startFirst) {
    return this.isVRouterRunning()
      .catch(() => {
        return Promise.reject(Error("vm doesn't running."))
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
            keepaliveInterval: 30000,
            readyTimeout: 1500
          })
        })
      })
  }
}

module.exports = {
  VRouter
}
