const path = require('path')
const fs = require('fs-extra')
const { VBox } = require('./vbox.js')
const { Openwrt } = require('./openwrt.js')
const { Utils } = require('./utils.js')

class VRouter extends Openwrt {
  constructor (config) {
    super({
      ip: config.vrouter.ip,
      port: config.vrouter.port,
      username: config.vrouter.username,
      passwd: config.vrouter.password
    })
    this.name = config.vrouter.name
    this.cfgDir = path.join(Utils.getAppDir(), require('../package.json').name)
    this.config = config
  }

  serialExec (command) {
    const serialFile = path.join(this.cfgDir, this.config.host.serialFile)
    return Utils.serialExec(serialFile, command)
  }

  async initInterface () {
    const hostonlyInf = await VBox.getAvailableHostonlyInf(this.config.host.ip, '255.255.255.0')
    await VBox.initHostonlyNetwork(this.name, hostonlyInf, '1')
    const activeAdapter = await Utils.getActiveAdapter()
    const bridgeService = await VBox.getBridgeService(activeAdapter)
    await VBox.initBridgeNetwork(this.name, bridgeService, '2')
  }

  /*
   * 通过串口配置lan地址
   */
  async configLan (ip) {
    const subCmds = []
    subCmds.push(`uci set network.lan.ipaddr='${ip}'`)
    subCmds.push('uci commit network')
    subCmds.push('/etc/init.d/network restart')
    const cmd = subCmds.join(' && ')
    await this.serialExec(cmd)
  }

  async getImageZipfile () {
    let file = path.join(this.cfgDir, path.basename(this.config.vrouter.imageUrl))
    const hashValue = await Utils.hashFile(file)
    if (hashValue !== this.config.vrouter.imageSha256) {
      file = await Utils.downloadFile(this.config.vrouter.imageUrl)
    }
    return file
  }

  async getVDI () {
    const vdi = path.join(this.cfgDir, 'vrouter.vdi')
    await fs.remove(vdi).catch()

    const zipfile = await this.getImageZipfile()
    const img = await Utils.gunzip(zipfile, path.join(this.cfgDir, 'openwrt.img'))
    await VBox.convertImg(img, vdi)
    return vdi
  }

  async create () {
    await VBox.create(this.name)

    let args = ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
      ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
      ` --audio "none" --vram "16"`
    await VBox.modify(this.name, args)

    args = `--name "SATA Controller" --add "sata" --portcount "4" ` +
      `--hostiocache "on" --bootable "on"`
    await VBox.storagectl(this.name, args)

    const vdi = await this.getVDI()
    args = ` --storagectl "SATA Controller" --port "1" ` +
      `--type "hdd" --nonrotational "on" --medium "${vdi}"`
    await VBox.storageattach(this.name, args)
  }

  async init (process) {
    const serialFile = path.join(this.cfgDir, this.config.host.serialFile)
    // await VBox.lockGUIConfig(this.name, true)
    // await VBox.hide(this.name, true)
    await VBox.toggleSerialPort(this.name, serialFile, 'on', '1')
    await this.initInterface()

    process.emit('init', '等待虚拟机启动, 请稍候30秒')
    await VBox.start(this.name)
    await Utils.wait(30000)

    process.emit('init', '配置虚拟机网络地址, 请稍候10秒')
    await this.configLan(this.ip)
    // await Utils.wait(3000)
    // await this.configLan(this.ip)
    await Utils.wait(10000)

    process.emit('init', '修改虚拟机密码')
    await this.changePwd('root', 'root')

    process.emit('init', '配置Dnsmasq')
    await this.configDnsmasq()

    process.emit('init', '修改虚拟机时区')
    await this.changeTZ()

    process.emit('init', '打开tcp fast open')
    await this.turnOnFastOpen()

    await this.manageService('cron', 'enable')

    process.emit('init', '更新软件源并安装必要软件包, 请稍候20-60秒')
    await this.installPackage()
    await Utils.wait(20000)

    const finished = await this.isInstallPackageFinish(4)
    if (!finished) {
      process.emit('init', '未能安装必要软件包')
      throw Error('未能安装必要软件包')
    }
    process.emit('init', '必要软件包安装完成')

    process.emit('init', '安装代理软件包')
    await this.installProxies()
  }

