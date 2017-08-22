const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const { VBox } = require('./vbox.js')
const { Openwrt } = require('./openwrt.js')
const { Utils } = require('./utils.js')
const winston = require('winston')
winston.level = 'debug'

/*
 * @param {object} options: {vmName, hostonlyInfIP, hostonlyINC, bridgeINC}
 */
async function initInterface (options) {
  const hostonlyInf = await VBox.getAvailableHostonlyInf(options.hostonlyInfIP, '255.255.255.0')
  winston.info('hostonlyInf', hostonlyInf)
  await VBox.initHostonlyNetwork(options.vmName, hostonlyInf, options.hostonlyINC)
  const activeAdapter = await Utils.getActiveAdapter()
  winston.info('activeAdapter', activeAdapter)
  const bridgeService = await VBox.getBridgeService(activeAdapter)
  winston.info('bridgeService', bridgeService)
  await VBox.initBridgeNetwork(options.vmName, bridgeService, options.bridgeINC)
}

/*
 * @param {object} options: {imageUrl, imageSha256}
 * @param {string} dstDirPath: 目标文件夹, 用于保存镜像压缩包和vdi文件
 */
async function getImageZipfile (options, dstDirPath) {
  let file = path.join(os.tmpdir(), path.basename(options.imageUrl))
  const hashValue = await Utils.hashFile(file)
  if (hashValue !== options.imageSha256) {
    file = await Utils.downloadFile(options.imageUrl)
  }
  return file
}

/*
 * @param {object} options: {vmName, imageUrl, imageSha256}
 * @param {string} dstDirPath: 目标文件夹, 用于保存镜像压缩包和vdi文件
 */
async function getVDI (options, dstDirPath) {
  const vdi = path.join(dstDirPath, options.vmName + '.vdi')
  await fs.remove(vdi).catch()

  const zipfile = await getImageZipfile({
    imageUrl: options.imageUrl,
    imageSha256: options.imageSha256
  }, dstDirPath)
  const img = await Utils.gunzip(zipfile, path.join(os.tmpdir(), 'temp.img'))
  await VBox.convertImg(img, vdi)
  return vdi
}

/*
 * @param {object} options: {vmName, imageUrl, imageSha256}
 * @param {string} dstDirPath: 目标文件夹, 用于保存镜像压缩包和vdi文件
 */
async function create (options, dstDirPath) {
  await VBox.create(options.vmName)

  let args = ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
    ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
    ` --audio "none" --vram "16"`
  await VBox.modify(options.vmName, args)

  args = `--name "SATA Controller" --add "sata" --portcount "4" ` +
    `--hostiocache "on" --bootable "on"`
  await VBox.storagectl(options.vmName, args)

  const vdi = await getVDI({
    vmName: options.vmName,
    imageUrl: options.imageUrl,
    imageSha256: options.imageSha256
  }, dstDirPath)
  args = ` --storagectl "SATA Controller" --port "1" ` +
    `--type "hdd" --nonrotational "on" --medium "${vdi}"`
  await VBox.storageattach(options.vmName, args)
}

/*
 * @param {object} options: {socketFPath, username, password}
 */
async function changePwd (options) {
  winston.debug('about to change vrouter password', options)
  const cmd = `echo -e '${options.password}\\n${options.password}' | (passwd ${options.username})`
  await Utils.serialExec(options.socketFPath, cmd)
}

function installPackage (socketFPath) {
  const subCmds = []
  subCmds.push(`sed -i 's/downloads.openwrt.org/mirrors.tuna.tsinghua.edu.cn\\/openwrt/g' /etc/opkg/distfeeds.conf`)
  subCmds.push('opkg update')
  subCmds.push('opkg remove dnsmasq && opkg install dnsmasq-full ipset openssh-sftp-server libopenssl rng-tools')
  subCmds.push('/etc/init.d/dropbear restart')
  subCmds.push('echo "done" > /tmp/log/vrouter')
  const cmd = subCmds.join(' && ')
  /*
   * 用ssh登录后执行的话, 有奇怪的错误发生. 改用serialExec
   * Error: the string "Collected errors:\n * resolve_conffiles: Existing conffile /etc/config/dhcp is different from the conffile in the new package. The new conffile will be placed at /etc/config/dhcp-opkg.\n * resolve_conffiles: Existing conffile /etc/dnsmasq.conf is different from the conffile in the new package. The new conffile will be placed at /etc/dnsmasq.conf-opkg." was thrown, throw an Error :)
   * return this.execute(subCmds.join(' && '))
   */

  // return this.serialExec(subCmds.join(' && '))
  return Utils.serialExec(socketFPath, cmd)
}

