const fs = require('fs-extra')
const path = require('path')
// const { getAppDir } = require('./helper.js')
// const packageJson = require('../package.json')
// const { EventEmitter } = require('events')
const os = require('os')
const winston = require('winston')

// let VBoxManage

// if (os.platform() === 'darwin') {
//   VBoxManage = '/usr/local/bin/VBoxManage'
// } else if (os.platform() === 'win32') {
//   VBoxManage = 'C:\\Program Files\\Oracle\\VirtualBox'
// }

class VRouter {
  async getCfgContent (fileName) {
    const filePath = path.join(this.config.host.configDir, fileName)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return content
    } catch (error) {
      const template = path.join(__dirname, '../config', fileName)
      winston.debug(`can not find ${filePath}, copy template ${template} to appdir`)
      await fs.copy(template, filePath)
      return fs.readFile(filePath, 'utf8')
    }
  }

  async generateConfig (type = 'shadowsocks') {
    const cfgs = []
    switch (type) {
      case 'shadowsocks':
        cfgs.push(this.config.shadowsocks.client)
        if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocks.overKt)
        }
        break
      case 'shadowsocksr':
        cfgs.push(this.config.shadowsocksr.client)
        if (this.config.profiles.profiles[this.config.profiles.activedProfile].proxies.includes('Kt')) {
          cfgs.push(this.config.shadowsocksr.overKt)
        }
        break
      case 'tunnelDns':
        // generateConfigHeler('tunnel-dns.json')
        cfgs.push(this.config.tunnelDns.dns)
        break
      case 'kcptun':
        cfgs.push(this.config.kcptun.client)
        break
      default:
        throw Error(`unkown config type: ${type}`)
    }
    const promises = []
    cfgs.forEach((cfg) => {
      promises.push(this.generateConfigHeler(cfg))
    })
    return Promise.all(promises)
  }
  async generateConfigHeler (type = 'ss-client.json') {
    let cfg
    let fastopen
    let content = {}
    const profile = this.config.profiles.profiles[this.config.profiles.activedProfile]
    switch (type) {
      case this.config.shadowsocks.client:
        cfg = this.config.shadowsocks.client
        fastopen = profile.shadowsocks.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': profile.shadowsocks.address,
          'server_port': parseInt(profile.shadowsocks.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocks.clientPort),
          'password': profile.shadowsocks.password,
          'timeout': parseInt(profile.shadowsocks.timeout),
          'method': profile.shadowsocks.method,
          'fast_open': fastopen,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocks.overKt:
        cfg = this.config.shadowsocks.overKt
        fastopen = profile.shadowsocks.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': '127.0.0.1',
          'server_port': parseInt(this.config.kcptun.clientPort),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocks.overKtPort),
          'password': profile.shadowsocks.password,
          'timeout': 20,
          'method': profile.shadowsocks.method,
          'fast_open': fastopen,
          'mode': 'tcp_only'
        }
        break
      case this.config.shadowsocksr.client:
        cfg = this.config.shadowsocksr.client
        fastopen = profile.shadowsocksr.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': profile.shadowsocksr.address,
          'server_port': parseInt(profile.shadowsocksr.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocksr.clientPort),
          'password': profile.shadowsocksr.password,
          'timeout': parseInt(profile.shadowsocksr.timeout),
          'method': profile.shadowsocksr.method,
          'fast_open': fastopen,
          'mode': 'tcp_only',
          'protocol': profile.shadowsocksr.protocol,
          'protocol_param': profile.shadowsocksr.protocol_param,
          'obfs': profile.shadowsocksr.obfs,
          'obfs_param': profile.shadowsocksr.obfs_param
        }
        profile.shadowsocksr.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.shadowsocksr.overKt:
        cfg = this.config.shadowsocksr.overKt
        fastopen = profile.shadowsocksr.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': '127.0.0.1',
          'server_port': parseInt(this.config.kcptun.clientPort),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.shadowsocksr.overKtPort),
          'password': profile.shadowsocksr.password,
          'timeout': 20,
          'method': profile.shadowsocksr.method,
          'fast_open': fastopen,
          'mode': 'tcp_only',
          'protocol': profile.shadowsocksr.protocol,
          'protocol_param': profile.shadowsocksr.protocol_param,
          'obfs': profile.shadowsocksr.obfs,
          'obfs_param': profile.shadowsocksr.obfs_param
        }
        profile.shadowsocksr.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            content[k.trim()] = v.trim()
          }
        })
        break
      case this.config.tunnelDns.dns:
        cfg = this.config.tunnelDns.dns
        const isSsr = profile.proxies.includes('ssr')
        const server = isSsr ? profile.shadowsocksr : profile.shadowsocks
        fastopen = server.fastopen
        if (typeof fastopen === 'string') {
          fastopen = fastopen === 'true'
        }
        content = {
          'server': server.address,
          'server_port': parseInt(server.port),
          'local_address': '0.0.0.0',
          'local_port': parseInt(this.config.tunnelDns.dnsPort),
          'password': server.password,
          'timeout': parseInt(server.timeout),
          'method': server.method,
          'fast_open': fastopen,
          'tunnel_address': '8.8.8.8:53',
          'mode': 'udp_only'
        }
        if (isSsr) {
          const moreFields = ['protocol', 'protocol_param', 'obfs', 'obfs_param']
          moreFields.forEach((field) => {
            content[field] = server[field]
          })
          server.others.split(';').forEach((kv) => {
            if (kv.trim()) {
              const [k, v] = kv.split('=')
              content[k.trim()] = v.trim()
            }
          })
        }
        break
      case this.config.kcptun.client:
        cfg = this.config.kcptun.client
        content = {
          'remoteaddr': `${profile.kcptun.address}:${profile.kcptun.port}`,
          'localaddr': `:${this.config.kcptun.clientPort}`,
          'key': profile.kcptun.key,
          'crypt': profile.kcptun.crypt,
          'mode': profile.kcptun.mode
        }
        profile.kcptun.others.split(';').forEach((kv) => {
          if (kv.trim()) {
            const [k, v] = kv.split('=')
            const value = v.trim().replace(/"/g, '')
            const key = k.trim()
            // kcptun can not parse a config file with quote-wrapped value of number/boolean
            if (/^\d+$/g.test(value)) {
              content[key] = parseInt(value)
            } else if (/^true|false$/g.test(value)) {
              content[key] = value === 'true'
            } else {
              content[key] = value
            }
          }
        })
        break
      default:
        throw Error(`unkown type: ${type}`)
    }
    const cfgPath = path.join(this.config.host.configDir, cfg)
    await fs.writeJson(cfgPath, content, {spaces: 2})
    return cfgPath
  }

  async generateNetworkPlist () {
    const content = String.raw`
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>${this.config.host.networkPlistName}</string>

        <key>ProgramArguments</key>
        <array>
            <string>${path.join(this.config.host.configDir, this.config.host.networkSh)}</string>
        </array>

        <key>WatchPaths</key>
        <array>
            <string>/etc/resolv.conf</string>
            <string>/Library/Preferences/SystemConfiguration/NetworkInterfaces.plist</string>
            <string>/Library/Preferences/SystemConfiguration/com.apple.airport.preferences.plist</string>
        </array>

        <key>RunAtLoad</key>
        <true/>
        <key>StandardErrorPath</key>
        <string>${path.join(os.tmpdir(), path.basename(this.config.host.networkSh, '.sh') + '.log')}</string>
        <key>StandardOutPath</key>
        <string>${path.join(os.tmpdir(), path.basename(this.config.host.networkSh, '.sh') + '.log')}</string>
      </dict>
    </plist>`

    const cfgPath = path.join(this.config.host.configDir, this.config.host.networkPlist)
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }

  async generateNetworkSh () {
    // TODO: reduce log size
    const username = await this.localExec('whoami')
    const content = String.raw`#!/bin/bash
    echo "$(date)"
    echo "Network change"
    echo "==============="
scutil_query() {
    key=$1

    scutil<<EOT
    open
    get $key
    d.show
    close
EOT
}

get_primary_service() {
    local SERVICE_GUID=$(scutil_query State:/Network/Global/IPv4 | grep "PrimaryService" | awk '{print $3}')

    local SERVICE_NAME=$(scutil_query Setup:/Network/Service/$SERVICE_GUID | grep "UserDefinedName" | awk -F': ' '{print $2}')

    echo $SERVICE_NAME
}

get_primary_router() {
    local ROUTER_IP=$(scutil_query State:/Network/Global/IPv4 | grep "Router" | awk '{print $3}')
    echo $ROUTER_IP
}

VROUTERIP="${this.config.vrouter.ip}"
VROUTERNAME="${this.config.vrouter.name}"

# current router
ROUTERIP=$(get_primary_router)
echo "ROUTERIP: $ROUTERIP"
INTERFACE=$(get_primary_service)
echo "INTERFACE: $INTERFACE"

# check gateway & dns
GATEWAY=$(route -n get default | grep gateway | awk '{print $2}')
echo "GATEWAY: $GATEWAY"
DNS=$(/usr/sbin/networksetup -getdnsservers "$INTERFACE")
# echo "DNS: $DNS"

# check vm status
VMSTATE=$(su ${username.trim()} -c "/usr/local/bin/VBoxManage list runningvms | grep $VROUTERNAME")
echo "VMState: $VMSTATE"

# change route/dns
if [[ $GATEWAY ==  $VROUTERIP && $DNS != $VROUTERIP ]]; then
    if [[ -z $VMSTATE ]]; then
        echo "# vm is stopped. reset gateway to router"
        sudo /sbin/route change default $ROUTERIP
    else
        echo "# vm is running. change dns to vrouter"
        sudo /usr/sbin/networksetup -setdnsservers "$INTERFACE" "$VROUTERIP"
    fi
fi

if [[ $GATEWAY != $VROUTERIP && $DNS == $VROUTERIP ]]; then
    if [[ -z $VMSTATE ]]; then
        echo "# vm is stopped. reset DNS to router"
        sudo /usr/sbin/networksetup -setdnsservers "$INTERFACE" "$ROUTERIP"
    else
        echo "#vm is running. change gateway to vrouter"
        sudo /sbin/route change default $VROUTERIP
    fi
fi
echo ""`

    const cfgPath = path.join(this.config.host.configDir, this.config.host.networkSh)
    await fs.outputFile(cfgPath, content, 'utf8')
    return cfgPath
  }

  async upgradeCfgV1 (newCfg) {
    // const template = path.join(__dirname, '..', 'config', 'config.json')
    // const newCfg = fs.readJsonSync(template)
    if (this.config.version === newCfg.version) {
      return
    }
    if (!this.config.version) {
      // version 0.1 to 0.2
      const ssFields = ['address', 'port', 'password', 'timeout', 'method', 'fastopen']
      ssFields.forEach((field) => {
        newCfg.shadowsocks.server[field] = this.config.shadowsocks.server[field]
      })
      const ktFields = ['address', 'port', 'key', 'crypt', 'mode']
      const others = []
      Object.keys(this.config.kcptun.server).forEach((key) => {
        if (ktFields.includes(key)) {
          newCfg.kcptun.server[key] = this.config.kcptun.server[key]
        } else {
          others.push(`${key}=${this.config.kcptun.server[key]}`)
        }
      })
      newCfg.kcptun.server.others = others.join(';')

      newCfg.firewall.currentMode = this.config.firewall.currentMode
      const dict = {
        'shadowsocks': 'ss',
        'kcptun': 'ssKt'
      }
      newCfg.firewall.currentProxies = dict[this.config.firewall.currentProtocol]

      newCfg.host.configDir = this.config.host.configDir
      this.config = newCfg

      const thirdParty = path.join(__dirname, '..', 'third_party')
      const remote = await this.connect()
      await remote.scp(`${thirdParty}/ssr-tunnel`, '/usr/bin/')
      await remote.scp(`${thirdParty}/ssr-redir`, '/usr/bin/')
      await remote.remoteExec('chmod +x /usr/bin/ssr-*')
      await remote.remoteExec('opkg update && opkg install libopenssl')
      await remote.service('shadowsocks', 'stop').catch(() => {})
      await remote.service('kcptun', 'stop').catch(() => {})
      await remote.remoteExec('rm /etc/com.icymind.vrouter/ss-dns.json').catch(() => {})
      // await remote.changeProxies()
      await remote.closeConn()
    }
  }
  async upgradeCfgV2 (newCfg) {
    // const template = path.join(__dirname, '..', 'config', 'config.json')
    // const newCfg = fs.readJsonSync(template)
    if (this.config.version === '0.2') {
      const profiles = []
      // 如果ss地址不是123123...拷贝到newCfg
      // 同理ssr/kcptun
      const oldSS = this.config.shadowsocks.server
      const oldSSR = this.config.shadowsocksr.server
      const oldKT = this.config.kcptun.server
      if (oldSS.address && oldSS.address !== '123.123.123.123') {
        const profile = {
          'name': '配置oo',
          'mode': 'whitelist',
          'proxies': 'ss',
          'relayUDP': false,
          'enableTunnelDns': true,
          'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
          'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
          'shadowsocks': oldSS
        }
        profiles.push(profile)
      }
      if (oldSSR.address && oldSSR.address !== '123.123.123.123') {
        const profile = {
          'name': '配置xx',
          'mode': 'blacklist',
          'proxies': 'ssr',
          'relayUDP': false,
          'enableTunnelDns': true,
          'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
          'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
          'shadowsocksr': oldSSR
        }
        profiles.push(profile)
      }
      if (oldKT.address && oldKT.address !== '123.123.123.123') {
        const profile = {
          'name': '配置tt',
          'mode': 'whitelist',
          'proxies': 'ssKt',
          'relayUDP': false,
          'enableTunnelDns': true,
          'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
          'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
          'shadowsocks': oldSS,
          'kcptun': oldKT
        }
        profiles.push(profile)
      }
      if (profiles.length !== 0) {
        newCfg.profiles.profiles = profiles
      }
      newCfg.host.configDir = this.config.host.configDir
      this.config = newCfg
      await this.installNwWatchdog()
    }
  }
  parseProfileURI (uri) {
    let profile = {
      'name': '配置xx',
      'action': 'new',
      'mode': 'whitelist',
      'proxies': 'ss',
      'relayUDP': false,
      'enableTunnelDns': true,
      'selectedBL': {'gfwDomains': true, 'extraBlackList': true},
      'selectedWL': {'chinaIPs': true, 'lanNetworks': true, 'extraWhiteList': true},
      'shadowsocks': {
        'address': '123.123.123.123',
        'port': '8989',
        'password': 'demo-paswd',
        'timeout': 300,
        'method': 'chacha20',
        'fastopen': false
      },
      'shadowsocksr': {
        'address': '123.123.123.123',
        'port': '9999',
        'password': 'demo-paswd',
        'timeout': 300,
        'method': 'chacha20',
        'protocol': 'auth_aes128_md5',
        'protocol_param': '32',
        'obfs': 'tls1.2_ticket_auth',
        'obfs_param': '',
        'others': '',
        'fastopen': false
      },
      'kcptun': {
        'address': '',
        'port': '',
        'key': 'demo-secret',
        'crypt': 'aes-128',
        'mode': 'fast2',
        'others': 'sndwnd=256;rcvwnd=2048;nocomp=true'
      }
    }
    let type = uri.substr(0, uri.indexOf(':'))
    if (type === 'ssr') {
      profile.proxies = 'ssr'
      let decode = Buffer.from(uri.substr(6), 'base64').toString()
      const separatorIndex = decode.indexOf('/?')
      let config = decode.substr(0, separatorIndex).split(':')
      config[config.length - 1] = Buffer.from(config[config.length - 1], 'base64').toString()
      ;[profile.shadowsocksr.address, profile.shadowsocksr.port, profile.shadowsocksr.protocol, profile.shadowsocksr.method, profile.shadowsocksr.obfs, profile.shadowsocksr.password] = config

      config = decode.substr(separatorIndex + 2).split('&')
      config.forEach((pair) => {
        let [key, value] = pair.split('=')
        value = Buffer.from(value, 'base64').toString()
        switch (key) {
          case 'obfsparam':
            profile.shadowsocksr.obfs_param = value
            break
          case 'protoparam':
            profile.shadowsocksr.protocol_param = value
            break
          case 'remarks':
            profile.name = value
            break
          case 'group':
            break
          default:
            profile.shadowsocksr.others += `${key}=${value};`
        }
      })
    } else if (type === 'ss') {
      profile.proxies = 'ss'
      const nameIndex = uri.lastIndexOf('#')
      if (nameIndex >= 0) {
        profile.name = decodeURIComponent(uri.substr(nameIndex + 1))
      }
      const separatorIndex = uri.indexOf('@')
      if (separatorIndex > 0) {
        // https://shadowsocks.org/en/spec/SIP002-URI-Scheme.html
        // ss://YmYtY2ZiOnRlc3Q@192.168.100.1:8888/?plugin=url-encoded-plugin-argument-value&unsupported-arguments=should-be-ignored#Dummy+profile+name
        let decode = Buffer.from(uri.substr(5, separatorIndex - 5), 'base64').toString()
        ;[profile.shadowsocks.method, profile.shadowsocks.password] = decode.split(':')

        const pluginIndex = uri.indexOf('?plugin')
        if (pluginIndex < 0) {
          // without plugin
          decode = uri.substr(separatorIndex + 1, nameIndex < 0 ? undefined : nameIndex - separatorIndex - 1)
          ;[profile.shadowsocks.address, profile.shadowsocks.port] = decode.split(':')
        } else {
          // with plugin
          decode = uri.substr(separatorIndex + 1, pluginIndex - separatorIndex - 1)
          ;[profile.shadowsocks.address, profile.shadowsocks.port] = decode.split(':')

          let plugin = uri.substr(pluginIndex + '?plugin'.length + 1, nameIndex - 1 - pluginIndex - '?plugin'.length)
          let config = decodeURIComponent(plugin).split(';')
          if (config[0] !== 'kcptun') {
            throw Error(`unsupported plugin: ${config[0]}`)
          } else {
            profile.proxies = 'ssKt'
            let others = ''
            config.slice(1).forEach((pair) => {
              let [key, value] = pair.split('=')
              switch (key) {
                case 'mode':
                case 'key':
                case 'crypt':
                  profile.kcptun[key] = value
                  break
                default:
                  others += `${pair};`
              }
            })
            profile.kcptun.address = profile.kcptun.address || profile.shadowsocks.address
            profile.kcptun.port = profile.kcptun.port || profile.shadowsocks.port
            profile.kcptun.others = others === '' ? profile.kcptun.others : others
          }
        }
      } else {
        // https://shadowsocks.org/en/config/quick-guide.html
        // ss://YmYtY2ZiOnRlc3RAMTkyLjE2OC4xMDAuMTo4ODg4Cg#example-server
        let index = uri.indexOf('#')
        let decode = Buffer.from(uri.substr(5, index < 0 ? undefined : nameIndex - 5), 'base64').toString()
        let config = decode.split('@')
        ;[profile.shadowsocks.address, profile.shadowsocks.port, profile.shadowsocks.method, profile.shadowsocks.password] = [...config[1].split(':'), ...config[0].split(':')]
      }
    } else {
      throw Error('unsupported URI')
    }
    return profile
  }
  async copyTemplate (fileName) {
    const template = path.join(__dirname, '..', 'config', fileName)
    const dest = path.join(this.config.host.configDir, fileName)
    try {
      await fs.stat(dest)
      return dest
    } catch (error) {
      winston.debug(`copy template: ${fileName}`)
      await fs.copy(template, dest)
      return dest
    }
  }
}
module.exports = {
  VRouter
}
