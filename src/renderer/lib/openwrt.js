import Generator from './generator.js'
import logger from './logger'
const { Client } = require('ssh2')
const path = require('path')

class Openwrt {
  constructor (config) {
    this.ip = config.ip
    this.sshPort = config.sshPort || '22'
    this.username = config.username
    this.password = config.password
    this.conn = null
  }

  /*
   * 连接到远程openwrt
   * @param {int} heartbeat 多少毫秒发送一次心跳包
   * @param {int} timeout 连接前的等待时间(毫秒)
   * @return {promise} 当连接成功后resovle
   */
  connect (heartbeat = 0, timeout = 8000) {
    this.conn = new Client()
    return new Promise((resolve, reject) => {
      this.conn.on('ready', () => {
        resolve()
      }).on('close', () => {
        logger.info('ssh connection was closed')
        this.conn = null
        resolve()
      }).on('end', () => {
        logger.info('ssh connection has been ended')
        this.conn = null
        resolve()
      }).on('error', (error) => {
        logger.error(`connecting to openwrt error: ${error.message}`)
        this.conn = null
        reject(error)
      }).connect({
        host: this.ip,
        port: this.sshPort,
        username: this.username,
        password: this.password,
        keepaliveInterval: heartbeat,
        readyTimeout: timeout
      })
    })
  }
  disconnect () {
    this.conn && this.conn.end()
  }

