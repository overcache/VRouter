const os = require('os')
const sudo = require('sudo-prompt')
const path = ''
const winston = ''

class MacOS {
  /*
   * @param {string} 待执行命令
   * @param {object} options 选项, 可包含name, icns属性
   */
  static sudoExec (cmd, options) {
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
  static changeRouteTo (dst = 'vrouter') {

  }
  sshLogin () {
    const applescript = String.raw`
      tell application "Terminal"
          do script ("ssh ${this.config.vrouter.username}@${this.config.vrouter.ip};")
          activate
          delay 3
          tell application "System Events" to keystroke "${this.config.vrouter.password}"
          tell application "System Events" to key code 36
      end tell
      `
    const cmd = `osascript -e '${applescript}'`
    return this.localExec(cmd)
  }
  async getOSXNetworkService (inf) {
    // 返回 en{0-9} 对应的网络服务
    const cmd = `/usr/sbin/networksetup -listnetworkserviceorder`
    const output = await this.localExec(cmd)
    const reg = /\(\d+\) (.*)\n\(Hardware Port: .*?, Device: (.*)\)/g
    while (true) {
      const match = reg.exec(output)
      if (!match) break
      if (match[2] === inf) {
        return match[1]
      }
    }
    throw Error(`can not find NetworkService match ${inf}`)
  }
  async getCurrentGateway () {
    let info
    try {
      info = await this.getActiveAdapter()
    } catch (error) {
      return ['', '']
    }

    const cmd1 = "/sbin/route -n get default | grep gateway | awk '{print $2}'"
    const cmd2 = `/usr/sbin/networksetup -getdnsservers "${info[0]}"`

    return Promise.all([
      this.localExec(cmd1).then((output) => {
        return Promise.resolve((output && output.trim()) || '')
      }),
      this.localExec(cmd2).then((output) => {
        return Promise.resolve((output && output.trim()) || '')
      })
    ])
  }
  async changeRouteTo (dst) {
    const info = await this.getActiveAdapter()

    const ip = dst === 'vrouter' ? this.config.vrouter.ip : info[2]

    const cmd1 = `/sbin/route change default ${ip}`
    const cmd2 = `/usr/sbin/networksetup -setdnsservers "${info[0]}" "${ip}"`
    await this.sudoExec(cmd1)
    await this.sudoExec(cmd2)
  }
  async getActiveAdapter () {
    let cmd = String.raw`cat <<EOF | scutil
open
get State:/Network/Global/IPv4
d.show
EOF`
    const output = await this.localExec(cmd)

    const infReg = /PrimaryInterface : (.*)$/mg
    let inf
    try {
      inf = infReg.exec(output)[1]
    } catch (error) {
      winston.error('no activeAdapter detected')
      throw Error('no activeAdapter detected.')
    }

    const serviceReg = /PrimaryService : (.*)$/mg
    const service = serviceReg.exec(output)[1]

    const routerReg = /Router : (.*)$/mg
    const router = routerReg.exec(output)[1]

    cmd = String.raw`cat <<EOF | scutil | grep "UserDefinedName" | awk -F': ' '{print $2}'
open
get Setup:/Network/Service/${service}
d.show
EOF`
    const serviceName = await this.localExec(cmd)

    winston.info(`activeAdapter: ${serviceName.trim()}(${router}), ${inf}`)
    return [serviceName.trim(), inf, router]
  }
  async installNwWatchdog () {
    await this.generateNetworkSh()
    await this.localExec(`chmod +x "${path.join(this.config.host.configDir, this.config.host.networkSh)}"`)
    await this.generateNetworkPlist()
    await this.sudoExec(`cp "${path.join(this.config.host.configDir, this.config.host.networkPlist)}" /Library/LaunchDaemons`)
    await this.sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await this.sudoExec(`launchctl bootstrap system /Library/LaunchDaemons/${this.config.host.networkPlist}`)
  }
  async removeNwWatchdog () {
    await this.sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await this.sudoExec(`rm /Library/LaunchDaemons/${this.config.host.networkPlist}`).catch(e => {})
    await this.sudoExec(`rm "${path.join(this.config.host.configDir, path.basename(this.config.host.networkSh, '.sh') + '.log')}"`).catch(e => {})
  }
}

let System
switch (os.platform()) {
  case 'darwin':
    System = MacOS
    break
  default:
    System = MacOS
}

module.exports = {
  System
}
