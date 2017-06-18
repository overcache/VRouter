const { exec } = require('child_process')
const Client = require('ssh2').Client
const http = require('http')
const fs = require('fs-extra')
const path = require('path')

class VRouter {
  constructor (config) {
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

  importVM (vmFile) {
    const cmd = `VBoxManage import ${vmFile}`
    return this.localExec(cmd)
  }

  deleteVM () {
    const cmd = `VBoxManage unregistervm ${this.config.vrouter.name} --delete`
    return this.localExec(cmd)
  }

  stopVM () {
    const cmd = `VBoxManage controlvm ${this.config.vrouter.name} poweroff`
    return this.localExec(cmd)
  }

  hideVM (action = true) {
    const cmd = `VBoxManage setextradata ${this.config.vrouter.name} GUI/HideFromManager ${action}`
    return this.localExec(cmd)
  }

  startVM (type = 'headless') {
    const cmd = `VBoxManage startvm --type ${type} ${this.config.vrouter.name}`
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

  isVRouterRunning () {
    // State:           running (since 2017-06-16T02:13:09.066000000)
    const cmd = 'VBoxManage list runningvms'
    return this.localExec(cmd)
      .then((stdout) => {
        if (stdout.indexOf(this.config.vrouter.name) < 0) {
          return Promise.reject(Error('vm not running'))
        }
      })
  }

  getAllInf () {
    const cmd = 'ifconfig'
    return this.localExec(cmd)
  }

  removeHostonlyInf (inf) {
    const cmd = `VBoxManage hostonlyif remove ${inf}`
    return this.localExec(cmd)
  }

  // return [rightInf, firstEmptyInf]
  getHostonlyInf () {
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

  isNIC1ConfigedAsHostonly () {
    let cmd = `VBoxManage showvminfo ${this.config.vrouter.name} | grep 'NIC 1'`
    return this.localExec(cmd)
      .then((output) => {
        const typeMatch = /Attachment: (.*) Interface/ig.exec(output)
        if (!typeMatch || typeMatch[1] !== 'Host-only') {
          return Promise.reject(Error("NIC1 isn't hostonly network"))
        }
        const infMatch = /Attachment: .* Interface '(.*)'/ig.exec(output)
        if (!infMatch || !/^vboxnet\d+$/ig.test(infMatch[1])) {
          return Promise.reject(Error("NIC1 doesn't specify host-only adapter"))
        }
        const inf = infMatch[1]
        cmd = `ifconfig ${inf}`
        return this.localExec(cmd)
          .then((infConfig) => {
            const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(infConfig)
            if (!ipMatch || ipMatch[1] !== this.config.host.ip) return Promise.reject(Error("host-only adapter doesn't config as hostIP"))
            return inf
          })
      })
  }

  isNIC2ConfigedAsBridged () {
    let cmd = `VBoxManage showvminfo ${this.config.vrouter.name} | grep 'NIC 2'`
    return this.localExec(cmd)
      .then((output) => {
        const typeMatch = /Attachment: (.*) Interface/ig.exec(output)
        if (!typeMatch || typeMatch[1] !== 'Bridged') {
          return Promise.reject(Error("NIC2 isn't bridged network"))
        }
        const infMatch = /Attachment: .* Interface '(.*)'/ig.exec(output)
        if (!infMatch) {
          return Promise.reject(Error("NIC2 doesn't specify bridged adapter"))
        }
        const bridgedInf = infMatch[1]
        cmd = `ifconfig ${bridgedInf.split(':')[0]}`
        return this.localExec(cmd)
          .then((infConfig) => {
            const statusMatch = /status: active/ig.exec(infConfig)
            if (!statusMatch) return Promise.reject(Error("bridged adapter doesn't active"))
            return bridgedInf
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
    return this.localExec(cmd)
  }

  async specifyBridgeAdapter (inf, nic = '2') {
    // VBoxManage modifyvm com.icymind.vrouter --nic2 bridged --bridgeadapter1 en0
    let iinf = inf
    if (!iinf) {
      iinf = await this.getActiveAdapter()
    }
    if (!iinf) return
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --nic${nic} bridged --bridgeadapter${nic} "${iinf}"`
    return this.localExec(cmd)
  }

  createHostonlyInf () {
    const cmd = `VBoxManage hostonlyif create`
    return this.localExec(cmd)
      .then((output) => {
        const infMatch = /Interface '(.*)'/ig.exec(output)
        return infMatch && infMatch[1]
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
      })
  }

  toggleSerialPort (action = 'on', num = 1) {
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${num} server "${path.join(__dirname, 'serial')}"` : 'off'
    const cmd = `VBoxManage modifyvm ${this.config.vrouter.name} --uart${num} ${subCmd}`
    console.log(cmd)
    return this.localExec(cmd)
  }
  configVMLanIP (shutdownAfterCf = false) {
    /*
     * 0. vm must be stopped
     * 1. open serial port
     * 2. execute cmd
     * 3. close serial port
     */
    return this.isVRouterRunning()
      .then(() => {
        throw Error('vm must be shutdown before configVMLanIP')
      })
      .catch(() => {
        return this.toggleSerialPort('on')
      })
      .then(() => {
        return this.wait(100)
      })
      .then(() => {
        return this.startVM()
      })
      .then(() => {
        return this.wait(10000)
      })
      .then(() => {
        // todo:
        // execute
      })
      .then(() => {
        return shutdownAfterCf ? this.stopVM().then(() => {
          return this.wait(1000)
            .then(() => this.toggleSerialPort('off'))
        }) : null
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
  // whitelist/blacklist/global/none
  async generateFWRules (protocal, mode = 'whitelist') {
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
  // todo
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

  connect () {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        resolve(new VRouterRemote(conn, this.config))
      }).connect({
        host: this.config.vrouter.ip,
        port: this.config.vrouter.port,
        username: this.config.vrouter.username,
        password: this.config.vrouter.password,
        keepaliveInterval: 30000,
        readyTimeout: 1500
      })
    })
  }
}

class VRouterRemote {
  constructor (connect, config) {
    this.connect = connect
    this.config = config
  }

  remoteExec (cmd) {
    return new Promise((resolve, reject) => {
      this.connect.exec(cmd, (err, stream) => {
        let result = ''
        if (err) reject(err)
        stream.on('data', (data) => {
          result += data
        })
        stream.stderr.on('data', data => resolve(data.toString().trim()))
        stream.on('end', () => resolve(result.toString().trim()))
      })
    })
  }

  getSSOverKTProcess () {
    const cmd = 'ps | grep "[s]s-redir -c .*ss-over-kt.json"'
    return this.remoteExec(cmd)
  }
  getSSProcess () {
    // const cmd = 'ps | grep "[s]s-redir -c .*ss-client.json"'
    const cmd = 'ps | grep "[s]s-redir -c .*ss_client.json"'
    return this.remoteExec(cmd)
  }
  getSSDNSProcess () {
    const cmd = 'ps | grep "[s]s-tunnel -c .*ss-dns.json"'
    return this.remoteExec(cmd)
  }
  getSSVersion () {
    const cmd = 'ss-redir -h | grep "shadowsocks-libev" | cut -d" " -f2'
    return this.remoteExec(cmd)
  }
  getSSConfig () {
    return this.getFile(`${this.config.vrouter.configDir}/${this.config.shadowsocks.client}`)
  }
  getSSDNSConfig () {
    return this.getFile(`${this.config.vrouter.configDir}/${this.config.shadowsocks.dns}`)
  }
  getSSOverKTConfig () {
    return this.getFile(`${this.config.vrouter.configDir}/${this.config.shadowsocks.overKt}`)
  }

  getKTProcess () {
    const cmd = 'ps | grep "[k]cptun -c .*/kt-client.json"'
    return this.remoteExec(cmd)
  }
  getKTVersion () {
    const cmd = 'kcptun --version | cut -d" " -f3'
    return this.remoteExec(cmd)
  }

  getOSVersion () {
    const cmd = 'cat /etc/banner | grep "(*)" | xargs'
    return this.remoteExec(cmd)
  }
  getKTConfig () {
    return this.getFile(`${this.config.vrouter.configDir}/${this.config.kcptun.client}`)
  }

  getUptime () {
    return this.remoteExec('uptime')
  }

  getBrlan () {
    const cmd = 'ifconfig br-lan | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.remoteExec(cmd)
  }

  getWifilan () {
    const cmd = 'ifconfig eth1 | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.remoteExec(cmd)
  }

  getFile (file) {
    const cmd = `cat ${file}`
    return this.remoteExec(cmd)
  }
  getFWUsersRules () {
    return this.getFile(`${this.config.firewall.file}`)
  }

  close () {
    return this.connect.end()
  }
}

module.exports = {
  VRouter
}
