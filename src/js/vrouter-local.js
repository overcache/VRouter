const { exec } = require('child_process')
const Client = require('ssh2').Client
const http = require('http')
const fs = require('fs-extra')
const path = require('path')
const { VRouterRemote } = require('./vrouter-remote.js')
const { getAppDir } = require('./helper.js')
const packageJson = require('../../package.json')

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
    const specialCmd = [
      /^VBoxManage hostonlyif .*$/ig,
      /^VBoxManage startvm/ig,
      /^VBoxManage controlvm .* poweroff/ig
    ]
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) reject(err)
        else {
          if (stderr && !specialCmd.some((element) => element.test(cmd))) {
            reject(stderr)
          } else {
            resolve(stdout)
          }
        }
      })
    })
  }

  importVM (vmFile) {
    const cmd = `VBoxManage import ${vmFile}`
    return this.localExec(cmd)
  }
  deleteVM () {
    const cmd = `VBoxManage unregistervm ${this.config.vrouter.name} --delete`
    return this.isVRouterRunning()
      .catch(() => {
        throw Error('vm must be shudown before delete')
      })
      .then(() => {
        return this.localExec(cmd)
      })
  }
  startVM (type = 'headless') {
    const cmd = `VBoxManage startvm --type ${type} ${this.config.vrouter.name}`
    return this.isVRouterRunning()
      .catch(() => {
        return this.localExec(cmd)
      })
  }
  stopVM () {
    const cmd = `VBoxManage controlvm ${this.config.vrouter.name} poweroff`
    return this.isVRouterRunning()
      .catch(() => 'poweroff')
      .then((output) => {
        if (output !== 'poweroff') {
          return this.localExec(cmd)
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
            console.log(infConfig)
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
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --nic${nic} hostonly --hostonlyadapter${nic} ${iinf}`
    return this.isVRouterRunning()
      .then(() => {
        throw Error('vm must be shutdown before modify')
      })
      .catch(() => {
        return this.localExec(cmd)
      })
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
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --nic${nic} bridged --bridgeadapter${nic} "${iinf.replace(/["']/g, '')}"`
    return this.isVRouterRunning()
      .then(() => {
        throw Error('vm must be shutdown before modify')
      })
      .catch(() => {
        return this.localExec(cmd)
      })
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
  toggleSerialPort (action = 'on', num = 1) {
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${num} server "${path.join(this.config.host.configDir, this.config.host.serialFile)}"` : 'off'
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --uart${num} ${subCmd}`
    return this.isVRouterRunning()
      .then(() => {
        throw Error('vm must be shutdown before modify')
      })
      .catch(() => {
        return this.localExec(cmd)
      })
  }

  async configVMLanIP (changepassword = true, shutdownAfterCf = false) {
    // password: changepassword at the sametime
    /*
     * 0. vm must be stopped
     * 1. open serial port
     * 2. execute cmd
     * 3. close serial port
     */
    const serialPortState = await this.isSerialPortOn()

    // toggleSerialPort on
    if (!serialPortState) {
      // turn vm off if necessary
      await this.isVRouterRunning()
        .catch(() => {})
        .then(() => {
          return this.stopVM()
            .then(() => {
              return this.wait(200)
            })
        })
      await this.toggleSerialPort('on')
    }

    // startVM if necessary
    await this.isVRouterRunning()
      .catch(() => {
        return this.startVM()
          .then(() => {
            return this.wait(30000)
          })
      })

    // execute cmd
    const subCmds = []
    if (changepassword) {
      subCmds.push("echo -e 'root\\nroot' | (passwd root)")
    }
    subCmds.push(`sed -i s/'192.168.1.1'/'${this.config.vrouter.ip}'/g /etc/config/network`)
    subCmds.push('/etc/init.d/network restart')
    const cmd = `echo "${subCmds.join(' && ')}" | nc -U "${path.join(this.config.host.configDir, this.config.host.serialFile)}"`
    await this.localExec(cmd)
      .then(() => {
        return this.wait(7000)
      })

    if (shutdownAfterCf) {
      await this.stopVM()
    }
    // return this.isSerialPortOn()
      // .catch(() => {
        // // state: off
      // })
      // .then()
    // return this.isVRouterRunning()
      // .then(() => {
        // throw Error('vm must be shutdown before configVMLanIP')
      // })
      // .catch(() => {
        // return this.toggleSerialPort('on')
      // })
      // .then(() => {
        // return this.wait(100)
      // })
      // .then(() => {
        // return this.startVM()
      // })
      // .then(() => {
        // return this.wait(30000)
      // })
      // .then(() => {
        // // todo:
        // // execute
        // const subCmds = []
        // if (changepassword) {
          // subCmds.push("echo -e 'root\nroot' | (passwd root)")
        // }
        // subCmds.push(`sed -i s/'192.168.1.1'/'${this.config.vrouter.ip}' /etc/config/network`)
        // subCmds.push('/etc/init.d/network restart')
        // const cmd = `echo "${subCmds.join(' && ')}" | nc -U "${path.join(this.config.host.configDir, this.config.host.serialFile)}"`
        // return this.localExec(cmd)
          // .then(() => {
            // return this.wait(300)
          // })
      // })
      // .then(() => {
        // return shutdownAfterCf ? this.stopVM() : null
      // })
  }

  async generateIPsets () {
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.ipsetsFile))

    // create or flush ipset
    ws.write(`create ${this.config.firewall.ipsets.lan} hash:net family inet hashsize 1024 maxelem 65536`)
    ws.write(`create ${this.config.firewall.ipsets.white} hash:net family inet hashsize 1024 maxelem 65536`)
    ws.write(`create ${this.config.firewall.ipsets.black} hash:net family inet hashsize 1024 maxelem 65536`)

    const lan = await fs.readFile(path.join(this.config.host.configDir, this.config.firewall.lanNetworks))
    lan.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`add ${this.config.firewall.ipsets.lan} ${line}`)
      }
    })

    const chinaIPs = await fs.readFile(path.join(this.config.host.configDir, this.config.firewall.chinaIPs))
    chinaIPs.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`add ${this.config.firewall.ipsets.white} ${line}`)
      }
    })

    // add extra_blocked_ips to blacklist_ipset
    const extraBlockedIPs = await fs.readFile(path.join(this.config.host.configDir, this.config.firewall.chinaIPs))
    extraBlockedIPs.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`add ${this.config.firewall.ipsets.black} ${line}`)
      }
    })

    ws.end()
  }

  async getServerIP () {
    //
  }
  generateFWRulesHelper (str) {
    return `iptables -t nat -A PREROUTING -d ${str}\niptables -t nat -A OUTPUT ${str}\n`
  }
  async generateFWRules (protocal, mode = 'whitelist') {
    // whitelist/blacklist/global/none
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.firewallFile))
    const redirPort = protocal === 'kcptun'
      ? this.config.shadowsocks.overKtPort
      : this.config.shadowsocks.clientPort

    ws.write('# com.icymind.vrouter\n')
    ws.write(`# workMode: ${mode}\n`)
    ws.write('# create ipsets in order to avoid errors when run firewall.user\n')
    ws.write(`ipset create ${this.config.firewall.ipsets.lan} hash:net -exist\n`)
    ws.write(`ipset create ${this.config.firewall.ipsets.white} hash:net -exist\n`)
    ws.write(`ipset create ${this.config.firewall.ipsets.black} hash:net -exist\n`)

    const serverIP = await this.getServerIP()

    // if kcp protocal: speedup ssh
    if (protocal === 'kcptun' && this.config.server.sshPort) {
      const rule = `-d ${serverIP} -p tcp --dport ${this.config.server.sshPort} -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    // bypass server_ip
    ws.write('# bypass server ip')
    ws.write(this.generateFWRulesHelper(`-d ${serverIP} -j RETURN`))

    // bypass lan_networks
    ws.write('# bypass lan networks')
    let rule = `-m set --match-set ${this.config.firewall.ipsets.lan} dst -j RETURN`
    ws.write(this.generateFWRulesHelper(rule))

    // whitelist mode: bypass whitelist and route others
    if (mode === 'whitelist') {
      ws.write('# bypass whitelist')
      rule = `-m set --match-set ${this.config.firewall.ipsets.white} dst -j RETURN`
      ws.write(this.generateFWRulesHelper(rule))
      ws.write('# route all other traffic')
      rule = `-p tcp -j REDIRECT --to-ports ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    if (mode === 'blacklist') {
      ws.write('# route all blacklist traffic')
      rule = `-p tcp -m set --match-set ${this.config.firewall.ipsets.black} dst -j REDIRECT --to-port ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }

    if (mode === 'global') {
      ws.write('# route all traffic')
      rule = `-p tcp -j REDIRECT --to-ports ${redirPort}`
      ws.write(this.generateFWRulesHelper(rule))
    }
    ws.end()
  }
  getDNSServer () {
    const dnsmasq = '53'
    return [
      `127.0.0.1#${dnsmasq}`,
      `127.0.0.1#${this.config.shadowsocks.dnsPort}`
    ]
  }
  async generateDnsmasqCf (mode) {
    const DNSs = this.getDNSServer()
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.dnsmasqFile))

    if (mode === 'none') {
      ws.write('# stay in wall')
      ws.end()
      return
    }

    const whiteDomains = await fs.readFile(path.join(this.config.host.configDir, this.config.firewall.whiteDomains))
    whiteDomains.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`server=/${line}/${DNSs[0]}`)
        ws.write(`ipset=/${line}/${this.config.firewall.ipsets.white}`)
      }
    })

    const gfwDomains = await fs.readFile(path.join(this.config.host.configDir, this.config.firewall.gfwDomains))
    gfwDomains.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`server=/${line}/${DNSs[1]}`)
        ws.write(`ipset=/${line}/${this.config.firewall.ipsets.black}`)
      }
    })

    const extraBlockedDomains = await fs.readFile(path.join(this.config.host.configDir, this.config.firewall.extraBlockedDomains))
    extraBlockedDomains.split('\n').forEach((line) => {
      if (!/^\s*#/ig.test(line) && !/^\s*$/ig.test(line)) {
        ws.write(`server=/${line}/${DNSs[1]}`)
        ws.write(`ipset=/${line}/${this.config.firewall.ipsets.black}`)
      }
    })
    ws.end()
  }
  downloadFile (url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      http.get(url, (response) => {
        response.pipe(file)
        file.on('finish', () => file.close())
        resolve()
      }).on('error', (err) => {
        fs.unlink(dest)
        reject(err)
      })
    })
  }

  connect () {
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
