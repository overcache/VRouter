const { URL } = require('url')
const http = require('http')
const https = require('https')
const fs = require('fs-extra')
const path = require('path')
const { getAppDir } = require('./helper.js')
const packageJson = require('../package.json')
const dns = require('dns')
const crypto = require('crypto')
const { EventEmitter } = require('events')
const os = require('os')
const winston = require('winston')

let VBoxManage

if (os.platform() === 'darwin') {
  VBoxManage = '/usr/local/bin/VBoxManage'
} else if (os.platform() === 'win32') {
  VBoxManage = 'C:\\Program Files\\Oracle\\VirtualBox'
}

class VRouter {
  constructor (cfgObj) {
    let config
    let cfg = path.join(getAppDir(), packageJson.name, 'config.json')
    if (!cfgObj) {
      try {
        config = fs.readJsonSync(cfg)
      } catch (err) {
        const template = path.join(__dirname, '..', 'config', 'config.json')
        config = fs.readJsonSync(template)
        fs.copySync(template, cfg)
      }
      if (!config.host.configDir) {
        config.host.configDir = path.join(getAppDir(), packageJson.name)
      }
    } else {
      config = cfgObj
    }
    this.config = config
    this.process = new EventEmitter()
    this.remote = null
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

  // os

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
      `${VBoxManage} convertfromraw --format VDI stdin "${vdi}" ${vdiSize}`)

    subCmds.push(`${VBoxManage} createvm --name ${this.config.vrouter.name} --register`)

    subCmds.push(`${VBoxManage} modifyvm ${this.config.vrouter.name} ` +
      ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
      ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
      ` --audio "none" --vram "16"`)

    subCmds.push(`${VBoxManage} storagectl ${this.config.vrouter.name} ` +
      `--name "SATA Controller" --add "sata" --portcount "4" ` +
      `--hostiocache "on" --bootable "on"`)

    subCmds.push(`${VBoxManage} storageattach ${this.config.vrouter.name} ` +
      `--storagectl "SATA Controller" --port "1" ` +
      `--type "hdd" --nonrotational "on" --medium "${vdi}"`)

    try {
      await this.localExec(subCmds.join(' && '))
      await this.lockGUIConfig()
      await this.hidevm()

      await this.toggleSerialPort('on')
      this.process.emit('build', '配置虚拟机串口')

      await this.configvmNetwork()
      this.process.emit('build', '配置虚拟机网络')

      await this.startvm()
      this.process.emit('build', '开始启动虚拟机...请稍候30秒')
      await this.wait(30000)

      await this.changevmPwd()
      this.process.emit('build', '修改虚拟机密码')

      await this.configDnsmasq()
      this.process.emit('build', '配置Dnsmasq')

      await this.changevmTZ()
      this.process.emit('build', '修改虚拟机时区')

      await this.turnOnFastOpen()
      this.process.emit('build', '打开tcp fast open')

      await this.configvmLanIP()
      this.process.emit('build', '配置虚拟机网络地址, 请稍候10秒')
      await this.wait(10000)

      await this.installPackage()
      this.process.emit('build', '更新软件源并安装必要软件包, 请稍候20-60秒')
      await this.wait(20000)
      // return this.serialLog('done: install package && restart dropbear')

      let remote
      let retry = -1
      while (true) {
        try {
          retry += 1
          remote = await this.connect()
          const output = await remote.remoteExec('tail -n 1 /vrouter.log')
          if (output === 'done: install package && restart dropbear') {
            winston.debug('安装软件包完成')
            this.process.emit('build', '安装软件包完成')
            break
          } else {
            throw Error('未完成')
          }
        } catch (err) {
          if (retry >= 4) {
            throw Error('未能安装软件包, 请确保网络通畅后重试')
          }
          winston.debug('安装软件包未完成, 10秒后重试')
          // this.process.emit('buid', '无法登录到虚拟机, 10秒后重试')
          await this.wait(10000)
        }
      }
      this.process.emit('build', '成功登录虚拟机')
      await this.serialLog('done: connect to vm')

      const src = path.join(__dirname, '..', 'third_party')
      const dst = this.config.vrouter.configDir + '/third_party/'
      await remote.scp(src, dst)
        .catch((error) => {
          throw error
        })
      this.process.emit('build', '拷贝 shadowsocks[r] 以及 kcptun 到虚拟机')
      await this.serialLog('done: scp third_party')

      await remote.scpConfigAll()
      this.process.emit('build', '拷贝配置文件到虚拟机')
      await this.serialLog('done: scpConfigAll')

      await remote.installKt()
      await this.serialLog('done: installKt')
      this.process.emit('build', '安装 kcptun')
      if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
        await this.enableService('kcptun')
        this.process.emit('build', '设置 kcptun 随虚拟机启动')
        await this.serialLog('done: enable kcptun')
      }

