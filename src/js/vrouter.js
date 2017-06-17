const { exec } = require('child_process')
const Client = require('ssh2').Client
const http = require('http')
const fs = require('fs-extra')
const DEBUG = false

function localExec (cmd) {
  const specialCmd = [
    /^VBoxManage hostonlyif .*$/ig
  ]
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        resolve([err, false])
      } else {
        if (stderr && !specialCmd.some((element) => element.test(cmd))) {
          resolve([stderr, false])
        } else {
          resolve([null, stdout])
        }
      }
    })
  })
}

function downloadFile (url, dest) {
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

function initVM () {
  const cmd = String.raw`

  `
}

function importVM (vmFile) {
  const cmd = `VBoxManage import ${vmFile}`
  return localExec(cmd)
}

function deleteVM (vmName) {
  const cmd = `VBoxManage unregistervm ${vmName} --delete`
  return localExec(cmd)
}

function stopVM (vmName) {
  const cmd = `VBoxManage controlvm ${vmName} poweroff`
  return localExec(cmd)
}

function toggleVMVisibility (vmName, action = true) {
  const cmd = `VBoxManage setextradata ${vmName} GUI/HideFromManager ${action}`
  return localExec(cmd)
}

function startVM (vmName) {
  const cmd = `VBoxManage startvm --type headless ${vmName}`
  return localExec(cmd)
}

function isVBInstalled () {
  const cmd = 'VBoxManage --version'
  return localExec(cmd)
}

function isVRouterExisted (vmName) {
  const cmd = 'VBoxManage list vms'
  return localExec(cmd).then((arr) => {
    if (arr[0]) {
      return arr
    } else {
      if (arr[1].indexOf(vmName) >= 0) {
        return [null, true]
      } else {
        return ['not existed']
      }
    }
  })
}

function isVRouterRunning (vmName) {
  // State:           running (since 2017-06-16T02:13:09.066000000)
  const cmd = 'VBoxManage list runningvms'
  return localExec(cmd).then((arr) => {
    if (arr[0]) {
      return arr
    } else {
      if (arr[1].indexOf(vmName) >= 0) {
        return [null, true]
      } else {
        return ['VRouter not running']
      }
    }
  })
}

function getAllInf () {
  const cmd = 'ifconfig'
  return localExec(cmd)
}

function removeHostonlyInf (inf) {
  const cmd = `VBoxManage hostonlyif remove ${inf}`
  return localExec(cmd)
}

// return [rightInf, firstEmptyInf]
async function getHostonlyInf (hostIP) {
  const infs = await getAllInf()
  const reg = /^vboxnet\d+.*\n(?:\t.*\n)*/img
  let rightInf = null
  let firstEmptyInf = null
  while (true) {
    const result = reg.exec(infs)
    if (!result) break
    const inf = result[0]
    const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(inf)
    const nameMatch = /^(vboxnet\d+):/ig.exec(inf)
    if (!ipMatch && !firstEmptyInf && nameMatch) firstEmptyInf = nameMatch[1]
    if (ipMatch && nameMatch && ipMatch[1] === hostIP) {
      rightInf = nameMatch[1]
    }
  }
  return [rightInf, firstEmptyInf]
}

async function isNIC1ConfigedAsHostonly (vmName, hostIP) {
  let cmd = `VBoxManage showvminfo ${vmName} | grep 'NIC 1'`
  const NIC1 = await localExec(cmd)
  if (NIC1[0]) {
    if (DEBUG) console.log(NIC1)
    return ['no NIC1 found']
  }
  const typeMatch = /Attachment: (.*) Interface/ig.exec(NIC1[1])
  if (!typeMatch || typeMatch[1] !== 'Host-only') {
    if (DEBUG) console.log(typeMatch)
    return ['NIC1 not hostonly network']
  }
  const infMatch = /Attachment: .* Interface '(.*)'/ig.exec(NIC1[1])
  if (!infMatch || !/^vboxnet\d+$/ig.test(infMatch[1])) {
    if (DEBUG) console.log(infMatch)
    return ['NIC1 not specify host-only adapter']
  }
  cmd = `ifconfig ${infMatch[1]}`
  const inf = await localExec(cmd)
  if (inf[0]) {
    if (DEBUG) console.log(inf)
    return ['host-only adapter not existed', infMatch[1]]
  }
  const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(inf[1])
  if (!ipMatch) return ['host-only adapter not existed', infMatch[1]]
  if (ipMatch[1] !== hostIP) return ['host-only adapter not config as hostIP', infMatch[1]]
  return [null, infMatch[1]]
}

async function isNIC2ConfigedAsBridged (vmName) {
  let cmd = `VBoxManage showvminfo ${vmName} | grep 'NIC 2'`
  const NIC2 = await localExec(cmd)
  if (NIC2[0]) return ['no NIC2 found']
  const typeMatch = /Attachment: (.*) Interface/ig.exec(NIC2[1])
  if (!typeMatch || typeMatch[1] !== 'Bridged') return ['NIC2 not bridged network']
  const infMatch = /Attachment: .* Interface '(.*)'/ig.exec(NIC2[1])
  if (!infMatch) return ['NIC2 not specify adapter']
  cmd = `ifconfig ${infMatch[1].split(':')[0]}`
  const inf = await localExec(cmd)
  if (inf[0]) return ['bridged adapter not existed', infMatch[1]]
  const statusMatch = /status: active/ig.exec(inf[1])
  if (!statusMatch) return ['bridged adapter not active']
  return [null, infMatch[1]]
}

async function isNetworkConfiged (vmName, hostIP) {
  const cmd = `VBoxManage showvminfo ${vmName} | grep NIC`
  const NICs = await localExec(cmd)
  if (!NICs[0]) return ['no NICs found']
}

// todo: need fixed
async function isBridgeExisted (VRouterIP) {
  const result = await getHostonlyInf(VRouterIP)
  if (!result) return ['no hostonly interface found.']
  return [null, true]
}

async function specifyHostonlyAdapter (vmName, inf = 'vboxnet0', nic = '1') {
  // VBoxManage modifyvm com.icymind.vrouter --nic1 hostonly --hostonlyadapter1 vboxnet1
  const cmd = `VBoxManage modifyvm ${vmName} --nic${nic} hostonly --hostonlyadapter${nic} ${inf}`
  return localExec(cmd)
}

function specifyBridgeAdapter (vmName, inf = 'en0: Wi-Fi (AirPort)', nic = '2') {
  // VBoxManage list bridgedifs
  // VBoxManage modifyvm com.icymind.vrouter --nic2 bridged --bridgeadapter1 en0
  const cmd = `VBoxManage modifyvm ${vmName} --nic${nic} bridged --bridgeadapter${nic} "${inf}"`
  return localExec(cmd)
}

async function createHostonlyInf () {
  const cmd = `VBoxManage hostonlyif create`
  const output = await localExec(cmd)
  const infMatch = /Interface '(.*)'/ig.exec(output[1])
  if (!infMatch) {
    return null
  }
  return infMatch[1]
}

async function getInfIP (inf) {
  const cmd = `ifconfig ${inf}`
  const result = await localExec(cmd)
  if (result[0]) return result
  const ipMatch = /inet (\d+\.\d+\.\d+\.\d+) netmask/ig.exec(result[1])
  let ip = ''
  if (ipMatch) ip = ipMatch[1]
  return [null, ip]
}

async function configHostonlyInf (hostIP, infArg, netmask = '255.255.255.0') {
  let inf = infArg
  if (!inf) {
    const infs = await getHostonlyInf(hostIP)
    inf = infs[0]
    if (!inf) {
      inf = infs[1] || await createHostonlyInf()
    }
  }
  const cmd = `VBoxManage hostonlyif ipconfig ${inf} --ip ${hostIP} --netmask ${netmask}`
  const result = await localExec(cmd)
  if (!result[0]) result[1] = inf
  return result
}

async function getActiveAdapter () {
  // VBoxManage list bridgedifs | grep ^Name: | grep en0
  let output = await getAllInf()
  if (output[0]) return output
  const reg = /^\w+:.*\n(?:\t.*\n)*/img
  let infs = []
  while (true) {
    let infMatch = reg.exec(output)
    if (!infMatch) break
    let infconfig = infMatch[0]
    if (!/status: active/ig.test(infconfig)) continue
    if (!/inet \d+\.\d+\.\d+\.\d+ netmask/ig.test(infconfig)) continue
    infs.push(/^(\w+):.*/ig.exec(infconfig)[1])
  }
  const cmd = 'VBoxManage list bridgedifs'
  output = await localExec(cmd)
  if (output[0]) return output
  return [null, infs.map((element) => {
    const law = String.raw`^Name:\s*(${element}.*)`
    const reg = new RegExp(law, 'ig')
    const nameMatch = reg.exec(output[1])
    if (nameMatch) {
      return nameMatch[1]
    }
  })]
}

async function configVMNetwork (vmName, VRouterIP, hostIP) {
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

  if (VRouterIP.split('.').slice(0, 3).join('.') !== hostIP.split('.').slice(0, 3).join('.')) {
    throw new Error('VRouterIP and hostIP not in a same subnet')
  }
  let output = await isNIC1ConfigedAsHostonly(vmName, hostIP)
  if (output[0]) {
    output = await configHostonlyInf(hostIP)
    if (output[0]) throw Error(output)
    let inf = output[1]
    await specifyHostonlyAdapter(vmName, inf)
  }
  output = await isNIC2ConfigedAsBridged(vmName)
  await specifyBridgeAdapter(vmName)
  if (output[0]) {
    output = await getActiveAdapter()
    if (output[0]) return output
    if (output[1].length !== 1) return output
    await specifyBridgeAdapter(vmName, output[1])
  }
  return [null, true]
}

async function fixNetwork (vmName, VRouterIP, hostIP) {
  // VBoxManage showvminfo com.icymind.vrouter | grep NIC
  // networksetup -listnetworkserviceorder
  // todo: must be insure:
  // 1. host-only interface in the same network of VRouterIP
  // 2. bridged interface should be current active network(how? ifconfig?)
  // may be it's better left for user.
  const inf = await getHostonlyInf(VRouterIP)
  await configHostonlyInf(hostIP, inf)
  await specifyHostonlyAdapter(vmName, inf)
  // todo: maybe is not 'en0'
  await specifyBridgeAdapter(vmName, 'en0')
}

function remoteExec (conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      let result = ''
      if (err) reject(err)
      stream.on('data', data => result += data)
      stream.stderr.on('data', data => resolve([data.toString().trim()]))
      stream.on('end', () => resolve([null, result.toString().trim()]))
    })
  })
}

