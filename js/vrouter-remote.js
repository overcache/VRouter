const path = require('path')
class VRouterRemote {
  // todo: reconnect

  constructor (connect, config, local) {
    this.connect = connect
    this.config = config
    this.local = local
  }

  // vm
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
  makeExecutable (file) {
    const cmd = `chmod +x ${file}`
    return this.remoteExec(cmd)
  }
  shutdown () {
    const cmd = 'poweroff'
    // do not return
    return Promise.resolve(this.remoteExec(cmd))
  }
  closeConn () {
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
  service (name, action) {
    const cmd = `/etc/init.d/${name} ${action}`
    return this.remoteExec(cmd)
  }

  // network
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
  getBrlan () {
    const cmd = 'ifconfig br-lan | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.remoteExec(cmd)
  }
  getWifilan () {
    const cmd = 'ifconfig eth1 | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.remoteExec(cmd)
  }

  // shadowsocks
  installSs () {
    const cmd = `ls ${this.config.vrouter.configDir}/third_party/*.ipk | xargs opkg install`
    return this.remoteExec(cmd)
  }
  getSsVersion () {
    const cmd = 'ss-redir -h | grep "shadowsocks-libev" | cut -d" " -f2'
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
  getSsOverKtProcess () {
    const cmd = 'ps -w| grep "[s]s-redir -c .*ss-over-kt.json"'
    return this.remoteExec(cmd)
  }
  getSsProcess () {
    // const cmd = 'ps | grep "[s]s-redir -c .*ss-client.json"'
    const cmd = 'ps -w| grep "[s]s-redir -c .*ss-client.json"'
    return this.remoteExec(cmd)
  }
  getSsDNSProcess () {
    const cmd = 'ps -w| grep "[s]s-tunnel -c .*ss-dns.json"'
    return this.remoteExec(cmd)
  }

  // kcptun
  installKt () {
    const cmd = `tar -xvzf ${this.config.vrouter.configDir}/third_party/kcptun*.tar.gz ` +
      ` && rm server_linux_* && mv client_linux* /usr/bin/kcptun`
    return this.remoteExec(cmd)
  }
  getKtVersion () {
    const cmd = 'kcptun --version | cut -d" " -f3'
    return this.remoteExec(cmd)
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
  getOpenwrtVersion () {
    const cmd = 'cat /etc/banner'
    return this.remoteExec(cmd)
      .then((output) => {
        const reg = /^ *(\w+ \w+ \(.*\)) *$/mg
        const match = reg.exec(output)
        return Promise.resolve((match && match[1]) || '')
      })
  }

  // proxies
  getFile (file) {
    const cmd = `cat ${file}`
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
    await this.servicc('shadowsocks', 'restart')
    await this.service('firewall', 'restart')
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
      this.service('firewall', 'restart'),
      this.service('dnsmasq', 'restart')
    ])
  }
}

module.exports = {
  VRouterRemote
}
