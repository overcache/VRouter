const { exec } = require('child_process')
const os = require('os')
const fs = require('fs-extra')
const path = require('path')

let bin = (function () {
  switch (os.platform()) {
    case 'darwin':
      return '/usr/local/bin/VBoxManage'
    case 'win32':
      const vbInstallPath = process.env.VBOX_INSTALL_PATH || process.env.VBOX_MSI_INSTALL_PATH
      return `"${path.join(vbInstallPath, 'VBoxManage.exe')}"`
    default:
      return 'VBoxManage'
  }
})()

const wait = function (time) {
  return new Promise(resolve => setTimeout(resolve, time))
}
const execute = function (command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve(stdout || stderr)
      }
    })
  })
}

class VBox {
  static sendKeystrokesTo (name, key = '1c 9c') {
    const cmd = `${bin} controlvm ${name} keyboardputscancode ${key}`
    return execute(cmd)
  }
  static getVersion () {
    const cmd = `${bin} --version`
    return execute(cmd)
  }
  static async isVBInstalled () {
    try {
      await VBox.getVersion()
      return true
    } catch (error) {
      return false
    }
  }
  static async convertImg (img, out) {
    await fs.ensureDir(path.dirname(out))
    const cmd = `${bin} convertfromraw "${img}" "${out}" --format VDI`
    return execute(cmd)
  }
  static create (name) {
    const cmd = `${bin} createvm --name ${name} --register`
    return execute(cmd)
  }
  static listvms () {
    const cmd = `${bin} list vms`
    return execute(cmd)
  }
  static modify (name, args) {
    const cmd = `${bin} modifyvm ${name} ${args}`
    return execute(cmd)
  }
  static storagectl (name, args) {
    const cmd = `${bin} storagectl ${name} ${args}`
    return execute(cmd)
  }
  static storageattach (name, args) {
    const cmd = `${bin} storageattach ${name} ${args}`
    return execute(cmd)
  }
  static async start (name, type = 'headless') {
    const cmd = `${bin} startvm --type ${type} ${name}`
    await execute(cmd)
  }
  static attachHeadless (name) {
    const cmd = `${bin} startvm ${name} --type separate`
    return execute(cmd)
  }
  static saveState (name) {
    const cmd = `${bin} controlvm ${name} savestate`
    return execute(cmd)
  }
  static discardState (name) {
    const cmd = `${bin} discardstate ${name}`
    return execute(cmd)
  }
  static powerOff (name) {
    const cmd = `${bin} controlvm ${name} poweroff`
    return execute(cmd)
  }
  static async delete (name) {
    const isExisted = await VBox.isVmExisted(name)
    const isRunning = isExisted ? await VBox.isVmRunning(name) : false
    if (isExisted && isRunning) {
      await VBox.powerOff(name)
      await wait(5000)
    }
    const cmd = `${bin} unregistervm ${name} --delete`
    return isExisted ? execute(cmd) : null
  }
  static hide (name, action = true) {
    const cmd = `${bin} setextradata ${name} GUI/HideFromManager ${action}`
    return execute(cmd)
  }
  static lockGUIConfig (name, action = true) {
    const cmd = `${bin} setextradata ${name} GUI/PreventReconfiguration ${action}`
    return execute(cmd)
  }
  static async isVmExisted (name) {
    const cmd = `${bin} showvminfo ${name}`
    try {
      await execute(cmd)
      return true
    } catch (error) {
      return false
    }
  }
  static getVmInfo (name) {
    const cmd = `${bin} showvminfo ${name} --machinereadable`
    return execute(cmd)
  }
  static async getVmState (name) {
    const vmInfo = await VBox.getVmInfo(name)
    const statePattern = /^VMState="(.*)"$/mg
    return statePattern.exec(vmInfo)[1]
  }
  static async isVmRunning (name) {
    const state = await VBox.getVmState(name)
    return state === 'running'
  }
  static toggleSerialPort (name, file, action = 'on', portNum = '1') {
    // const serialPath = path.join(VBox.config.host.configDir, VBox.config.host.serialFile)
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${portNum} server "${file}"` : 'off'
    const cmd = `${bin} modifyvm ${name} --uart${portNum} ${subCmd}`
    return execute(cmd)
  }
  static async isSerialPortOn (name, portNum = 1) {
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep "uart\(mode\)\?1"
    // uart1="0x03f8,4"
    // uartmode1="server,/Users/simon/Library/Application Support/VRouter/serial"
    const vmInfo = await VBox.getVmInfo(name)
    const pattern = new RegExp(String.raw`^uart${portNum}="0x03f8,4"$`, 'mg')
    return pattern.exec(vmInfo) !== undefined
  }

  // network
  static async createHostonlyInf () {
    const cmd = `${bin} hostonlyif create`
    const output = await execute(cmd)
    const pattern = /^Interface '(.*)' was successfully created$/mg
    return pattern.exec(output)[1]
  }
  static removeHostonlyInf (inf) {
    const cmd = `${bin} hostonlyif remove ${inf}`
    return execute(cmd)
  }
  static initHostonlyNetwork (name, inf, nic = '1') {
    const cmd = `${bin} modifyvm ${name} ` +
      ` --nic${nic} hostonly ` +
      ` --nictype${nic} "82540EM" ` +
      ` --hostonlyadapter${nic} "${inf}" ` +
      ` --cableconnected${nic} "on"`
    return execute(cmd)
  }

  /*
   * @param {string} name 虚拟机名称
   * @param {string} bridgeService 桥接的网络, 如"en0: Wi-Fi (AirPort)"
   * @nic {string} nic 虚拟机网卡序号
   */
  static initBridgeNetwork (name, bridgeService, nic = '2') {
    const cmd = `${bin} modifyvm ${name} ` +
      `--nic${nic} bridged ` +
      ` --nictype${nic} "82540EM" ` +
      `--bridgeadapter${nic} "${bridgeService}" ` +
      `--cableconnected${nic} "on"`
    return execute(cmd)
  }

  /*
   * 可在虚拟机开机状态下, 更改指定的网卡, 使其桥接到指定的网络上
   * @param {string} name 虚拟机名称
   * @param {string} bridgedInf 桥接的网络, 如"en0: Wi-Fi (AirPort)"
   * @nic {string} nic 虚拟机网卡序号
   * @return undefined
   */
  static amendBridgeNetwork (name, bridgeService, nic = '2') {
    const cmd = `${bin} controlvm ${name} nic${nic} bridged "${bridgeService}"`
    return execute(cmd)
  }

  /*
   * 获取虚拟机指定网卡桥接到的宿主网络
   * @param {string} name 虚拟机名称
   * @param {string} nic  虚拟机网卡的序号
   * @return {string} 桥接的宿主网络, 如"en0: Wi-Fi (AirPort)"
   */
  static async getAssignedBridgeService (name, nic = '2') {
    const vmInfo = await VBox.getVmInfo(name)
    const pattern = new RegExp(String.raw`^bridgeadapter${nic}=(.*)$`, 'mg')
    return pattern.exec(vmInfo)[1].replace(/["']/ig, '')
  }

  /*
   * 获取ip值等于参数值的hostonly设备, 如果没有对应的设备, 则新建一个.
   * @param {string} network 网段, 如 '10.19.28.37/24'
   * @return {string} hostonly接口, 如vboxnet3
   */
  static async getAvailableHostonlyInf (ip, mask) {
    const cmd = `${bin} list hostonlyifs`
    const output = await execute(cmd)
    const infPattern = /^Name:\s*(.*)\n[\s\S]*?IPAddress:\s*(.*)\nNetworkMask:\s*(.*)\n/mg
    let infMatch = infPattern.exec(output)
    while (infMatch) {
      let name = infMatch[1]
      let ipMatch = infMatch[2]
      let maskMatch = infMatch[3]
      if (ip === ipMatch && mask === maskMatch) {
        return name
      }
      infMatch = infPattern.exec(output)
    }
    const newInf = await VBox.createHostonlyInf()
    await VBox.ipconfigHostonlyInf(newInf, ip, mask)
    return newInf
  }

  /*
   * @return {array} bridgedInfs 返回所有可供桥接的宿主网络名称
   */
  static async getAllBridgeServices () {
    const bridgeServices = []
    const cmd = `${bin} list bridgedifs`
    const output = await execute(cmd)
    const pattern = /^Name:\s*(.*)$/mg
    let name = pattern.exec(output)
    while (name) {
      bridgeServices.push(name[1])
      name = pattern.exec(output)
    }
    return bridgeServices
  }

  static async getBridgeService (inf) {
    const bridgeServices = await VBox.getAllBridgeServices()
    const filter = bridgeServices.filter((service) => {
      return inf === service.split(':')[0]
    })
    return filter[0]
  }

  /*
   * 配置对应的hostonly接口
   * @param {string} inf 接口名称
   * @param {string} ip 配置的IP地址
   * @param {sring} netmask 子网掩码
   * @return undefined
   */
  static async ipconfigHostonlyInf (inf, ip, netmask = '255.255.255.0') {
    const cmd = `${bin} hostonlyif ipconfig "${inf}" --ip ${ip} --netmask ${netmask}`
    return execute(cmd)
  }
}

export default VBox
