const path = require('path')
class VRouterRemote {
  // todo: reconnect
  constructor (connect, config, local) {
    this.connect = connect
    this.config = config
    this.local = local
  }

  remoteExec (cmd) {
    const specialCmds = [
      '/etc/init.d/firewall restart'
    ]
    return new Promise((resolve, reject) => {
      this.connect.exec(cmd, (err, stream) => {
        let stdout = ''
        let stderr = ''
        if (err) reject(err)
        stream.on('data', (data) => {
          stdout += data
        })
        stream.stderr.on('data', (data) => {
          stderr += data
        })
        stream.on('end', () => {
          if (stderr) {
            if (specialCmds.includes(cmd)) {
              resolve(stderr.toString().trim())
            } else {
              reject(stderr.toString().trim())
            }
          } else {
            resolve(stdout.toString().trim())
          }
        })
      })
    })
  }

  initVM () {
    const src = path.join(this.config.host.configDir, 'third_party')
    const dst = this.config.vrouter.configDir
    return this.scp(src, dst)
      .then(() => {
      })
  }
  makeExecutable (file) {
    const cmd = `chmod +x ${file}`
    return this.remoteExec(cmd)
  }
  installKt () {
    const cmd = `tar -xvzf ${this.config.vrouter.configDir}/third_party/kcptun*.tar.gz ` +
      ` && rm server_linux_* && mv client_linux* /usr/bin/kcptun`
    return this.remoteExec(cmd)
  }
  installSS () {
    const cmd = `ls ${this.config.vrouter.configDir}/third_party/*.ipk | xargs opkg install`
    return this.remoteExec(cmd)
  }
  shutdown () {
    const cmd = 'poweroff'
    // do not return
    return Promise.resolve(this.remoteExec(cmd))
  }
  getSSOverKTProcess () {
    const cmd = 'ps -w| grep "[s]s-redir -c .*ss-over-kt.json"'
    return this.remoteExec(cmd)
  }
  getSSProcess () {
    // const cmd = 'ps | grep "[s]s-redir -c .*ss-client.json"'
    const cmd = 'ps -w| grep "[s]s-redir -c .*ss-client.json"'
    return this.remoteExec(cmd)
  }
  getSSDNSProcess () {
    const cmd = 'ps -w| grep "[s]s-tunnel -c .*ss-dns.json"'
    return this.remoteExec(cmd)
  }
  isSsRunning () {
    return this.getSSProcess()
      .then(() => {
        return this.getSSDNSProcess()
      })
      .then(() => {
        if (this.config.firewall.currentProtocol === 'kcptun') {
          return this.getSSOverKTProcess()
        } else {
          return Promise.resolve('dont panic')
        }
      })
      .then(() => {
        return Promise.resolve(true)
      })
      .catch(() => {
        return Promise.resolve(false)
      })
  }
  getOpenwrtVersion () {
    const cmd = 'cat /etc/banner'
    return this.remoteExec(cmd)
      .then((output) => {
        const reg = /^ *(\w+ \w+ \(.*\)) *$/mg
        const match = reg.exec(output)
        return Promise.resolve((match && match[1]) || '')
      })
  }
  getIP (inf) {
    const cmd = `ifconfig ${inf} | grep 'inet addr'`
    return this.remoteExec(cmd)
      .then((output) => {
        const reg = /^inet addr:(\d+.\d+.\d+.\d+)/
        const match = reg.exec(output.trim())
        return Promise.resolve((match && match[1]) || '')
      })
  }
  getMacAddress (inf = 'eth1') {
    const cmd = `cat /sys/class/net/${inf}/address`
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

  isKtRunning () {
    const cmd = 'ps | grep "[k]cptun -c"'
    return this.remoteExec(cmd)
      .then(() => {
        return Promise.resolve(true)
      })
      .catch(() => {
        return Promise.resolve(false)
      })
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
    return this.getFile(`/etc/${this.config.firewall.firewallFile}`)
  }

  restartNetwork () {
    const cmd = '/etc/init.d/network restart'
    return this.remoteExec(cmd)
  }
  restartFirewall () {
    const cmd = `/etc/init.d/firewall restart`
    return this.remoteExec(cmd)
  }
  restartDnsmasq () {
    const cmd = `/etc/init.d/dnsmasq restart`
    return this.remoteExec(cmd)
  }
  restartShadowsocks () {
    const cmd = '/etc/init.d/shadowsocks restart'
    return this.remoteExec(cmd)
  }
  restartKcptun () {
    const cmd = '/etc/init.d/kcptun restart'
    return this.remoteExec(cmd)
  }
  enableService (service) {
    const cmd = `chmod +x /etc/init.d/${service} && /etc/init.d/${service} enable && /etc/init.d/${service} restart`
    return this.remoteExec(cmd)
  }
  stopKcptun () {
    const cmd = '/etc/init.d/kcptun stop'
    return this.remoteExec(cmd)
  }
  async changeProtocol (p, m) {
    // TODO: must restart shadowsocks or kt
    const protocol = p || this.config.firewall.currentProtocol
    const mode = m || this.config.firewall.currentMode
    await this.local.generateConfig(protocol)
    await this.local.generateFWRules(mode, protocol, true)
    await this.local.scpConfig('shadowsocks')
    await this.local.scpConfig('firewall')
    await this.restartShadowsocks()
    await this.restartFirewall()
  }

  async changeMode (m, p) {
    const protocol = p || this.config.firewall.currentProtocol
    const mode = m || this.config.firewall.currentMode
    await Promise.all([
      this.local.generateIPsets(true),
      this.local.generateDnsmasqCf('whitelist', true),
      this.local.generateFWRules(mode, protocol, true)
    ])
    await Promise.all([
      this.local.scpConfig('ipset'),
      this.local.scpConfig('dnsmasq'),
      this.local.scpConfig('firewall')
    ])
    await Promise.all([
      this.restartFirewall(),
      this.restartDnsmasq()
    ])
    // await this.local.generateIPsets(true)
    // await this.local.scpConfig('ipset')
    // await this.local.generateDnsmasqCf(null, true)
    // await this.local.scpConfig('dnsmasq')
    // await this.local.generateFWRules(mode, protocol, true)
    // await this.local.scpConfig('firewall')
    // await this.restartFirewall()
    // await this.restartDnsmasq()
  }
  async changeSSConfig () {
    // await this.local.
  }
  close () {
    return new Promise((resolve) => {
      try {
        this.connect.end()
      } catch (err) {
        console.log(err)
        console.log('dont panic')
      }
      resolve()
    })
  }
}

module.exports = {
  VRouterRemote
}
