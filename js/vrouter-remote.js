const winston = require('winston')
const path = require('path')
class VRouterRemote {
  // todo: reconnect

  constructor (connect, sftp, config, local) {
    this.connect = connect
    this.config = config
    this.local = local
    this.sftp = sftp
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
  async scp (src, dest) {
    winston.info(`scp ${src} to vrouter:${dest}`)
    let isDestDir = false
    if (dest.endsWith('/')) {
      isDestDir = true
      await this.remoteExec(`mkdir -p ${dest}`)
    } else {
      await this.remoteExec(`mkdir -p ${path.dirname(dest)}`)
    }

    let files
    try {
      const names = require('fs').readdirSync(src)
      files = names.map(name => `${src}/${name}`)
    } catch (error) {
      if (error.code === 'ENOTDIR') {
        files = [src]
      } else {
        throw error
      }
    }
    const promises = []
    for (let i = 0; i < files.length; i++) {
      const p = new Promise((resolve, reject) => {
        let s = files[i]
        let d = isDestDir ? `${dest}${path.basename(files[i])}` : dest
        this.sftp.fastPut(s, d, (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
      promises.push(p)
    }
    return Promise.all(promises)
  }
  async scpConfig (type = 'shadowsocks', overwrite = false) {
    let p
    switch (type) {
      case 'tunnelDnsService':
        p = await this.local.generateService('tunnelDns')
        await this.scp(p, '/etc/init.d/')
        await this.remoteExec(`chmod +x /etc/init.d/${this.config.tunnelDns.service}`)
        break
      case 'ssService':
        p = await this.local.generateService('shadowsocks')
        await this.scp(p, '/etc/init.d/')
        await this.remoteExec(`chmod +x /etc/init.d/${this.config.shadowsocks.service}`)
        break
      case 'ssrService':
        p = await this.local.generateService('shadowsocksr')
        await this.scp(p, '/etc/init.d/')
        await this.remoteExec(`chmod +x /etc/init.d/${this.config.shadowsocksr.service}`)
        break
      case 'ktService':
        p = await this.local.generateService('kcptun')
        await this.scp(p, '/etc/init.d/')
        await this.remoteExec(`chmod +x /etc/init.d/${this.config.kcptun.service}`)
        break
      case 'tunnelDns':
      case 'shadowsocks':
      case 'shadowsocksr':
      case 'kcptun':
        p = await this.local.generateConfig(type)
        for (let i = 0; i < p.length; i++) {
          await this.scp(p[i], `${this.config.vrouter.configDir}/`)
        }
        break
      case 'dnsmasq':
        p = await this.local.generateDnsmasqCf(overwrite)
        await this.scp(p, '/etc/dnsmasq.d/')
        break
      case 'ipset':
        p = await this.local.generateIPsets(overwrite)
        await this.scp(p, `${this.config.vrouter.configDir}/`)
        break
      case 'firewall':
        p = await this.local.generateFWRules(null, null, overwrite)
        await this.scp(p, '/etc/')
        break
      case 'watchdog':
        p = await this.local.generateWatchdog()
        await this.scp(p, `${this.config.vrouter.configDir}/`)
        await this.remoteExec(`chmod +x ${this.config.vrouter.configDir}/${this.config.firewall.watchdogFile}`)
        break
      case 'cron':
        p = await this.local.generateCronJob()
        await this.scp(p, `${this.config.vrouter.configDir}/`)
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
    if (this.config.profiles.profiles[this.config.profiles.activedProfile].enableTunnelDns) {
      types.push('tunnelDnsService')
      types.push('tunnelDns')
    }
    const proxies = this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
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
    winston.info(`${action} service: ${name}`)
    const cmd = `/etc/init.d/${name} ${action}`
    return this.remoteExec(cmd)
  }

  // network
  async getIP (inf) {
    const cmd = `ifconfig ${inf} | grep 'inet addr'`
    const output = await this.remoteExec(cmd)
    const reg = /^inet addr:(\d+.\d+.\d+.\d+)/
    const match = reg.exec(output.trim())
    return (match && match[1]) || ''
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
  installSsr () {
    const cmd = `mv ${this.config.vrouter.configDir}/third_party/ssr-* /usr/bin/ && chmod +x /usr/bin/ssr-*`
    return this.remoteExec(cmd)
  }
  getSsVersion () {
    const cmd = 'ss-redir -h | grep "shadowsocks-libev" | cut -d" " -f2'
    return this.remoteExec(cmd)
  }
  async isSsRunning () {
    let cmd = ''
    if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies === 'ss') {
      cmd = 'ps -w| grep "[s]s-redir -c .*ss-client.json"'
    } else {
      cmd = 'ps -w| grep "[s]s-redir -c .*ss-over-kt.json"'
    }
    const output = await this.remoteExec(cmd)
    if (output) {
      return true
    } else {
      return false
    }
  }
  getSsrVersion () {
    const cmd = 'ssr-redir -h | grep "shadowsocks-libev" | cut -d" " -f2'
    return this.remoteExec(cmd)
  }
  async isSsrRunning () {
    let cmd = ''
    if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies === 'ssr') {
      cmd = 'ps -w| grep "[s]sr-redir -c .*ssr-client.json"'
    } else {
      cmd = 'ps -w| grep "[s]sr-redir -c .*ssr-over-kt.json"'
    }
    const output = await this.remoteExec(cmd)
    if (output) {
      return true
    } else {
      return false
    }
  }
  async isTunnelDnsRunning () {
    const tunnelBinName = this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('ssr') ? 'sr-tunnel' : 's-tunnel'
    const cmd = `ps -w| grep "[s]${tunnelBinName} -c .*tunnel-dns.json"`
    const output = await this.remoteExec(cmd)
    if (output) {
      return true
    } else {
      return false
    }
  }
  // kcptun
  installKt () {
    // const cmd = `tar -xvzf ${this.config.vrouter.configDir}/third_party/kcptun*.tar.gz ` +
      // ` && rm server_linux_* && mv client_linux* /usr/bin/kcptun`
    const cmd = `mv ${this.config.vrouter.configDir}/third_party/kcptun /usr/bin/ && chmod +x /usr/bin/kcptun`
    return this.remoteExec(cmd)
  }
  getKtVersion () {
    const cmd = 'kcptun --version | cut -d" " -f3'
    return this.remoteExec(cmd)
  }
  async isKtRunning () {
    const cmd = 'ps | grep "[k]cptun -c"'
    const output = await this.remoteExec(cmd)
    if (output) {
      return true
    } else {
      return false
    }
  }
  async getOpenwrtVersion () {
    const cmd = 'cat /etc/banner'
    const output = await this.remoteExec(cmd)
    const reg = /^ *(\w+ \w+ \(.*\)) *$/mg
    const match = reg.exec(output)
    return (match && match[1]) || ''
  }

  // proxies
  getFile (file) {
    const cmd = `cat ${file}`
    return this.remoteExec(cmd)
  }
  async applyProfile () {
    // stop tunnelDns before change tunnelDns.service's file content
    await this.service(this.config.tunnelDns.service, 'stop').catch(() => {})

    // let s = Date.now()
    await this.scpConfigAll(true)
    // console.log(`scpConfigAll time: ${(Date.now() - s) / 1000}`)
    const promises = []
    switch (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies) {
      case 'ss':
        promises.push(...[
          this.service('shadowsocksr', 'stop').catch(() => {}),
          this.service('kcptun', 'stop').catch(() => {}),
          this.service('shadowsocks', 'restart')
        ])
        break
      case 'ssr':
        promises.push(...[
          this.service('shadowsocks', 'stop').catch(() => {}),
          this.service('kcptun', 'stop').catch(() => {}),
          this.service('shadowsocksr', 'restart')
        ])
        break
      case 'ssKt':
        promises.push(...[
          this.service('shadowsocksr', 'stop').catch(() => {}),
          this.service('kcptun', 'restart'),
          this.service('shadowsocks', 'restart')
        ])
        break
      case 'ssrKt':
        promises.push(...[
          this.service('shadowsocks', 'stop').catch(() => {}),
          this.service('kcptun', 'restart'),
          this.service('shadowsocksr', 'restart')
        ])
        break
      default:
        throw Error('unkown proxies')
    }
    if (this.config.profiles.profiles[this.config.profiles.activedProfile].enableTunnelDns) {
      promises.push(this.service(this.config.tunnelDns.service, 'restart'))
    }
    promises.push(...[
      this.service('dnsmasq', 'restart'),
      this.service('firewall', 'restart')
    ])
    // s = Date.now()
    await Promise.all(promises)
    // console.log(`restart/stop service time: ${(Date.now() - s) / 1000}`)
  }

  async changeMode (mode, proxies) {
    await Promise.all([
      this.local.generateIPsets(true),
      this.local.generateDnsmasqCf('whitelist', true),
      this.local.generateFWRules(mode, proxies, true)
    ])
    await Promise.all([
      this.scpConfig('ipset'),
      this.scpConfig('dnsmasq'),
      this.scpConfig('firewall')
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