function getSSVersion (conn) {
  const cmd = 'ss-redir -h | grep "shadowsocks-libev" | cut -d" " -f2'
  return remoteExec(conn, cmd)
}

function getKTVersion (conn) {
  const cmd = 'kcptun --version | cut -d" " -f3'
  return remoteExec(conn, cmd)
}

function getOSVersion (conn) {
  const cmd = 'cat /etc/banner | grep "(*)" | xargs'
  return remoteExec(conn, cmd)
}

function getUptime (conn) {
  return remoteExec(conn, 'uptime')
}

function getBrlan (conn) {
  const cmd = 'ifconfig br-lan | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
  return remoteExec(conn, cmd)
}

function getWifilan (conn) {
  const cmd = 'ifconfig eth1 | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
  return remoteExec(conn, cmd)
}

function getFile (conn, file) {
  const cmd = `cat ${file}`
  return remoteExec(conn, cmd)
}

function close (conn) {
  conn.end()
}

function connect (config) {
  console.log(config)
  return new Promise((resolve, reject) => {
    const conn = new Client()
    conn.on('ready', () => {
      const vrouter = {
        getUptime: () => getUptime(conn),
        close: () => close(conn),
        getSSVersion: () => getSSVersion(conn),
        getKTVersion: () => getKTVersion(conn),
        getOSVersion: () => getOSVersion(conn),
        getBrlan: () => getBrlan(conn),
        getWifilan: () => getWifilan(conn),
        getSSClient: () => getFile(conn, config.shadowsocks.client),
        getSSDNS: () => getFile(conn, config.shadowsocks.dns),
        getSSOverKT: () => getFile(conn, config.shadowsocks.overKcptun),
        getKTClient: () => getFile(conn, config.kcptun.client),
        getFWUser: () => getFile(conn, config.firewall.user)
      }
      resolve(vrouter)
    }).connect({
      host: config.vrouter.ip,
      port: config.vrouter.port,
      username: config.vrouter.username,
      privateKey: fs.readFileSync(config.privateKey),
      keepaliveInterval: 30000,
      readyTimeout: 5500
    })
  })
}

function VRouter (config) {
  this.config = config
  this.connect = () => connect(this.config)
  this.isVBInstalled = () => isVBInstalled(this.config.vrouter.vmName)
  this.isVRouterExisted = () => isVRouterExisted(this.config.vrouter.vmName)
  this.isVRouterRunning = () => isVRouterRunning(this.config.vrouter.vmName)
  this.isBridgeExisted = () => isBridgeExisted(this.config.vrouter.ip)
  this.startVM = () => startVM(this.config.vrouter.vmName)
  this.stopVM = () => stopVM(this.config.vrouter.vmName)
  this.specifyHostonlyAdapter = (inf, nic) => specifyHostonlyAdapter(this.config.vrouter.vmName, inf, nic)
  this.specifyBridgeAdapter = (inf, nic) => specifyBridgeAdapter(this.config.vrouter.vmName, inf, nic)
  this.fixNetwork = () => fixNetwork(this.config.vrouter.vmName, this.config.vrouter.ip, this.config.host.ip)
  this.configVMNetwork = () => configVMNetwork(this.config.vrouter.vmName, this.config.vrouter.ip, this.config.host.ip)
}

module.exports = {
  VRouter
}
