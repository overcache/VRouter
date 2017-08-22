const path = require('path')
const { exec } = require('child_process')
const sudo = require('sudo-prompt')

function execute (command) {
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
function sudoExec (cmd, options = {}) {
  return new Promise((resolve, reject) => {
    sudo.exec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        reject(err)
      } else {
        resolve(stdout || stderr)
      }
    })
  })
}

class Mac {
  static async getActiveAdapter () {
    let cmd = String.raw`cat <<EOF | scutil
    open
    get State:/Network/Global/IPv4
    d.show
    EOF`
    const output = await execute(cmd)

    const pattern = /PrimaryInterface : (.*)$/mg
    return pattern.exec(output)[1]
  }
  static async getRouterIP () {
    let cmd = String.raw`cat <<EOF | scutil
    open
    get State:/Network/Global/IPv4
    d.show
    EOF`
    const output = await execute(cmd)

    const pattern = /Router : (.*)$/mg
    return pattern.exec(output)[1]
  }

  static async getOSXNetworkService (inf) {
    // 返回 en{0-9} 对应的网络服务
    const cmd = `/usr/sbin/networksetup -listnetworkserviceorder`
    const output = await execute(cmd)
    const raw = String.raw`\(\d+\)\s*(.*)\n\(Hardware Port: .*?, Device:\s*${inf}\)`
    const pattern = new RegExp(raw, 'g')
    return pattern.exec(output)[1]
  }

  static async getCurrentGateway () {
    const cmd = "/sbin/route -n get default | grep gateway | awk '{print $2}'"
    return execute(cmd)
  }
  static async getCurrentDns () {
    const activeAdapter = await Mac.getActiveAdapter()
    const networkServiceName = await Mac.getOSXNetworkService(activeAdapter)
    const cmd = `/usr/sbin/networksetup -getdnsservers "${networkServiceName}"`
    return execute(cmd)
  }

  static async changeRouteTo (ip) {
    await Mac.changeGateway(ip)
    await Mac.changeDns(ip)
  }
  static async resetRoute () {
    const routerIP = await Mac.getRouterIP()
    await Mac.changeGateway(routerIP)
    await Mac.changeDns(routerIP)
  }
  static async changeGateway (ip) {
    const cmd = `/sbin/route change default ${ip}`
    await sudoExec(cmd)
  }
  static async changeDns (ip) {
    const activeAdapter = await Mac.getActiveAdapter()
    const networkServiceName = await Mac.getOSXNetworkService(activeAdapter)
    const cmd = `/usr/sbin/networksetup -setdnsservers "${networkServiceName}" "${ip}"`
    await sudoExec(cmd)
  }

  static async installNwWatchdog () {
    await this.generateNetworkSh()
    await this.localExec(`chmod +x "${path.join(this.config.host.configDir, this.config.host.networkSh)}"`)
    await this.generateNetworkPlist()
    await sudoExec(`cp "${path.join(this.config.host.configDir, this.config.host.networkPlist)}" /Library/LaunchDaemons`)
    await sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await sudoExec(`launchctl bootstrap system /Library/LaunchDaemons/${this.config.host.networkPlist}`)
  }

  static async removeNwWatchdog () {
    await sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await sudoExec(`rm /Library/LaunchDaemons/${this.config.host.networkPlist}`).catch(e => {})
    await sudoExec(`rm "${path.join(this.config.host.configDir, path.basename(this.config.host.networkSh, '.sh') + '.log')}"`).catch(e => {})
  }
}

module.exports = {
  Mac
}
