const fs = require('fs-extra')
const path = require('path')
const os = require('os')
// const { Utils } = require('./utils.js')

/*
 * 根据rule, 生成PREROUTING和OUTPUT两条iptables规则
 */
function generateFWRulesHelper (rule) {
  return `iptables -t nat -A PREROUTING ${rule}\niptables -t nat -A OUTPUT ${rule}\n`
}

/*
 * @param {object} options: {file, ipsetName, outStream}
 */
async function generateIPsetsHelper (options) {
  options.outStream.write(`create ${options.ipsetName} hash:net family inet hashsize 1024 maxelem 65536 -exist\n`)

  const list = await fs.readFile(options.file, 'utf8')

  list.split('\n').forEach((line) => {
    const trimLine = line.trim()

    if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
      const pattern = /^\d+\.\d+\.\d+\.\d+(?:\/\d+)?$/g
      if (pattern.test(trimLine)) {
        options.outStream.write(`add ${options.ipsetName} ${trimLine}\n`)
      }
    }
  })
}

/*
 * @param {object} options: {file, dnsServer, ipsetName, outStream}
 */
async function generateDnsmasqHelper (options) {
  const domains = await fs.readFile(options.file)

  domains.split('\n').forEach((line) => {
    const trimLine = line.trim()
    if (!/^#/ig.test(trimLine) && !/^$/ig.test(trimLine)) {
      const IPPattern = /^\d+\.\d+\.\d+\.\d+$/g
      if (!IPPattern.test(trimLine)) {
        if (options.dnsServer) {
          options.outStream.write(`server=/${trimLine}/${options.dnsServer}\n`)
        }
        options.outStream.write(`ipset=/${trimLine}/${options.ipsetName}\n`)
      }
    }
  })
}

