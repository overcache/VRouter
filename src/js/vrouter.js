const { exec } = require('child_process')
const Client = require('ssh2').Client
const http = require('http')
const fs = require('fs-extra')

class VRouter {
  constructor (config) {
    this.config = config
  }

  localExec (cmd) {
    const specialCmd = [
      /^VBoxManage hostonlyif .*$/ig
    ]
    return new Promise((resolve, reject) => {
      exec(cmd, (err, stdout, stderr) => {
        if (err) reject(err)
        else {
          if (stderr && !specialCmd.some((element) => element.test(cmd))) {
            reject(stderr)
          } else resolve(stdout)
        }
      })
    })
  }

  downloadFile (url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest)
      http.get(url, (response) => {
        response.pipe(file)
        file.on('finish', () => file.close())
        resolve()
      }).on('error', (err) => {
        fs.unlink(dest)
        reject(err)
      })
    })
  }

  importVM (vmFile) {
    const cmd = `VBoxManage import ${vmFile}`
    return this.localExec(cmd)
  }

  deleteVM (vmName) {
    const cmd = `VBoxManage unregistervm ${vmName} --delete`
    return this.localExec(cmd)
  }

  stopVM (vmName) {
    const cmd = `VBoxManage controlvm ${vmName} poweroff`
    return this.localExec(cmd)
  }

  hideVM (vmName, action = true) {
    const cmd = `VBoxManage setextradata ${vmName} GUI/HideFromManager ${action}`
    return this.localExec(cmd)
  }

  startVM (vmName, type = 'headless') {
    const cmd = `VBoxManage startvm --type ${type} ${vmName}`
    return this.localExec(cmd)
  }

  isVBInstalled () {
    const cmd = 'VBoxManage --version'
    return this.localExec(cmd)
  }

  isVRouterExisted (vmName) {
    const cmd = 'VBoxManage list vms'
    return this.localExec(cmd)
      .then((stdout) => {
        if (stdout.indexOf(vmName) < 0) {
          return Promise.reject(Error('vm not existed'))
        }
      })
  }

  isVRouterRunning (vmName) {
    // State:           running (since 2017-06-16T02:13:09.066000000)
    const cmd = 'VBoxManage list runningvms'
    return this.localExec(cmd)
      .then((stdout) => {
        if (stdout.indexOf(vmName) < 0) {
          return Promise.reject(Error('vm not running'))
        }
      })
  }

  getAllInf () {
    const cmd = 'ifconfig'
    return this.localExec(cmd)
  }

  removeHostonlyInf (inf) {
    const cmd = `VBoxManage hostonlyif remove ${inf}`
    return this.localExec(cmd)
  }

  // return [rightInf, firstEmptyInf]
  getHostonlyInf (hostIP) {
    return this.getAllInf()
      .then((infs) => {
        const reg = /^vboxnet\d+.*\n(?:\t.*\n)*/img
        let correspondingInf = null
        let firstAvailableInf = null
        while (true) {
          const result = reg.exec(infs)
          if (!result) break
          const infConfig = result[0]
          const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(infConfig)
          const nameMatch = /^(vboxnet\d+):/ig.exec(infConfig)
          if (!ipMatch && !firstAvailableInf && nameMatch) {
            firstAvailableInf = nameMatch[1]
          }
          if (ipMatch && nameMatch && ipMatch[1] === hostIP) {
            correspondingInf = nameMatch[1]
          }
        }
        return [correspondingInf, firstAvailableInf]
      })
  }

  isNIC1ConfigedAsHostonly (vmName, hostIP) {
    let cmd = `VBoxManage showvminfo ${vmName} | grep 'NIC 1'`
    return this.localExec(cmd)
      .then((output) => {
        const typeMatch = /Attachment: (.*) Interface/ig.exec(output)
        if (!typeMatch || typeMatch[1] !== 'Host-only') {
          return Promise.reject(Error("NIC1 isn't hostonly network"))
        }
        const infMatch = /Attachment: .* Interface '(.*)'/ig.exec(output)
        if (!infMatch || !/^vboxnet\d+$/ig.test(infMatch[1])) {
          return Promise.reject(Error("NIC1 doesn't specify host-only adapter"))
        }
        const inf = infMatch[1]
        cmd = `ifconfig ${inf}`
        return this.localExec(cmd)
          .then((infConfig) => {
            const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(infConfig)
            if (!ipMatch || ipMatch[1] !== hostIP) return Promise.reject(Error("host-only adapter doesn't config as hostIP"))
            return inf
          })
      })
  }

  isNIC2ConfigedAsBridged (vmName) {
    let cmd = `VBoxManage showvminfo ${vmName} | grep 'NIC 2'`
    return this.localExec(cmd)
      .then((output) => {
        const typeMatch = /Attachment: (.*) Interface/ig.exec(output)
        if (!typeMatch || typeMatch[1] !== 'Bridged') {
          return Promise.reject(Error("NIC2 isn't bridged network"))
        }
        const infMatch = /Attachment: .* Interface '(.*)'/ig.exec(output)
        if (!infMatch) {
          return Promise.reject(Error("NIC2 doesn't specify bridged adapter"))
        }
        const bridgedInf = infMatch[1]
        cmd = `ifconfig ${bridgedInf.split(':')[0]}`
        return this.localExec(cmd)
          .then((infConfig) => {
            const statusMatch = /status: active/ig.exec(infConfig)
            if (!statusMatch) return Promise.reject(Error("bridged adapter doesn't active"))
            return bridgedInf
          })
      })
  }

  specifyHostonlyAdapter (vmName, inf = 'vboxnet0', nic = '1') {
    // VBoxManage modifyvm com.icymind.vrouter --nic1 hostonly --hostonlyadapter1 vboxnet1
    const cmd = `VBoxManage modifyvm ${vmName} --nic${nic} hostonly --hostonlyadapter${nic} ${inf}`
    return this.localExec(cmd)
  }

  specifyBridgeAdapter (vmName, inf = 'en0: Wi-Fi (AirPort)', nic = '2') {
    // VBoxManage modifyvm com.icymind.vrouter --nic2 bridged --bridgeadapter1 en0
    const cmd = `VBoxManage modifyvm ${vmName} --nic${nic} bridged --bridgeadapter${nic} "${inf}"`
    return this.localExec(cmd)
  }

  createHostonlyInf () {
    const cmd = `VBoxManage hostonlyif create`
    return this.localExec(cmd)
      .then((output) => {
        const infMatch = /Interface '(.*)'/ig.exec(output)
        return infMatch && infMatch[1]
      })
  }

  getInfIP (inf) {
    const cmd = `ifconfig ${inf}`
    return this.localExec(cmd)
      .then((output) => {
        const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(output)
        const ip = (ipMatch && ipMatch[1]) || ''
        return ip
      })
  }

  configHostonlyInf (hostIP, inf, netmask = '255.255.255.0') {
    return Promise.resolve(() => {
      if (!inf) {
        return this.getHostonlyInf(hostIP)
          .then((infs) => {
            return infs[0] || infs[1] || this.createHostonlyInf()
          })
      }
    })
      .then((i) => {
        const cmd = `VBoxManage hostonlyif ipconfig ${i} --ip ${hostIP} --netmask ${netmask}`
        return this.localExec(cmd)
          .then(() => i)
      })
  }

  getActiveAdapter () {
    // VBoxManage list bridgedifs | grep ^Name: | grep en0
    return this.getAllInf()
      .then((output) => {
        const reg = /^\w+:.*\n(?:\t.*\n)*/img
        let infs = []
        while (true) {
          let infMatch = reg.exec(output)
          if (!infMatch) break
          let infConfig = infMatch[0]
          if (!/status: active/ig.test(infConfig)) continue
          if (!/inet \d+\.\d+\.\d+\.\d+ netmask/ig.test(infConfig)) continue
          infs.push(/^(\w+):.*/ig.exec(infConfig)[1])
        }
        return infs
      })
      .then((infs) => {
        const cmd = 'VBoxManage list bridgedifs'
        return this.localExec(cmd)
          .then((bridgedIfs) => {
            return infs.map((element) => {
              const raw = String.raw`^Name:\s*(${element}.*)`
              const reg = new RegExp(raw, 'ig')
              const nameMatch = reg.exec(bridgedIfs)
              return nameMatch && nameMatch[1]
            })
          })
      })
  }

  configVMNetwork (vmName, VRouterIP, hostIP) {
    /*
     * 1. make sure two ip in same network
     * 2. make sure vm adapters are : hostonlyif, bridged
     * 3. make sure hostonlyif ip equal hostIP
     * 4. make sure vm bridged interface choose right host-network
     */
    /*
     * todo:
     * 1. be more flex.
     * 2. the users' active network may be other than en0
     */
    /*
     * cmds may help:
     * VBoxManage showvminfo com.icymind.vrouter | grep NIC
     * networksetup -listnetworkserviceorder
     */

    if (VRouterIP.split('.').slice(0, 3).join('.') !==
      hostIP.split('.').slice(0, 3).join('.')) {
      return Promise.reject(Error('VRouterIP and hostIP must in a same subnet'))
    }
    return this.isNIC1ConfigedAsHostonly(vmName, hostIP)
      .catch(() => {
        return this.configHostonlyInf(hostIP)
      })
      .then((inf) => {
        return this.specifyHostonlyAdapter(vmName, inf)
      })
      .then(() => {
        return this.isNIC2ConfigedAsBridged(vmName)
      })
      .catch(() => {
        return this.specifyBridgeAdapter(vmName)
      })
      .then(() => {
        return this.getActiveAdapter()
      })
      .then((output) => {
        if (output.length === 1) {
          return this.specifyBridgeAdapter(vmName, output[1])
        }
      })
  }

  connect (config) {
    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        resolve(new VRouterRemote(conn, config))
      }).connect({
        host: config.vrouter.ip,
        port: config.vrouter.port,
        username: config.vrouter.username,
        password: config.vrouter.password,
        keepaliveInterval: 30000,
        readyTimeout: 5500
      })
    })
  }
}

