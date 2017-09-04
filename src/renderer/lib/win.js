// import VBox from './vbox.js'
// const path = require('path')
import logger from './logger'
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

// options not supported in windows
function sudoExec (cmd, options = {name: 'VRouter'}) {
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

async function disableIPV6 () { // eslint-disable-line
  const index = await getActiveAdapterIndex()
  const subCmd = `WMIC nicconfig where "InterfaceIndex = ${index}" get description`

  // Description
  // Intel(R) Centrino(R) Wireless-N 1000
  const headerIncludedOutput = await execute(subCmd)
  const description = headerIncludedOutput.split('\n')[1].trim()

  const cmd = `powershell -Command {Disable-NetAdapterBinding -InterfaceDescription "${description}" -ComponentID ms_tcpip6}`
  // const cmd = `Disable-NetAdapterBinding -InterfaceDescription "${description}" -ComponentID ms_tcpip6`
  console.log('Disable-NetAdapterBinding works in powershell only. I need to find out how to run powershell as administrator')
  logger.debug(`about to disable IPV6 of Adapter: ${description}`)
  return sudoExec(cmd)
}

async function getActiveAdapterIndexAndName () {
  const cmd = 'WMIC nic where "PhysicalAdapter = TRUE and NetConnectionStatus = 2" get InterfaceIndex,Name'

  // InterfaceIndex  Name
  // 11              Intel(R) 82577LM Gigabit Network Connection
  // 7               VirtualBox Host-Only Ethernet Adapter

  const headerIncludedIfs = await execute(cmd)
  const physicalIfs = []

  const indexAndNamePattern = /^(\d+)\s*(.*)$/i // 注意不要添加 g 标志
  headerIncludedIfs.split('\n').slice(1).forEach(line => {
    const matchResult = indexAndNamePattern.exec(line.trim())
    if (matchResult && !/virtualbox/ig.test(matchResult[2])) {
      physicalIfs.push({
        index: parseInt(matchResult[1].trim()),
        infName: matchResult[2]
      })
    }
  })
  return physicalIfs[0]
}

async function getActiveAdapterIndex () {
  const indexAndName = await getActiveAdapterIndexAndName()
  return indexAndName.index
}

async function changeGateway (index, ip) { // eslint-disable-line
  const infIndex = index || await getActiveAdapterIndex()
  const cmd = `WMIC nicconfig where "InterfaceIndex = ${infIndex}" call SetGateways ("${ip}")`
  logger.info(`about to changeGateway to ${ip}`)
  return sudoExec(cmd)
}

async function getRouterIP () { // eslint-disable-line
  const infIndex = await getActiveAdapterIndex()
  const cmd = `WMIC nicconfig where "InterfaceIndex = ${infIndex}" get DHCPServer`

  // DHCPServer
  // 192.168.10.1
  const headerIncludedOutput = await execute(cmd)
  const DHCPServer = headerIncludedOutput.split('\n')[1].trim()
  logger.debug(`Router IP: ${DHCPServer}`)
  return DHCPServer
}

async function infNameToIndex (infName) {
  const subCmd = `WMIC nic where "Name = '${infName}'" get InterfaceIndex`
  const indexOuput = await execute(subCmd)
  const index = indexOuput.split('\n')[1].trim()
  return index
}

class Win {
  static async getActiveAdapter () {
    const indexAndName = await getActiveAdapterIndexAndName()
    return indexAndName.infName
  }

  static async getCurrentGateway () {
    // tracert -h 1 -4 -w 100 114.114.114.114

    // 通过最多 1 个跃点跟踪
    // 到 public1.114dns.com [114.114.114.114] 的路由:
    //
    //   1    <1 毫秒   <1 毫秒   <1 毫秒  10.19.28.37
    //
    // 跟踪完成。
    const cmd = `tracert -d -h 1 -4 -w 100 114.114.114.114`

    const rawOutput = await execute(cmd)
    let gateway = ''
    const firstHopPattern = /^1\s+.*$/i
    const ipPattern = /^[\d.]*$/i
    rawOutput.split('\n').forEach(line => {
      if (firstHopPattern.test(line.trim())) {
        const arr = line.trim().split(/(\s|\t)/)
        const ret = arr[arr.length - 1].trim()
        if (ipPattern.test(ret)) {
          gateway = ret
        } else {
          gateway = 'No Default Gateway'
        }
      }
    })

    return gateway
  }

  static async getCurrentDns () {
    // nslookup.exe 10.19.28.37

    // 服务器:  vrouter.lan
    // Address:  10.19.28.37
    //
    // 名称:    vrouter.lan
    // Address:  10.19.28.37

    // or
    // DNS request timed out.
    // timeout was 2 seconds.
    // 服务器:  UnKnown
    // Address:  fe80::a00:27ff:fea0:861
    //
    // 非权威应答:
    // 名称:    qq.com
    // Addresses:  61.135.157.156
    //           125.39.240.113

    const cmd = `nslookup 10.19.28.37`

    const rawOutput = await execute(cmd)
    let dns = ''
    const serverPattern = /^Address:.*$/i
    const outputArray = rawOutput.split('\n')
    for (let i = 0; i < outputArray.length; i++) {
      if (serverPattern.test(outputArray[i].trim())) {
        dns = outputArray[i].trim().split(/address:/ig)[1].trim()
        break
      }
    }
    return dns
  }

  static async trafficToVirtualRouter (infName, gateway) {
    const hostonlyInfIndex = await infNameToIndex(infName)
    const activeAdapterIndex = await getActiveAdapterIndex()
    const cmds = []

    // change dns
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${hostonlyInfIndex}" call SetDNSServerSearchOrder ("${gateway}")`)
    // changeGateway
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${hostonlyInfIndex}" call SetGateways ("${gateway}")`)

    // set fake ip/mask
    const fakeIP = '168.254.254.254'
    const fakeMask = '255.0.0.0'
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${activeAdapterIndex}" call EnableStatic ("${fakeIP}"),("${fakeMask}")`)

    return sudoExec(cmds.join(' & '))
  }

  static async trafficToPhysicalRouter (infName, ip, mask) {
    const hostonlyInfIndex = await infNameToIndex(infName)
    const activeAdapterIndex = await getActiveAdapterIndex()
    const cmds = []

    // enableDHCP to get rid of gateway
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${hostonlyInfIndex}" call EnableDHCP`)

    // config ip/mask
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${hostonlyInfIndex}" call EnableStatic ("${ip}"),("${mask}")`)

    // emptyDNS
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${hostonlyInfIndex}" call SetDNSServerSearchOrder`)

    // enable physicalIfs
    cmds.push(`WMIC nicconfig where "InterfaceIndex = ${activeAdapterIndex}" call EnableDHCP`)

    return sudoExec(cmds.join(' & '))
  }
}

export default Win
