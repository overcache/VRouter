const path = require('path')
class VRouterRemote {
  // todo: reconnect
  constructor (connect, config, local) {
    this.connect = connect
    this.config = config
    this.local = local
  }

  remoteExec (cmd) {
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
            return reject(stderr.toString().trim())
          } else {
            return resolve(stdout.toString().trim())
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
    this.remoteExec(cmd)
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

  async restartFirewall (copyFiles = false) {
    /*
     * 1. ipset
     * 2. firewall
     */
    if (copyFiles) {
      const files = ''
      await copyFiles(files)
    }
  }
  async changeProtocal (protocal) {
    if (this.config.firewall.currentProtocal === protocal) {
      return
    }
    await this.local.generateFWRules(protocal, this.config.firewall.currentMode)
    await this.restartFirewall(true)
  }

  async changeMode (mode) {

  }
  close () {
    return this.connect.end()
  }
}

module.exports = {
  VRouterRemote
}