/*
 * 通过串口配置lan地址
 * @param {object} options: {socketFPath, IP}
 */
function configLan (options) {
  const subCmds = []
  subCmds.push(`uci set network.lan.ipaddr='${options.IP}'`)
  subCmds.push('uci commit network')
  subCmds.push('/etc/init.d/network restart')
  const cmd = subCmds.join(' && ')
  return Utils.serialExec(options.socketFPath, cmd)
}

/*
 * @param {object} options: {vmName, socketFPath, hostonlyInfIP, openwrtIP, process, username, password, hostonlyINC, bridgeINC, serailPort}
 */
async function init (options) {
  // await VBox.lockGUIConfig(options.vmName, true)
  // await VBox.hide(options.vmName, true)
  await VBox.toggleSerialPort(options.vmName, options.socketFPath, 'on', options.serialPort)
  await initInterface({
    vmName: options.vmName,
    hostonlyInfIP: options.hostonlyInfIP,
    hostonlyINC: options.hostonlyINC,
    bridgeINC: options.bridgeINC
  })

  options.process.emit('init', '等待虚拟机启动, 请稍候30秒')
  await VBox.start(options.vmName)
  await Utils.wait(30000)

  options.process.emit('init', '配置虚拟机网络地址, 请稍候15秒')
  await configLan({
    socketFPath: options.socketFPath,
    IP: options.openwrtIP
  })
  await Utils.wait(15000)

  options.process.emit('init', '修改虚拟机密码')
  await changePwd({
    socketFPath: options.socketFPath,
    username: options.username,
    password: options.password
  })
  await Utils.wait(8000)
}

class VRouter extends Openwrt {
  constructor (config) {
    super(config.openwrt)
    this.name = config.virtualbox.vmName
    this.cfgDirPath = path.join(Utils.getAppDir(), config.cfgDirName)
    this.config = config
  }

  async build (process) {
    await create({
      vmName: this.name,
      imageUrl: this.config.virtualbox.imageUrl,
      imageSha256: this.config.virtualbox.imageSha256
    }, this.cfgDirPath)

    await init({
      vmName: this.name,
      socketFPath: path.join(this.cfgDirPath, this.config.virtualbox.socketFname),
      hostonlyInfIP: this.config.virtualbox.hostonlyInfIP,
      openwrtIP: this.ip,
      process: process,
      username: this.config.openwrt.username,
      password: this.config.openwrt.password,
      hostonlyINC: this.config.virtualbox.hostonlyINC,
      bridgeINC: this.config.virtualbox.bridgeINC,
      serialPort: this.config.virtualbox.serialPort
    })

    process.emit('init', '配置Dnsmasq')
    await this.configDnsmasq()

    process.emit('init', '修改虚拟机时区')
    await this.changeTZ()

    process.emit('init', '打开tcp fast open')
    await this.turnOnFastOpen()

    await this.manageService('cron', 'enable')

    process.emit('init', '更新软件源并安装必要软件包, 请稍候20-60秒')
    await installPackage(path.join(this.cfgDirPath, this.config.virtualbox.socketFname))
    await Utils.wait(20000)

    const finished = await this.isInstallPackageFinish(4)
    if (!finished) {
      process.emit('init', '未能安装必要软件包')
      throw Error('未能安装必要软件包')
    }
    process.emit('init', '必要软件包安装完成')

    process.emit('init', '安装代理软件包')
    await this.installProxies({
      shadowsocks: path.join(__dirname, '..', 'third_party', 'shadowsocks.tar.gz'),
      shadowsocksr: path.join(__dirname, '..', 'third_party', 'shadowsocksr.tar.gz'),
      kcptun: path.join(__dirname, '..', 'third_party', 'kcptun.tar.gz')
    })

    process.emit('init', '拷贝代理的管理脚本到虚拟机')
    await this.scpProxiesServices(this.config.profiles[0], this.config.proxiesInfo, `/etc/${this.config.cfgDirName}`, true)
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

  saveCfg2File () {
    const cfgPath = path.join(this.cfgDir, 'config.json')
    return fs.writeJson(cfgPath, this.config, {spaces: 2})
  }
  async applyActivedProfile () {
    const activedProfile = this.config.profiles.filter(profile => profile.active === true)[0]
    const proxiesInfo = this.config.proxiesInfo
    const firewallInfo = this.config.firewallInfo
    const remoteCfgDirPath = path.join('/etc', this.config.cfgDirName)
    const dnsmasqCfgDir = '/etc/dnsmasq.d'
    await super.applyProfile(activedProfile, proxiesInfo, firewallInfo, remoteCfgDirPath, dnsmasqCfgDir)
  }
}
module.exports = {
  VRouter
}