  changePwd (username = 'root', passwd = 'root') {
    const cmd = `echo -e '${passwd}\\n${passwd}' | (passwd ${username})`
    return this.serialExec(cmd)
  }
  async installPackage () {
    const subCmds = []
    subCmds.push(`sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\\/openwrt/g' /etc/opkg/distfeeds.conf`)
    subCmds.push('opkg update')
    subCmds.push('opkg remove dnsmasq && opkg install dnsmasq-full ipset openssh-sftp-server libopenssl rng-tools')
    subCmds.push('/etc/init.d/dropbear restart')
    subCmds.push('echo "done" > /tmp/log/vrouter')
    // 用ssh登录后执行的话, 有奇怪的错误发生. 改用serialExec
    return this.serialExec(subCmds.join(' && '))
  }
  async installProxies () {
    await this.installSs()
    await this.installSsr()
    await this.installKt()
  }
  async isInstallPackageFinish (maxRetry = 4) {
    for (let i = 0; i < maxRetry; i++) {
      const log = await this.execute('cat /tmp/log/vrouter')
      if (log.trim() === 'done') {
        return true
      }
      await Utils.wait(10000)
    }
    return false
  }

  // dnsmasq
  configDnsmasq () {
    const cmd = "mkdir /etc/dnsmasq.d && echo 'conf-dir=/etc/dnsmasq.d/' > /etc/dnsmasq.conf"
    return this.execute(cmd)
  }

  // shadowsocks
  async installSs () {
    const src = path.join(__dirname, '..', 'third_party', 'shadowsocks.tar.gz')
    const dst = '/tmp/shadowsocks/shadowsocks.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && ls ${dstDir}/*.ipk | xargs opkg install && rm -rf /tmp/shadowsocks`
    return this.execute(cmd)
  }
  getSsVersion (type = 'ss') {
    const cmd = `${type}-redir -h | grep "shadowsocks-libev" | cut -d" " -f2`
    return this.execute(cmd)
  }
  async isSsRunning (type = 'ss', plugin) {
    const fileName = !plugin ? `${type}-client.json` : `${type}-over-kt.json`
    const cmd = `ps -w | grep "${type}-redir -c .*${fileName}"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // shadowsocksr
  async installSsr () {
    const src = path.join(__dirname, '..', 'third_party', 'shadowsocksr.tar.gz')
    const dst = '/tmp/shadowsocksr/shadowsocksr.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && mv ${dstDir}/ssr-* /usr/bin/ && chmod +x /usr/bin/ssr-* && rm -rf /tmp/shadowsocksr`
    return this.execute(cmd)
  }

  async isTunnelDnsRunning (type = 'ss') {
    const cmd = `ps -w| grep "${type}-tunnel -c .*tunnel-dns.jso[n]"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // kcptun
  async installKt () {
    // const cmd = `tar -xvzf ${this.config.vrouter.configDir}/third_party/kcptun*.tar.gz ` +
      // ` && rm server_linux_* && mv client_linux* /usr/bin/kcptun`
    const src = path.join(__dirname, '..', 'third_party', 'kcptun.tar.gz')
    const dst = '/tmp/kcptun/kcptun.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && mv ${dstDir}/kcptun /usr/bin/ && chmod +x /usr/bin/kcptun && rm -rf /tmp/kcptun`
    return this.execute(cmd)
  }
  getKtVersion () {
    const cmd = 'kcptun --version | cut -d" " -f3'
    return this.execute(cmd)
  }
  async isKtRunning () {
    const cmd = 'ps | grep "[k]cptun -c"'
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  saveCfg2File () {
    const cfgPath = path.join(this.cfgDir, 'config.json')
    return fs.writeJson(cfgPath, this.config, {spaces: 2})
  }
}
module.exports = {
  VRouter
}