class VRouterRemote {
  constructor (connect, config) {
    this.connect = connect
    this.config = config
  }

  remoteExec (cmd) {
    return new Promise((resolve, reject) => {
      this.connect.exec(cmd, (err, stream) => {
        let result = ''
        if (err) reject(err)
        stream.on('data', (data) => {
          result += data
        })
        stream.stderr.on('data', data => resolve([data.toString().trim()]))
        stream.on('end', () => resolve([null, result.toString().trim()]))
      })
    })
  }

  getSSVersion () {
    const cmd = 'ss-redir -h | grep "shadowsocks-libev" | cut -d" " -f2'
    return this.remoteExec(cmd)
  }

  getKTVersion () {
    const cmd = 'kcptun --version | cut -d" " -f3'
    return this.remoteExec(cmd)
  }

  getOSVersion () {
    const cmd = 'cat /etc/banner | grep "(*)" | xargs'
    return this.remoteExec(cmd)
  }

  getUptime () {
    return this.remoteExec('uptime')
  }

  getBrlan () {
    const cmd = 'ifconfig br-lan | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.remoteExec(cmd)
  }

  getWifilan () {
    const cmd = 'ifconfig eth1 | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.remoteExec(cmd)
  }

  getFile (file) {
    const cmd = `cat ${file}`
    return this.remoteExec(cmd)
  }

  close () {
    this.connect.end()
  }
}

module.exports = {
  VRouter
}