  /*
   * 在远程openwrt上执行命令. 一些特殊的命令, 即使成功执行, 也会返回stderr
   * @param {string} cmd 待执行命令
   * @return {promise}
   */
  async execute (cmd, retry = false) {
    const self = this
    if (this.conn === null) {
      logger.debug('about to connect to openwrt via ssh')
      await this.connect()
    }
    const specialCmds = [
      '/etc/init.d/firewall restart'
    ]
    logger.debug(`about to exec cmd: ${cmd} via ssh`)
    return new Promise((resolve, reject) => {
      this.conn.exec(cmd, async (err, stream) => {
        if (err) {
          logger.debug(`this.conn.exec() err: ${err}`)
          if (!retry) {
            logger.debug(`retry exec cmd via ssh`)
            const output = await self.execute(cmd, true)
            return resolve(output.toString().trim())
          } else {
            logger.error(`retry execute cmd: ${cmd} error. ${err}`)
            reject(err)
          }
        }
        let stdout = ''
        let stderr = ''
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

  /*
   * 管理service
   * @param {string} name service名称
   * @param {string} action 待执行动作: start/stop/restart/enable/disable
   * @return {promise}
   */
  manageService (name, action) {
    const cmd = `/etc/init.d/${name} ${action}`
    return this.execute(cmd)
  }

  async getIP (inf) {
    const cmd = `ifconfig ${inf} | grep 'inet addr'`
    const output = await this.execute(cmd)
    const reg = /^inet addr:(\d+.\d+.\d+.\d+)/
    const match = reg.exec(output.trim())
    return (match && match[1]) || ''
  }
  getMacAddress (inf = 'eth1') {
    const cmd = `cat /sys/class/net/${inf}/address`
    return this.execute(cmd)
  }
  getLan () {
    const cmd = 'ifconfig br-lan | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.execute(cmd)
  }
  getWan () {
    const cmd = 'ifconfig eth1 | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.execute(cmd)
  }
  getOpenwrtVersion () {
    const cmd = 'cat /etc/openwrt_version'
    return this.execute(cmd)
  }
  changeTZ (name) {
    const subCmds = []
    subCmds.push(`uci set system.@system[0].hostname='${name}'`)
    subCmds.push("uci set system.@system[0].timezone='HKT-8'")
    subCmds.push("uci set system.@system[0].zonename='Asia/Hong Kong'")
    subCmds.push('uci commit system')
    return this.execute(subCmds.join(' && '))
  }
  turnOnFastOpen () {
    const cmd = 'echo "net.ipv4.tcp_fastopen = 3" >> /etc/sysctl.conf && sysctl -p /etc/sysctl.conf'
    return this.execute(cmd)
  }

  changePwd (username = 'root', password = 'root') {
    const cmd = `"echo -e '${password}\\n${password}' | (passwd ${username})"`
    return this.execute(cmd)
  }

  installCronJob (content) {
    const cmd = `echo "${content}" > /tmp/vroutercron && crontab /tmp/vroutercron && rm /tmp/vroutercron`
    return this.execute(cmd)
  }

  async scp (src, dest) {
    if (!this.conn) {
      await this.connect()
    }
    let isDestDir = false
    if (dest.endsWith('/')) {
      isDestDir = true
      await this.execute(`mkdir -p ${dest}`)
    } else {
      await this.execute(`mkdir -p ${path.dirname(dest)}`)
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
        this.conn.sftp((err, sftp) => {
          err && reject(err)
          sftp.fastPut(s, d, (err) => {
            sftp.end()
            err ? reject(err) : resolve()
          })
        })
      })
      promises.push(p)
    }
    return Promise.all(promises)
  }

  // dnsmasq
  configDnsmasq () {
    const cmd = "mkdir /etc/dnsmasq.d && echo 'conf-dir=/etc/dnsmasq.d/' > /etc/dnsmasq.conf"
    return this.execute(cmd)
  }

  // shadowsocks
  async installSs (targzFPath) {
    const src = targzFPath
    const dst = '/tmp/shadowsocks/shadowsocks.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && ls ${dstDir}/*.ipk | xargs opkg install && rm -rf /tmp/shadowsocks && cp /usr/bin/ss-redir /usr/bin/ss-redir-udp`
    return this.execute(cmd)
  }
  getSsVersion (type = 'shadowsocks', proxiesInfo) {
    const cmd = `${proxiesInfo[type].binName} -h | grep "shadowsocks-libev" | cut -d" " -f2`
    return this.execute(cmd)
  }
  async isSsRunning (proxies, proxiesInfo) {
    const type = /ssr/ig.test(proxies) ? 'shadowsocksr' : 'shadowsocks'
    const cmd = `ps -w | grep "${proxiesInfo[type].binName} -[c] .*${proxiesInfo[type].cfgName}"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // shadowsocksr
  async installSsr (targzFPath) {
    const src = targzFPath
    const dst = '/tmp/shadowsocksr/shadowsocksr.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && mv ${dstDir}/ssr-* /usr/bin/ && chmod +x /usr/bin/ssr-* && rm -rf /tmp/shadowsocksr && cp /usr/bin/ssr-redir /usr/bin/ssr-redir-udp`
    return this.execute(cmd)
  }

  async isTunnelDnsRunning (proxies, proxiesInfo) {
    const type = /ssr/ig.test(proxies) ? 'shadowsocksr' : 'shadowsocks'
    const cmd = `ps -w| grep "${proxiesInfo.tunnelDns.binName[type]} -[c] .*${proxiesInfo.tunnelDns.cfgName}"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // kcptun
  async installKt (targzFPath) {
    const src = targzFPath
    const dst = '/tmp/kcptun/kcptun.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && mv ${dstDir}/kcptun /usr/bin/ && chmod +x /usr/bin/kcptun && rm -rf /tmp/kcptun`
    return this.execute(cmd)
  }
  getKtVersion (proxiesInfo) {
    const cmd = `${proxiesInfo.kcptun.binName} --version | cut -d" " -f3`
    return this.execute(cmd)
  }
  async isKtRunning (proxiesInfo) {
    const cmd = `ps | grep "${proxiesInfo.kcptun.binName} -[c]"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  /*
   * @param {object} targzFPaths: {shadowsocks: '', shadowsocksr: '', kcptun: ''}
   */
  async installProxies (targzFPaths) {
    await this.installSs(targzFPaths.shadowsocks)
    await this.installSsr(targzFPaths.shadowsocksr)
    await this.installKt(targzFPaths.kcptun)
  }

  async scpProxiesCfgs (profile, proxiesInfo, remoteCfgDirPath) {
    logger.debug(`active profile: ${profile.name}`)
    const cfgFiles = await Generator.genProxiesCfgs(profile, proxiesInfo)
    logger.debug(`Generate cfg files: ${cfgFiles}`)
    for (let i = 0; i < cfgFiles.length; i++) {
      const src = cfgFiles[i]
      const cfgName = path.basename(src)
      const dst = `${remoteCfgDirPath}/${cfgName}`
      await this.scp(src, dst)
    }
  }
  async scpProxiesServices (profile, proxiesInfo, remoteCfgDirPath, scpAllService) {
    const cfgFiles = await Generator.genServicesFiles(profile, proxiesInfo, remoteCfgDirPath, scpAllService)
    logger.debug(`Generate services files: ${cfgFiles}`)
    for (let i = 0; i < cfgFiles.length; i++) {
      const src = cfgFiles[i]
      const cfgName = path.basename(src)
      const dst = `/etc/init.d/${cfgName}`
      await this.scp(src, dst)
      await this.execute(`chmod +x ${dst}`)
      logger.debug(`scp service file to: ${dst}`)
    }
  }
  async toggleSpecialService (proxy, proxies, proxiesInfo, tunnelDnsAction) {
    // tunnelDns 和 relayUDP 是两种特殊的情况.
    // 如果action是off, 那么要将/etc/init.d/tunnelDns, /etc/init.d/tunnelDnsR都关闭
    // 如果action是on, 那么打开一个的同时要关闭另一个.
    const serviceName = proxiesInfo[proxy].serviceName.shadowsocks
    const servicePath = `/etc/init.d/${serviceName}`
    const serviceStop = `${servicePath} disable; ${servicePath} stop;`
    const serviceStart = `chmod +x ${servicePath} && ${servicePath} enable; ${servicePath} start;`

    const serviceNameR = proxiesInfo[proxy].serviceName.shadowsocksr
    const servicePathR = `/etc/init.d/${serviceNameR}`
    const serviceStopR = `${servicePathR} disable; ${servicePathR} stop;`
    const serviceStartR = `chmod +x ${servicePathR} && ${servicePathR} enable; ${servicePathR} start;`

    if (tunnelDnsAction === 'off') {
      let cmd = `${serviceStop}${serviceStopR}`
      return this.execute(cmd)
    }

    if (/ssr/ig.test(proxies)) {
      let cmd = `${serviceStop}${serviceStartR}`
      return this.execute(cmd)
    } else {
      let cmd = `${serviceStopR}${serviceStart}`
      return this.execute(cmd)
    }
  }
  async toggleProxyService (proxy, proxies, proxiesInfo, action) {
    let serviceName = proxiesInfo[proxy].serviceName
    const servicePath = `/etc/init.d/${serviceName}`
    logger.info(`${servicePath} ${action}`)

    // ${servicePath} enable 执行的结果是1, 而不是常规的0
    const startCmd = `chmod +x ${servicePath} && ${servicePath} enable; ${servicePath} start`
    const stopCmd = `${servicePath} disable; ${servicePath} stop`
    if (action === 'off') {
      return this.execute(stopCmd)
    }
    return this.execute(startCmd)
  }
  async startProxiesServices (profile, proxiesInfo) {
    const proxies = profile.proxies
    const tunnelDnsAction = profile.enableTunnelDns ? 'on' : 'off'
    const relayUDPAction = profile.enableRelayUDP ? 'on' : 'off'
    const ktAction = /kt/ig.test(proxies) ? 'on' : 'off'
    // const ssAction = /^(ss|ssKt)$/ig.test(proxies) ? 'on' : 'off'
    // const ssrAction = /ssr/ig.test(proxies) ? 'on' : 'off'
    await this.toggleSpecialService('tunnelDns', proxies, proxiesInfo, tunnelDnsAction)
    await this.toggleSpecialService('relayUDP', proxies, proxiesInfo, relayUDPAction)
    await this.toggleProxyService('kcptun', proxies, proxiesInfo, ktAction)

    // because ss/ssr listen at same port(1010)
    // make sure stop another service first. otherwise the second one can not be started
    if (/ssr/ig.test(proxies)) {
      // ssr profile
      await this.toggleProxyService('shadowsocks', proxies, proxiesInfo, 'off')
      await this.toggleProxyService('shadowsocksr', proxies, proxiesInfo, 'on')
    } else {
      // ss profile
      await this.toggleProxyService('shadowsocksr', proxies, proxiesInfo, 'off')
      await this.toggleProxyService('shadowsocks', proxies, proxiesInfo, 'on')
    }
  }
  async configProxiesWatchdog (profile, proxiesInfo, remoteCfgDirPath) {
    const src = await Generator.genWatchdogFile(profile, proxiesInfo)
    const fname = path.basename(src)
    const dst = `${remoteCfgDirPath}/${fname}`
    await this.scp(src, dst)
    await this.execute(`chmod +x ${dst}`)
    const cronContent = `* * * * * ${dst}`
    await this.installCronJob(cronContent)
  }
  async setupProxies (profile, proxiesInfo, remoteCfgDirPath) {
    await this.scpProxiesCfgs(profile, proxiesInfo, remoteCfgDirPath)
    logger.debug('拷贝代理配置文件到虚拟机, 完成')
    await this.scpProxiesServices(profile, proxiesInfo, remoteCfgDirPath)
    logger.debug('拷贝代理管理脚本到虚拟机, 完成')
    await this.startProxiesServices(profile, proxiesInfo)
    logger.debug('启动关闭相应代理, 完成')
    await this.configProxiesWatchdog(profile, proxiesInfo, remoteCfgDirPath)
    logger.debug('拷贝代理监护脚本到虚拟机, 完成')
  }
  async scpIPsetFile (profile, proxiesInfo, firewallInfo, remoteCfgDirPath) {
    // const dirPath = path.join(__dirname, '..', 'config')
    const dirPath = path.join(__static, 'config-templates')

    const src = await Generator.genIpsetFile(profile, proxiesInfo, firewallInfo, dirPath)
    const dst = `${remoteCfgDirPath}/${firewallInfo.ipsetFname}`
    await this.scp(src, dst)
  }

  // must scpIPsetFile first. otherwise will occur errors: ipset xxx not exist
  async configIptables (profile, proxiesInfo, firewallInfo, remoteCfgDirPath) {
    const src = await Generator.genIptablesFile(profile, proxiesInfo, firewallInfo, remoteCfgDirPath)
    const fname = path.basename(src)
    const dst = `/etc/${fname}`
    await this.scp(src, dst)
    await this.manageService('firewall', 'restart')
  }
  async setupFirewall (profile, proxiesInfo, firewallInfo, remoteCfgDirPath) {
    await this.scpIPsetFile(profile, proxiesInfo, firewallInfo, remoteCfgDirPath)
    await this.configIptables(profile, proxiesInfo, firewallInfo, remoteCfgDirPath)
  }
  async setupDnsmasq (profile, proxiesInfo, firewallInfo, remoteCfgDirPath) {
    // const dirPath = path.join(__dirname, '..', 'config')
    const dirPath = path.join(__static, 'config-templates')
    const src = await Generator.genDnsmasqCfgFile(profile, proxiesInfo, firewallInfo, dirPath)
    const dst = `${remoteCfgDirPath}/${firewallInfo.dnsmasqCustomCfgFname}`
    await this.scp(src, dst)

    await this.manageService('dnsmasq', 'restart')
  }
  async applyProfile (profile, proxiesInfo, firewallInfo, remoteCfgDirPath, dnsmasqCfgDir) {
    await this.setupProxies(profile, proxiesInfo, remoteCfgDirPath)
    logger.debug('设置代理, 完成')
    await this.setupFirewall(profile, proxiesInfo, firewallInfo, remoteCfgDirPath)
    logger.debug('设置防火墙, 完成')
    await this.setupDnsmasq(profile, proxiesInfo, firewallInfo, dnsmasqCfgDir)
    logger.debug('设置dnsmasq, 完成')
  }
}

export default Openwrt
