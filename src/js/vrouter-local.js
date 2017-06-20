const { exec } = require('child_process')
const Client = require('ssh2').Client
const { URL } = require('url')
const http = require('http')
const https = require('https')
const fs = require('fs-extra')
const path = require('path')
const { VRouterRemote } = require('./vrouter-remote.js')
const { getAppDir } = require('./helper.js')
const packageJson = require('../../package.json')
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
    const vmState = await this.isVRouterRunning()
      .then(() => true)
      .catch(() => false)
    if (vmState) {
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
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --nic${nic} bridged --bridgeadapter${nic} "${iinf.replace(/["']/g, '')}"`
    const vmState = await this.isVRouterRunning()
      .then(() => true)
      .catch(() => false)
    if (vmState) {
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
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${num} server "${path.join(this.config.host.configDir, this.config.host.serialFile)}"` : 'off'
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --uart${num} ${subCmd}`
    const vmState = await this.isVRouterRunning()
      .then(() => true)
      .catch(() => false)
    if (vmState) {
      return Promise.reject(Error('vm must be shutdown before modify'))
    }
    await this.localExec(cmd)
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
    subCmds.push(`echo "${this.generateNetworkCfg().split('\n').join('\\n')}" > /etc/config/network`)
    subCmds.push('/etc/init.d/network restart')
    const cmd = `echo "${subCmds.join(' && ')}" | nc -U "${path.join(this.config.host.configDir, this.config.host.serialFile)}"`
    await this.localExec(cmd)
      .then(() => {
        return this.wait(7000)
      })

    if (shutdownAfterCf) {
      await this.stopVM()
    }
  }

  async generateIPsets () {
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.ipsetsFile))
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('error', reject)
    })

    // create or flush ipset
    ws.write(`create ${this.config.firewall.ipsets.lan} hash:net family inet hashsize 1024 maxelem 65536\n`)
    ws.write(`create ${this.config.firewall.ipsets.white} hash:net family inet hashsize 1024 maxelem 65536\n`)
    ws.write(`create ${this.config.firewall.ipsets.black} hash:net family inet hashsize 1024 maxelem 65536\n`)

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
    ws.write(`ipset create ${this.config.firewall.ipsets.lan} hash:net -exist\n`)
    ws.write(`ipset create ${this.config.firewall.ipsets.white} hash:net -exist\n`)
    ws.write(`ipset create ${this.config.firewall.ipsets.black} hash:net -exist\n`)

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
        option ula_prefix 'fd2c:a5b2:c85d::/48'
`
    return cfg
  }
  async generateDnsmasqCf (mode) {
    const DNSs = this.getDNSServer()
    const ws = fs.createWriteStream(path.join(this.config.host.configDir, this.config.firewall.dnsmasqFile))
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('reject', reject)
    })

    if (mode === 'none') {
      ws.write('# stay in wall')
      ws.end()
      return promise
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

  downloadFile (src, dest) {
    const protocol = (new URL(src)).protocol
    const method = protocol === 'https' ? https : http
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      method.get(src, (response) => {
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
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
