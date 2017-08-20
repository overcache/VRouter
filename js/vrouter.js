const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const { VBox } = require('./vbox.js')
const { Openwrt } = require('./openwrt.js')
const { Utils } = require('./utils.js')

/*
 * @param {object} options: {vmName, hostonlyInfIP}
 */
async function initInterface (options) {
  const hostonlyInf = await VBox.getAvailableHostonlyInf(options.hostonlyInfIP, '255.255.255.0')
  await VBox.initHostonlyNetwork(options.vmName, hostonlyInf, '1')
  const activeAdapter = await Utils.getActiveAdapter()
  const bridgeService = await VBox.getBridgeService(activeAdapter)
  await VBox.initBridgeNetwork(options.vmName, bridgeService, '2')
}

/*
 * @param {object} options: {imageUrl, imageSha256, dstDir}
 */
async function getImageZipfile (options) {
  let file = path.join(options.dstDir, path.basename(options.imageUrl))
  const hashValue = await Utils.hashFile(file)
  if (hashValue !== options.imageSha256) {
    file = await Utils.downloadFile(options.imageUrl)
  }
  return file
}

/*
 * @param {object} options: {imageUrl, imageSha256, dstDir, vdiName}
 */
async function getVDI (options) {
  const vdi = path.join(options.dstDir, options.vdiName)
  await fs.remove(vdi).catch()

  const zipfile = await getImageZipfile({
    imageUrl: options.imageUrl,
    imageSha256: options.imageSha256,
    dstDir: options.dstDir
  })
  const img = await Utils.gunzip(zipfile, path.join(os.tmpdir(), 'openwrt.img'))
  await VBox.convertImg(img, vdi)
  return vdi
}

/*
 * @param {object} options: {vmName, imageUrl, imageSha256, dstDir, vdiName}
 */
async function create (options) {
  await VBox.create(options.vmName)

  let args = ` --ostype "Linux26_64" --memory "256" --cpus "1" ` +
    ` --boot1 "disk" --boot2 "none" --boot3 "none" --boot4 "none" ` +
    ` --audio "none" --vram "16"`
  await VBox.modify(options.vmName, args)

  args = `--name "SATA Controller" --add "sata" --portcount "4" ` +
    `--hostiocache "on" --bootable "on"`
  await VBox.storagectl(options.vmName, args)

  const vdi = await getVDI({
    imageUrl: options.imageUrl,
    imageSha256: options.imageSha256,
    dstDir: options.dstDir,
    vdiName: options.vdiName
  })
  args = ` --storagectl "SATA Controller" --port "1" ` +
    `--type "hdd" --nonrotational "on" --medium "${vdi}"`
  await VBox.storageattach(options.vmName, args)
}

/*
 * @param {object} options: {serialFile, username, passwd}
 */
function changePwd (options) {
  const cmd = `echo -e '${options.passwd}\\n${options.passwd}' | (passwd ${options.username})`
  return Utils.serialExec(options.serialFile, cmd)
}

function installPackage (serialFile) {
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
  return Utils.serialExec(serialFile, cmd)
}

/*
 * 通过串口配置lan地址
 * @param {object} options: {serialFile, guestIP}
 */
function configLan (options) {
  const subCmds = []
  subCmds.push(`uci set network.lan.ipaddr='${options.guestIP}'`)
  subCmds.push('uci commit network')
  subCmds.push('/etc/init.d/network restart')
  const cmd = subCmds.join(' && ')
  return Utils.serialExec(options.serialFile, cmd)
}

/*
 * @param {object} options: {vmName, serialFile, hostIP, guestIP, process}
 */
async function init (options) {
  await VBox.lockGUIConfig(options.vmName, true)
  await VBox.hide(options.vmName, true)
  await VBox.toggleSerialPort(options.vmName, options.serialFile, 'on', '1')
  await initInterface({
    vmName: options.vmName,
    hostonlyInfIP: options.hostIP
  })

  options.process.emit('init', '等待虚拟机启动, 请稍候30秒')
  await VBox.start(options.vmName)
  await Utils.wait(30000)

  options.process.emit('init', '配置虚拟机网络地址, 请稍候15秒')
  await configLan({
    serialFile: options.serialFile,
    guestIP: options.guestIP
  })
  await Utils.wait(15000)

  options.process.emit('init', '修改虚拟机密码')
  await changePwd({
    serialFile: options.serialFile,
    username: 'root',
    passwd: 'root'
  })
}

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

  async build (process) {
    // @param {object} options: {vmName, imageUrl, imageSha256, dstDir, vdiName}
    await create({
      vmName: this.name,
      imageUrl: this.config.vrouter.imageUrl,
      imageSha256: this.config.vrouter.imageSha256,
      dstDir: this.cfgDir,
      vdiName: 'vrouter.vdi'
    })

   // @param {object} options: {vmName, serialFile, hostIP, guestIP, process}
    await init({
      vmName: this.name,
      serialFile: path.join(this.cfgDir, this.config.host.serialFile),
      hostIP: this.config.host.ip,
      guestIP: this.ip,
      process: process
    })

    process.emit('init', '配置Dnsmasq')
    await this.configDnsmasq()

    process.emit('init', '修改虚拟机时区')
    await this.changeTZ()

    process.emit('init', '打开tcp fast open')
    await this.turnOnFastOpen()

    await this.manageService('cron', 'enable')

    process.emit('init', '更新软件源并安装必要软件包, 请稍候20-60秒')
    await installPackage(path.join(this.cfgDir, this.config.host.serialFile))
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
  async applyProfile (profile) {
  }
}
module.exports = {
  VRouter
}
