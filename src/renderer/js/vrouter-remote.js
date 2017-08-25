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
