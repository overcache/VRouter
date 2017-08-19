const path = require('path')
const { exec } = require('child_process')
// const sudo = require('sudo-prompt')

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

class Mac {
  static async getActiveAdapter () {
    let cmd = String.raw`cat <<EOF | scutil
    open
    get State:/Network/Global/IPv4
    d.show
    EOF`
    const output = await execute(cmd)

    const infReg = /PrimaryInterface : (.*)$/mg
    return infReg.exec(output)[1]
  }

  static sshLogin () {
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

  static async getOSXNetworkService (inf) {
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

  static async getCurrentGateway () {
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

  static async changeRouteTo (dst) {
    const info = await this.getActiveAdapter()

    const ip = dst === 'vrouter' ? this.config.vrouter.ip : info[2]

    const cmd1 = `/sbin/route change default ${ip}`
    const cmd2 = `/usr/sbin/networksetup -setdnsservers "${info[0]}" "${ip}"`
    await this.sudoExec(cmd1)
    await this.sudoExec(cmd2)
  }

  static async installNwWatchdog () {
    await this.generateNetworkSh()
    await this.localExec(`chmod +x "${path.join(this.config.host.configDir, this.config.host.networkSh)}"`)
    await this.generateNetworkPlist()
    await this.sudoExec(`cp "${path.join(this.config.host.configDir, this.config.host.networkPlist)}" /Library/LaunchDaemons`)
    await this.sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await this.sudoExec(`launchctl bootstrap system /Library/LaunchDaemons/${this.config.host.networkPlist}`)
  }

  static async removeNwWatchdog () {
    await this.sudoExec(`launchctl bootout system/${this.config.host.networkPlistName}`).catch(e => {})
    await this.sudoExec(`rm /Library/LaunchDaemons/${this.config.host.networkPlist}`).catch(e => {})
    await this.sudoExec(`rm "${path.join(this.config.host.configDir, path.basename(this.config.host.networkSh, '.sh') + '.log')}"`).catch(e => {})
  }

  /*
   * 通过串口执行命令
   * @param {string} file socket文件绝对路径
   * @param {string} command 待执行的命令(有长度限制)
   * @return undefined
   */
  static async serialExec (file, command) {
    // TODO: replace /usr/bin/nc with nodejs package
    const pre = `echo "" |  /usr/bin/nc -U "${file}"`
    const serialCmd = `echo "${command}" | /usr/bin/nc -U '${file}'`

    // 先执行两遍pre
    await execute(pre)
    await execute(pre)
    return execute(serialCmd)
  }
}

module.exports = {
  Mac
}