      await remote.installSs()
      this.process.emit('build', '安装 shadowsocks')
      await this.serialLog('done: install SS')
      const p = this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
      if (p === 'ss' || p === 'ssKt') {
        await this.enableService('shadowsocks')
        this.process.emit('build', '设置 shadowsocks 随虚拟机启动')
        await this.serialLog('done: enable SS')
      }

      await remote.installSsr()
      this.process.emit('build', '安装 shadowsocksr')
      await this.serialLog('done: install ssr')
      if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('ssr')) {
        await this.enableService('shadowsocksr')
        this.process.emit('build', '设置 shadowsocksr 随虚拟机启动')
        await this.serialLog('done: enable ssr')
      }

      await this.enableService('cron')
      this.process.emit('build', '启用 cron 服务')
      await this.serialLog('done: enable cron')

      await this.configWatchdog()
      this.process.emit('build', '安装守护脚本')
      await this.serialLog('done: install watchdog')

      this.process.emit('build', '保存设置, 关闭虚拟机...')
      await this.serialLog('done: shutting down')
      await remote.shutdown()
      await remote.closeConn().catch(() => {})
      await this.wait(10000)

      this.process.emit('build', '在宿主安装守护脚本, 维持dns和网关的一致.')
      await this.installNwWatchdog()
    } catch (error) {
      throw error
    }
  }

  async configvmNetwork () {
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
    await this.isNIC1ConfigedAsHostonly(this.config.vrouter.name, this.config.host.ip)
      .catch(() => {
        winston.debug(`isNIC1ConfigedAsHostonly return false. vrouter: ${this.config.vrouter.name}, hostip: ${this.config.host.ip}`)
        return this.specifyHostonlyAdapter()
      })
    await this.isNIC2ConfigedAsBridged(this.config.vrouter.name)
      .catch(() => {
        winston.debug(`isNIC2ConfigedAsBridged return false. vrouter: ${this.config.vrouter.name}, hostip: ${this.config.host.ip}`)
        return this.specifyBridgeAdapter()
      })
  }

  async configvmLanIP () {
    // execute cmd
    const subCmds = []
    subCmds.push(`uci set network.lan.ipaddr='${this.config.vrouter.ip}'`)
    subCmds.push('uci commit network')
    subCmds.push('/etc/init.d/network restart')
    await this.serialExec(subCmds.join(' && '), 'config lan ipaddr')
    return this.serialLog('done: configvmLanIP')
  }

  async configDnsmasq () {
    const cmd = "mkdir /etc/dnsmasq.d && echo 'conf-dir=/etc/dnsmasq.d/' > /etc/dnsmasq.conf"
    await this.serialExec(cmd, 'configDnsmasq')
    return this.serialLog('done: configDnsmasq')
  }
  enableService (service) {
    const cmd1 = `chmod +x /etc/init.d/${service} && /etc/init.d/${service} enable`
    return this.serialExec(cmd1, `enable ${service}`)
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
        uci set system.@system[0].hostname='${this.config.vrouter.name}'
        uci set system.@system[0].timezone='HKT-8'
        uci set system.@system[0].zonename='Asia/Hong Kong'
        uci commit system`
    await this.serialExec(cc.trim().split('\n').map(line => line.trim()).join(' && '), 'change timezone')
    return this.serialLog('done: changevmTZ')
  }
  async changevmPwd () {
    await this.serialExec("echo -e 'root\\nroot' | (passwd root)", 'change password')
    return this.serialLog('done: changevmPwd')
  }
  async turnOnFastOpen () {
    await this.serialExec('echo "net.ipv4.tcp_fastopen = 3" >> /etc/sysctl.conf && sysctl -p /etc/sysctl.conf')
    return this.serialLog('done: trunOn fast_open')
  }
  async installPackage () {
    const subCmds = []
    subCmds.push(`sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\\/openwrt/g' /etc/opkg/distfeeds.conf`)
    subCmds.push('opkg update')
    subCmds.push('opkg remove dnsmasq && opkg install dnsmasq-full ipset openssh-sftp-server libopenssl rng-tools')
    subCmds.push('/etc/init.d/dropbear restart')
    await this.serialExec(subCmds.join(' && '), 'install packages')
    return this.serialLog('done: install package && restart dropbear')
  }

  deleteCfgFile (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    return fs.remove(filePath)
      .catch(() => {
        // don't panic. that's unnecessary to delete a non existed file.
      })
  }
  async getCfgContent (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return content
    } catch (error) {
      const template = path.join(__dirname, '../config', fileName)
      winston.debug(`can not find ${filePath}, copy template ${template} to appdir`)
      await fs.copy(template, filePath)
      return fs.readFile(filePath, 'utf8')
    }
  }
  async generateIPsets (overwrite = false) {
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]

    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.ipsetsFile)
    const stats = await fs.stat(cfgPath)
      .catch(() => null)
    if (stats && stats.isFile() && !overwrite) {
      return cfgPath
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
    if (profile.selectedWL.lanNetworks) {
      winston.debug(`getCfgContent: ${this.config.firewall.lanNetworks}`)
      const lan = await this.getCfgContent(this.config.firewall.lanNetworks)
      lan.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          ws.write(`add ${this.config.firewall.ipsets.lan} ${trimLine}\n`)
        }
      })
    }

    if (profile.selectedWL.chinaIPs) {
      const chinaIPs = await this.getCfgContent(this.config.firewall.chinaIPs)
      chinaIPs.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          ws.write(`add ${this.config.firewall.ipsets.white} ${trimLine}\n`)
        }
      })
    }

    if (profile.selectedWL.extraWhiteList) {
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

    if (profile.selectedBL.extraBlackList) {
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
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
    const cfg = profile[proxy]
    const ipPatthen = /^\d+.\d+.\d+.\d+$/ig
    if (ipPatthen.test(cfg.address)) {
      return Promise.resolve(cfg.address)
    }
    return new Promise((resolve, reject) => {
      winston.info(`resolve domain: ${cfg.address}`)
      dns.lookup(cfg.address, { family: 4 }, (err, address, family) => {
        if (err) {
          winston.error(`resolve domain: ${cfg.address} failed.`)
          reject(err)
        }
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
    const proxies = p || this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
    const mode = m || this.config.profiles.profiles[this.config.profiles.activedProfile].mode

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
        throw Error(`unkown proxies: ${proxies}`)
    }

    ws.write('# com.icymind.vrouter\n')
    ws.write(`# workMode: ${mode}\n`)
    ws.write('ipset flush\n')
    ws.write(`/usr/sbin/ipset restore -f -! ${this.config.vrouter.configDir}/${this.config.firewall.ipsetsFile} &> /dev/null\n`)

    // if kcp protocol: speedup ssh
    // if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt') && this.config.server.sshPort) {
    /*
     * if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
     *   ws.write('# speedup ssh connection if current proxy is kcptun\n')
     *   serverIPs.forEach((ip) => {
     *     // const rule = `-d ${ssServerIP} -p tcp --dport ${this.config.server.sshPort} -j REDIRECT --to-port ${redirPort}`
     *     const rule = `-d ${ip} -p tcp --dport 11235 -j REDIRECT --to-port ${redirPort}`
     *     ws.write(this.generateFWRulesHelper(rule))
     *   })
     * }
     */

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
      `127.0.0.1#${this.config.tunnelDns.dnsPort}`
    ]
  }
  async generateDnsmasqCf (overwrite = false) {
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
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

    if (this.config.profiles.profiles[this.config.profiles.activedProfile].mode === 'none') {
      ws.write('# stay in wall\n')
      ws.end()
      return promise
    }
    if (profile.selectedBL.gfwDomains) {
      const gfwDomains = await this.getCfgContent(this.config.firewall.gfwDomains)
      gfwDomains.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          if (profile.enableTunnelDns) {
            ws.write(`server=/${trimLine}/${DNSs[1]}\n`)
          }
          ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.black}\n`)
        }
      })
    }

    if (profile.selectedBL.extraBlackList) {
      // add extra_blocked_ips to blacklist_ipset
      const extraList = await this.getCfgContent(this.config.firewall.extraBlackList)
      extraList.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          const ip = /^\d+\.\d+\.\d+\.\d+$/g
          if (!ip.test(trimLine)) {
            if (profile.enableTunnelDns) {
              ws.write(`server=/${trimLine}/${DNSs[1]}\n`)
            }
            ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.black}\n`)
          }
        }
      })
    }

    if (profile.selectedWL.extraWhiteList) {
      const extraList = await this.getCfgContent(this.config.firewall.extraWhiteList)
      extraList.split('\n').forEach((line) => {
        const trimLine = line.trim()
        if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
          const ip = /^\d+\.\d+\.\d+\.\d+$/g
          if (!ip.test(trimLine)) {
            // ws.write(`server=/${trimLine}/${DNSs[0]}\n`)
            ws.write(`ipset=/${trimLine}/${this.config.firewall.ipsets.white}\n`)
          }
        }
      })
    }

    ws.end()
    return promise
  }
  async generateCronJob () {
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.cronFile)
    const content = `* * * * * ${this.config.vrouter.configDir}/${this.config.firewall.watchdogFile}\n`
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }
  async generateWatchdog (p) {
    const proxies = p || this.config.profiles.profiles[this.config.profiles.activedProfile].proxies
    const cfgPath = path.join(this.config.host.configDir, this.config.firewall.watchdogFile)
    let content = '#!/bin/sh\n'
    const tunnelBinName = proxies.substr(0, 3) === 'ssr' ? 'sr-tunnel' : 's-tunnel'
    const tunnelDns = String.raw`
      tunnelDns=$(ps -w| grep "[s]${tunnelBinName} -c .*tunnel-dns.json")
      if [[ -z "$tunnelDns" ]];then
        /etc/init.d/${this.config.tunnelDns.service} restart
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
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
    if (profile.enableTunnelDns) {
      content += tunnelDns
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
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }
  async generateService (type = 'shadowsocks') {
    // type=tunnelDns/shadowsocks/shadowsocksr/kcptun
    const cfgPath = path.join(this.config.host.configDir, this.config[type].service)
    let content = ''
    switch (type) {
      case 'tunnelDns':
        const tunnelBinName = this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('ssr') ? 'ssr-tunnel' : 'ss-tunnel'
        content = String.raw`#!/bin/sh /etc/rc.common
          # Copyright (C) 2006-2011 OpenWrt.org
          START=85
          SERVICE_USE_PID=1
          SERVICE_WRITE_PID=1
          SERVICE_DAEMONIZE=1
          start() {
              service_start /usr/bin/${tunnelBinName} -c ${this.config.vrouter.configDir}/${this.config.tunnelDns.dns}
          }
          stop() {
              service_stop /usr/bin/${tunnelBinName}
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
              ${this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt') ? overKt : noKt}
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
    await fs.outputFile(cfgPath, content)
    return cfgPath
  }
  async generateConfig (type = 'shadowsocks') {
    const cfgs = []
    switch (type) {
      case 'shadowsocks':
        cfgs.push(this.config.shadowsocks.client)
        if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocks.overKt)
        }
        break
      case 'shadowsocksr':
        cfgs.push(this.config.shadowsocksr.client)
        if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocksr.overKt)
        }
        break
      case 'tunnelDns':
        // generateConfigHeler('tunnel-dns.json')
        cfgs.push(this.config.tunnelDns.dns)
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
  async generateConfigHeler (type = 'ss-client.json') {
    let cfg
    let fastopen
    let content = {}
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
    switch (type) {
      case this.config.shadowsocks.client:
        cfg = this.config.shadowsocks.client
        fastopen = profile.shadowsocks.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': profile.shadowsocks.address,
          'server_port': parseInt(profile.shadowsocks.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocks.clientPort),
          'password': profile.shadowsocks.password,
          'timeout': parseInt(profile.shadowsocks.timeout),
          'method': profile.shadowsocks.method,
          'fast_open': fastopen,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocks.overKt:
        cfg = this.config.shadowsocks.overKt
        fastopen = profile.shadowsocks.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': '127.0.0.1',
          'server_port': parseInt(this.config.kcptun.clientPort),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocks.overKtPort),
          'password': profile.shadowsocks.password,
          'timeout': 20,
          'method': profile.shadowsocks.method,
          'fast_open': fastopen,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocksr.client:
        cfg = this.config.shadowsocksr.client
        fastopen = profile.shadowsocksr.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': profile.shadowsocksr.address,
          'server_port': parseInt(profile.shadowsocksr.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocksr.clientPort),
          'password': profile.shadowsocksr.password,
          'timeout': parseInt(profile.shadowsocksr.timeout),
          'method': profile.shadowsocksr.method,
          'fast_open': fastopen,
          'mode': 'tcp_only',
          'protocol': profile.shadowsocksr.protocol,
          'protocol_param': profile.shadowsocksr.protocol_param,
          'obfs': profile.shadowsocksr.obfs,
          'obfs_param': profile.shadowsocksr.obfs_param
        }
        profile.shadowsocksr.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.shadowsocksr.overKt:
        cfg = this.config.shadowsocksr.overKt
        fastopen = profile.shadowsocksr.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': '127.0.0.1',
          'server_port': parseInt(this.config.kcptun.clientPort),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocksr.overKtPort),
          'password': profile.shadowsocksr.password,
          'timeout': 20,
          'method': profile.shadowsocksr.method,
          'fast_open': fastopen,
          'mode': 'tcp_only',
          'protocol': profile.shadowsocksr.protocol,
          'protocol_param': profile.shadowsocksr.protocol_param,
          'obfs': profile.shadowsocksr.obfs,
          'obfs_param': profile.shadowsocksr.obfs_param
        }
        profile.shadowsocksr.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.tunnelDns.dns:
        cfg = this.config.tunnelDns.dns
        const isSsr = profile.proxies.includes('ssr')
        const server = isSsr ? profile.shadowsocksr : profile.shadowsocks
        fastopen = server.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': server.address,
          'server_port': parseInt(server.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.tunnelDns.dnsPort),
          'password': server.password,
          'timeout': parseInt(server.timeout),
          'method': server.method,
          'fast_open': fastopen,
          'tunnel_address': '8.8.8.8:53',
          'mode': 'udp_only'
        }
        if (isSsr) {
          const moreFields = ['protocol', 'protocol_param', 'obfs', 'obfs_param']
          moreFields.forEach((field) => {
            content[field] = server[field]
          })
          server.others.split(';').forEach((kv) => {
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
          'remoteaddr': `${profile.kcptun.address}:${profile.kcptun.port}`,
          'localaddr': `:${this.config.kcptun.clientPort}`,
          'key': profile.kcptun.key,
          'crypt': profile.kcptun.crypt,
          'mode': profile.kcptun.mode
        }
        profile.kcptun.others.split(';').forEach((kv) => {
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
    await fs.writeJson(cfgPath, content, {spaces: 2})
    return cfgPath
  }

  async generateNetworkPlist () {
    const content = String.raw`
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>${this.config.host.networkPlistName}</string>

        <key>ProgramArguments</key>
        <array>
            <string>${path.join(this.config.host.configDir, this.config.host.networkSh)}</string>
        </array>

        <key>WatchPaths</key>
        <array>
            <string>/etc/resolv.conf</string>
            <string>/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist</string>
            <string>/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist</string>
        </array>

        <key>RunAtLoad</key>
        <true/>
        <key>StandardErrorPath</key>
        <string>${path.join(os.tmpdir(), path.basename(this.config.host.networkSh, '.sh') + '.log')}</string>
        <key>StandardOutPath</key>
        <string>${path.join(os.tmpdir(), path.basename(this.config.host.networkSh, '.sh') + '.log')}</string>
      </dict>
    </plist>`

    const cfgPath = path.join(this.config.host.configDir, this.config.host.networkPlist)
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }

  async generateNetworkSh () {
    // TODO: reduce log size
    const username = await this.localExec('whoami')
    const content = String.raw`#!/bin/bash
    echo "$(date)"
    echo "Network change"
    echo "==============="
scutil_query() {
    key=$1

    scutil<<EOT
    open
    get $key
    d.show
    close
EOT
}

get_primary_service() {
    local SERVICE_GUID=$(scutil_query State:/Network/Global/IPv4 | grep "PrimaryService" | awk '{print $3}')

    local SERVICE_NAME=$(scutil_query Setup:/Network/Service/$SERVICE_GUID | grep "UserDefinedName" | awk -F': ' '{print $2}')

    echo $SERVICE_NAME
}

get_primary_router() {
    local ROUTER_IP=$(scutil_query State:/Network/Global/IPv4 | grep "Router" | awk '{print $3}')
    echo $ROUTER_IP
}

VROUTERIP="${this.config.vrouter.ip}"
VROUTERNAME="${this.config.vrouter.name}"

# current router
ROUTERIP=$(get_primary_router)
echo "ROUTERIP: $ROUTERIP"
INTERFACE=$(get_primary_service)
echo "INTERFACE: $INTERFACE"

# check gateway & dns
GATEWAY=$(route -n get default | grep gateway | awk '{print $2}')
echo "GATEWAY: $GATEWAY"
DNS=$(/usr/sbin/networksetup -getdnsservers "$INTERFACE")
# echo "DNS: $DNS"

# check vm status
VMSTATE=$(su ${username.trim()} -c "/usr/local/bin/VBoxManage list runningvms | grep $VROUTERNAME")
echo "VMState: $VMSTATE"

# change route/dns
if [[ $GATEWAY ==  $VROUTERIP && $DNS != $VROUTERIP ]]; then
    if [[ -z $VMSTATE ]]; then
        echo "# vm is stopped. reset gateway to router"
        sudo /sbin/route change default $ROUTERIP
    else
        echo "# vm is running. change dns to vrouter"
        sudo /usr/sbin/networksetup -setdnsservers "$INTERFACE" "$VROUTERIP"
    fi
fi

if [[ $GATEWAY != $VROUTERIP && $DNS == $VROUTERIP ]]; then
    if [[ -z $VMSTATE ]]; then
        echo "# vm is stopped. reset DNS to router"
        sudo /usr/sbin/networksetup -setdnsservers "$INTERFACE" "$ROUTERIP"
    else
        echo "#vm is running. change gateway to vrouter"
        sudo /sbin/route change default $VROUTERIP
    fi
fi
echo ""`

    const cfgPath = path.join(this.config.host.configDir, this.config.host.networkSh)
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
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
  async upgradeCfgV1 (newCfg) {
    // const template = path.join(__dirname, '..', 'config', 'config.json')
    // const newCfg = fs.readJsonSync(template)
    if (this.config.version === newCfg.version) {
      return
    }
    if (!this.config.version) {
      // version 0.1 to 0.2
      const ssFields = ['address', 'port', 'password', 'timeout', 'method', 'fastopen']
      ssFields.forEach((field) => {
        newCfg.shadowsocks.server[field] = this.config.shadowsocks.server[field]
      })
      const ktFields = ['address', 'port', 'key', 'crypt', 'mode']
      const others = []
      Object.keys(this.config.kcptun.server).forEach((key) => {
        if (ktFields.includes(key)) {
          newCfg.kcptun.server[key] = this.config.kcptun.server[key]
        } else {
          others.push(`${key}=${this.config.kcptun.server[key]}`)
        }
      })
      newCfg.kcptun.server.others = others.join(';')

      newCfg.firewall.currentMode = this.config.firewall.currentMode
      const dict = {
        'shadowsocks': 'ss',
        'kcptun': 'ssKt'
      }
      newCfg.firewall.currentProxies = dict[this.config.firewall.currentProtocol]

      newCfg.host.configDir = this.config.host.configDir
      this.config = newCfg

      const thirdParty = path.join(__dirname, '..', 'third_party')
      const remote = await this.connect()
      await remote.scp(`${thirdParty}/ssr-tunnel`, '/usr/bin/')
      await remote.scp(`${thirdParty}/ssr-redir`, '/usr/bin/')
      await remote.remoteExec('chmod +x /usr/bin/ssr-*')
      await remote.remoteExec('opkg update && opkg install libopenssl')
      await remote.service('shadowsocks', 'stop').catch(() => {})
      await remote.service('kcptun', 'stop').catch(() => {})
      await remote.remoteExec('rm /etc/com.icymind.vrouter/ss-dns.json').catch(() => {})
      // await remote.changeProxies()
      await remote.closeConn()
    }
  }
  async upgradeCfgV2 (newCfg) {
    // const template = path.join(__dirname, '..', 'config', 'config.json')
    // const newCfg = fs.readJsonSync(template)
    if (this.config.version === '0.2') {
      const profiles = []
      // 如果ss地址不是123123...拷贝到newCfg
      // 同理ssr/kcptun
      const oldSS = this.config.shadowsocks.server
      const oldSSR = this.config.shadowsocksr.server
      const oldKT = this.config.kcptun.server
      if (oldSS.address && oldSS.address !== '123.123.123.123') {
        const profile = {
          'name': '配置oo',
          'mode': 'whitelist',
          'proxies': 'ss',
          'relayUDP': false,
          'enableTunnelDns': true,
          'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
          'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
          'shadowsocks': oldSS
        }
        profiles.push(profile)
      }
      if (oldSSR.address && oldSSR.address !== '123.123.123.123') {
        const profile = {
          'name': '配置xx',
          'mode': 'blacklist',
          'proxies': 'ssr',
          'relayUDP': false,
          'enableTunnelDns': true,
          'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
          'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
          'shadowsocksr': oldSSR
        }
        profiles.push(profile)
      }
      if (oldKT.address && oldKT.address !== '123.123.123.123') {
        const profile = {
          'name': '配置tt',
          'mode': 'whitelist',
          'proxies': 'ssKt',
          'relayUDP': false,
          'enableTunnelDns': true,
          'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
          'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
          'shadowsocks': oldSS,
          'kcptun': oldKT
        }
        profiles.push(profile)
      }
      if (profiles.length !== 0) {
        newCfg.profiles.profiles = profiles
      }
      newCfg.host.configDir = this.config.host.configDir
      this.config = newCfg
      await this.installNwWatchdog()
    }
  }
  parseProfileURI (uri) {
    // ssr://dnBzLmljeW1pbmQuY29tOjk5OTk6YXV0aF9hZXMxMjhfbWQ1OmNoYWNoYTIwOnRsczEuMl90aWNrZXRfYXV0aDphR0Z3Y0hramMzTnlJekl3TVRjLz9vYmZzcGFyYW09JnByb3RvcGFyYW09TXpJJnJlbWFya3M9UVc1a2NtOXBaQ0JUVTFJZ1JHVm1ZWFZzZEEmZ3JvdXA9ZG5Ceg

    // ss://Y2hhY2hhMjA6aGFwcHkjc3MjMjAxNw@vps.icymind.com:7979?plugin=kcptun%3Bnocomp%3Dtrue%3Bmode%3Dfast%3Bkey%3Dhappy%23kt%232017%3Bcrypt%3Dnone#kcptun

    // ss://Y2hhY2hhMjA6aGFwcHkjc3MjMjAxNw@vps.icymind.com:8989#%E6%98%8E%E6%98%8E%E6%98%8E
    let profile = {
      'name': '配置xx',
      'action': 'new',
      'mode': 'whitelist',
      'proxies': 'ss',
      'relayUDP': false,
      'enableTunnelDns': true,
      'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
      'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
      'shadowsocks': {
        'address': '123.123.123.123',
        'port': '8989',
        'password': 'demo-paswd',
        'timeout': 300,
        'method': 'chacha20',
        'fastopen': false
      },
      'shadowsocksr': {
        'address': '123.123.123.123',
        'port': '9999',
        'password': 'demo-paswd',
        'timeout': 300,
        'method': 'chacha20',
        'protocol': 'auth_aes128_md5',
        'protocol_param': '32',
        'obfs': 'tls1.2_ticket_auth',
        'obfs_param': '',
        'others': '',
        'fastopen': false
      },
      'kcptun': {
        'address': '',
        'port': '',
        'key': 'demo-secret',
        'crypt': 'aes-128',
        'mode': 'fast2',
        'others': 'sndwnd=256;rcvwnd=2048;nocomp=true'
      }
    }
    let type = uri.substr(0, uri.indexOf(':'))
    if (type === 'ssr') {
      profile.proxies = 'ssr'
      let decode = Buffer.from(uri.substr(6), 'base64').toString()
      const separatorIndex = decode.indexOf('/?')
      let config = decode.substr(0, separatorIndex).split(':')
      config[config.length - 1] = Buffer.from(config[config.length - 1], 'base64').toString()
      ;[profile.shadowsocksr.address, profile.shadowsocksr.port, profile.shadowsocksr.protocol, profile.shadowsocksr.method, profile.shadowsocksr.obfs, profile.shadowsocksr.password] = config

      config = decode.substr(separatorIndex + 2).split('&')
      config.forEach((pair) => {
        let [key, value] = pair.split('=')
        value = Buffer.from(value, 'base64').toString()
        switch (key) {
          case 'obfsparam':
            profile.shadowsocksr.obfs_param = value
            break
          case 'protoparam':
            profile.shadowsocksr.protocol_param = value
            break
          case 'remarks':
            profile.name = value
            break
          case 'group':
            break
          default:
            profile.shadowsocksr.others += `${key}=${value};`
        }
      })
    } else if (type === 'ss') {
      profile.proxies = 'ss'
      const nameIndex = uri.lastIndexOf('#')
      if (nameIndex >= 0) {
        profile.name = decodeURIComponent(uri.substr(nameIndex + 1))
      }
      const separatorIndex = uri.indexOf('@')
      if (separatorIndex > 0) {
        // https://shadowsocks.org/en/spec/SIP002-URI-Scheme.html
        // ss://YmYtY2ZiOnRlc3Q@192.168.100.1:8888/?plugin=url-encoded-plugin-argument-value&unsupported-arguments=should-be-ignored#Dummy+profile+name
        let decode = Buffer.from(uri.substr(5, separatorIndex - 5), 'base64').toString()
        ;[profile.shadowsocks.method, profile.shadowsocks.password] = decode.split(':')

        const pluginIndex = uri.indexOf('?plugin')
        if (pluginIndex < 0) {
          // without plugin
          decode = uri.substr(separatorIndex + 1, nameIndex < 0 ? undefined : nameIndex - separatorIndex - 1)
          ;[profile.shadowsocks.address, profile.shadowsocks.port] = decode.split(':')
        } else {
          // with plugin
          decode = uri.substr(separatorIndex + 1, pluginIndex - separatorIndex - 1)
          ;[profile.shadowsocks.address, profile.shadowsocks.port] = decode.split(':')

          let plugin = uri.substr(pluginIndex + '?plugin'.length + 1, nameIndex - 1 - pluginIndex - '?plugin'.length)
          let config = decodeURIComponent(plugin).split(';')
          if (config[0] !== 'kcptun') {
            throw Error(`unsupported plugin: ${config[0]}`)
          } else {
            profile.proxies = 'ssKt'
            let others = ''
            config.slice(1).forEach((pair) => {
              let [key, value] = pair.split('=')
              switch (key) {
                case 'mode':
                case 'key':
                case 'crypt':
                  profile.kcptun[key] = value
                  break
                default:
                  others += `${pair};`
              }
            })
            profile.kcptun.address = profile.kcptun.address || profile.shadowsocks.address
            profile.kcptun.port = profile.kcptun.port || profile.shadowsocks.port
            profile.kcptun.others = others === '' ? profile.kcptun.others : others
          }
        }
      } else {
        // https://shadowsocks.org/en/config/quick-guide.html
        // ss://YmYtY2ZiOnRlc3RAMTkyLjE2OC4xMDAuMTo4ODg4Cg#example-server
        let index = uri.indexOf('#')
        let decode = Buffer.from(uri.substr(5, index < 0 ? undefined : nameIndex - 5), 'base64').toString()
        let config = decode.split('@')
        ;[profile.shadowsocks.address, profile.shadowsocks.port, profile.shadowsocks.method, profile.shadowsocks.password] = [...config[1].split(':'), ...config[0].split(':')]
      }
    } else {
      throw Error('unsupported URI')
    }
    return profile
  }
  async copyTemplate (fileName) {
    const template = path.join(__dirname, '..', 'config', fileName)
    const dest = path.join(this.config.host.configDir, fileName)
    try {
      await fs.stat(dest)
      return dest
    } catch (error) {
      winston.debug(`copy template: ${fileName}`)
      await fs.copy(template, dest)
      return dest
    }
  }
  async deleteLogFile () {
    const logFile = path.join(this.config.host.configDir, 'vrouter.log')
    winston.info(`delete logFile: ${logFile}`)
    return this.localExec(`rm "${logFile}"`)
  }
}
module.exports = {
  VRouter
}
