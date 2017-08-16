const { exec } = require('child_process')
const os = require('os')

let bin = null
;(function () {
  switch (os.platform()) {
    case 'darwin':
      bin = '/usr/local/bin/VBoxManage'
      break
    default:
      bin = 'VBoxManage'
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
      await this.getVersion()
      return true
    } catch (error) {
      return false
    }
  }
  static async start (name, type = 'headless') {
    const cmd = `${bin} startvm --type ${type} ${name}`
    await execute(cmd)
    await wait(1000)
    // mock 'press enter key' to skip grub waiting time
    await this.sendKeystrokesTo(name)
    await wait(500)
    await this.sendKeystrokesTo(name)
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
  static toggleVisible (name, action = true) {
    const cmd = `${bin} setextradata ${name} GUI/HideFromManager ${action}`
    return execute(cmd)
  }
  static toggleGUIConfig (name, action = true) {
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
    const vmInfo = await this.getVmInfo(name)
    const statePattern = /^VMState="(.*)"$/mg
    return statePattern.exec(vmInfo)[1]
  }
  static async isVmRunning (name) {
    const state = await this.getVmState(name)
    return state === 'running'
  }
  static toggleSerialPort (name, portNum = 1, action = 'on', file) {
    // const serialPath = path.join(this.config.host.configDir, this.config.host.serialFile)
    const subCmd = action === 'on' ? `"0x3F8" "4" --uartmode${portNum} server "${file}"` : 'off'
    const cmd = `${bin} modifyvm ${name} --uart${portNum} ${subCmd}`
    return execute(cmd)
  }
  static async isSerialPortOn (name, portNum = 1) {
    // VBoxManage showvminfo com.icymind.test --machinereadable  | grep "uart\(mode\)\?1"
    // uart1="0x03f8,4"
    // uartmode1="server,/Users/simon/Library/Application Support/VRouter/serial"
    const vmInfo = await this.getVmInfo(name)
    const pattern = new RegExp(String.raw`^uart${portNum}="0x03f8,4"$`)
    return pattern.exec(vmInfo) !== undefined
  }
}

module.exports = {
  VBox
}