class Generate {
  /*
   * @param {object} options: {mode, list: [{file, dnsServer, ipsetName}]}
   */
  static async dnsmasqCfgFile (options) {
    const out = path.join(os.tmpdir(), 'dnsmasq.custom')
    await fs.remove(out).catch()

    const ws = fs.createWriteStream(out)
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', () => {
        resolve(out)
      })
      ws.on('error', (err) => {
        reject(err)
      })
    })

    if (options.mode === 'none') {
      ws.write('# stay in wall\n')
      ws.end()
      return promise
    }

    for (let i = 0; i < options.list.length; i++) {
      const { file, dnsServer, ipsetName } = options.list[i]
      await generateDnsmasqHelper({
        file,
        dnsServer,
        ipsetName,
        outStream: ws
      })
    }

    ws.end()
    return promise
  }

  /*
   * @param {object} options: {priority, binPath, cfgPath}
   */
  static async serviceFile (options) {
    const out = path.join(os.tmpdir(), 'proxy.service')
    await fs.remove(out).catch()

    const content = String.raw`#!/bin/sh /etc/rc.common
            # Copyright (C) 2006-2011 OpenWrt.org
            START=${options.priority}
            SERVICE_USE_PID=1
            SERVICE_WRITE_PID=1
            SERVICE_DAEMONIZE=1
            start() {
                service_start ${options.binPath} -c ${options.cfgPath}
            }
            stop() {
                service_stop ${options.binPath}
            }`
    await fs.outputFile(out, content)
    return out
  }

  /*
   * 生成firewall.user文件
   * @param {string} proxies, 当前代理工具, 如ss,ssr, ssKt, ssrKt
   * @param {string} mode, 过滤模式, whitelist/blacklist/global/none
   * @param {string} redirPort, 透明代理所在的端口, 即ss-redir/ssr-redir监听的端口
   * @param {string} bypassIPs, 需要绕过的IP. 如果没有绕过服务器IP, 那将进入死循环
   * @param {opject} ipsets, ipset的相关信息
   *    ipsets.file:路由器上ipset文件所在的路径. 这样每次防火墙重启时, 可以顺带重启ipset.
   *    ipsets.lanName/ipsets.blackName/ipsets.whiteName: 各ipset的名称
   * @param {opject} options
   *    options.sshPort: 服务器ssh端口. 当代理工具为kcptun时, 加速到bypassIP的ssh连接.
   * @return {promise} 当写入完毕后, promise会返回生成的firewall.user所在路径
   */
  static async firewallFile (options) {
    const out = path.join(os.tmpdir(), 'firewall.user')
    await fs.remove(out).catch()

    const ws = fs.createWriteStream(out)
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', () => {
        resolve(out)
      })
      ws.on('error', (err) => {
        reject(err)
      })
    })

    ws.write('# com.icymind.vrouter\n')
    ws.write(`# workMode: ${options.mode}\n`)
    ws.write('ipset flush\n')
    ws.write(`/usr/sbin/ipset restore -f -! ${options.ipsets.file} &> /dev/null\n`)

    // if kcp protocol: speedup ssh
    if (options.proxies.includes('Kt') && options.sshPort) {
      ws.write('# speedup ssh connection if current proxy is kcptun\n')
      options.bypassIPs.forEach((ip) => {
        const rule = `-d ${ip} -p tcp --dport ${options.sshPort} -j REDIRECT --to-port ${options.redirPort}`
        ws.write(generateFWRulesHelper(rule))
      })
    }

    // bypass serverIPs
    // bypass shadowsocks server_ip
    ws.write('# bypass server ip\n')
    options.bypassIPs.forEach((ip) => {
      ws.write(generateFWRulesHelper(`-d ${ip} -j RETURN`))
    })

    let rule = ''

    // bypass lan_networks. 如果不想绕过lan, 生成一个空的lan ipset集合即可
    ws.write('# bypass lan networks\n')
    rule = `-m set --match-set ${options.ipsets.lanName} dst -j RETURN`
    ws.write(generateFWRulesHelper(rule))

    // whitelist mode: bypass whitelist and route others
    if (options.mode === 'whitelist') {
      // "绕过白名单"模式下, 先将黑名单导向代理(如果自定义黑名单中存在白名单相同项, 先处理黑名单符合预期)
      ws.write('# route all blacklist traffic\n')
      rule = `-p tcp -m set --match-set ${options.ipsets.blackName} dst -j REDIRECT --to-port ${options.redirPort}`
      ws.write(generateFWRulesHelper(rule))

      ws.write('# bypass whitelist\n')
      rule = `-m set --match-set ${options.ipsets.whiteName} dst -j RETURN`
      ws.write(generateFWRulesHelper(rule))

      ws.write('# route all other traffic\n')
      rule = `-p tcp -j REDIRECT --to-port ${options.redirPort}`
      ws.write(generateFWRulesHelper(rule))
    }

    if (options.mode === 'blacklist') {
      // 仅代理黑名单模式下, 先将白名单返回(如果自定义白名单中存在黑名单相同项, 先处理白名单符合预期)
      ws.write('# bypass whitelist\n')
      rule = `-m set --match-set ${options.ipsets.whiteName} dst -j RETURN`
      ws.write(generateFWRulesHelper(rule))

      ws.write('# route all blacklist traffic\n')
      rule = `-p tcp -m set --match-set ${options.ipsets.blackName} dst -j REDIRECT --to-port ${options.redirPort}`
      ws.write(generateFWRulesHelper(rule))
    }

    if (options.mode === 'global') {
      ws.write('# route all traffic\n')
      rule = `-p tcp -j REDIRECT --to-port ${options.redirPort}`
      ws.write(generateFWRulesHelper(rule))
    }
    ws.end()
    return promise
  }

  /*
   * @param {array} ipsets: [{file, ipsetName}]
   */
  static async ipsetFile (ipsets) {
    const out = path.join(os.tmpdir(), 'ipset')
    await fs.remove(out).catch()

    const ws = fs.createWriteStream(out)
    const promise = new Promise((resolve, reject) => {
      ws.on('finish', () => {
        resolve(out)
      })
      ws.on('error', (err) => {
        reject(err)
      })
    })

    for (let i = 0; i < ipsets.length; i++) {
      const [file, ipsetName] = ipsets[i]
      await generateIPsetsHelper({
        file,
        ipsetName,
        outStream: ws
      })
    }

    ws.end()
    return promise
  }

  /*
   * @param {object} options: {proxies, enableTunnelDns, servicesName:
   * {tunnelDns: '', shadowsocks: '', shadowsocksr: '', kcptun: ''}}
   */
  static async watchdogFile (options) {
    const out = path.join(os.tmpdir(), 'watchdog')
    await fs.remove(out).catch()

    let content = '#!/bin/sh\n'

    const tunnelBinName = options.proxies.indexOf('ssr') < 0 ? 'ss-tunnel' : 'ssr-tunnel'

    const tunnelDns = String.raw`
      tunnelDns=$(ps -w| grep "${tunnelBinName} -c .*tunnel-dns.jso[n]")
      if [[ -z "$tunnelDns" ]];then
        /etc/init.d/${options.servicesName.tunnelDns} restart
      fi`
    const shadowsocks = String.raw`
      ssClient=$(ps -w| grep "[s]s-redir -c .*ss-client.json")
      if [[ -z "$ssClient" ]];then
          /etc/init.d/${options.servicesName.shadowsocks} restart
      fi`
    const ssKt = String.raw`
      ssOverKt=$(ps -w| grep "[s]s-redir -c .*ss-over-kt.json")
      ssClient=$(ps -w| grep "[s]s-redir -c .*ss-client.json")
      if [[ -z "$ssOverKt" || -z "$ssClient" ]];then
          /etc/init.d/${options.servicesName.shadowsocks} restart
      fi`
    const shadowsocksr = String.raw`
      ssrClient=$(ps -w| grep "[s]sr-redir -c .*ssr-client.json")
      if [[ -z "$ssrClient" ]];then
          /etc/init.d/${options.servicesName.shadowsocksr} restart
      fi`
    const ssrKt = String.raw`
      ssrOverKt=$(ps -w| grep "[s]sr-redir -c .*ssr-over-kt.json")
      ssrClient=$(ps -w| grep "[s]sr-redir -c .*ssr-client.json")
      if [[ -z "$ssrOverKt" || -z "$ssrClient" ]];then
          /etc/init.d/${options.servicesName.shadowsocksr} restart
      fi`
    const kcptun = String.raw`
      if ! pgrep kcptun;then
          /etc/init.d/${options.servicesName.kcptun} restart
      fi
      `
    if (options.enableTunnelDns) {
      content += tunnelDns
    }
    if (options.proxies.includes('Kt')) {
      if (options.proxies === 'ssKt') {
        content += ssKt
      } else if (options.proxies === 'ssrKt') {
        content += ssrKt
      }
      content += kcptun
    } else {
      if (options.proxies === 'ss') {
        content += shadowsocks
      } else if (options.proxies === 'ssr') {
        content += shadowsocksr
      }
    }
    await fs.outputFile(out, content, 'utf8')
    return out
  }

  static proxyCfg (profile) {

  }
}

module.exports = {
  Generate
}
