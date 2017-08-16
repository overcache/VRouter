const { Client } = require('ssh2')

class Openwrt {
  constructor (config) {
    this.ip = config.ip
    this.port = config.port || '22'
    this.username = config.username
    this.passwd = config.passwd
    this.conn = null
  }

  /*
   * 连接到远程openwrt
   * @param {int} heartbeat 多少毫秒发送一次心跳包
   * @param {int} timeout 连接前的等待时间(毫秒)
   * @return {promise} 当连接成功后resovle
   */
  connect (heartbeat = 300000, timeout = 2000) {
    this.conn = new Client()
    return new Promise((resolve, reject) => {
      this.conn.on('ready', () => {
        resolve()
      }).on('close', () => {
        this.conn = null
      }).connect({
        host: this.ip,
        port: this.port,
        username: this.username,
        password: this.passwd,
        keepaliveInterval: heartbeat,
        readyTimeout: timeout
      })
    })
  }

  /*
   * 在远程openwrt上执行命令. 一些特殊的命令, 即使成功执行, 也会返回stderr
   * @param {string} cmd 待执行命令
   * @return {promise}
   */
  async execute (cmd) {
    if (this.conn === null) {
      await this.connect()
    }
    const specialCmds = [
      '/etc/init.d/firewall restart'
    ]
    return new Promise((resolve, reject) => {
      this.conn.exec(cmd, (err, stream) => {
        if (err) reject(err)
        let stdout = ''
        let stderr = ''
        stream.on('data', (data) => {
          stdout += data
        })
        stream.stderr.on('data', (data) => {
          stderr += data
        })
        stream.on('end', () => {
          if (stderr) {
            if (specialCmds.includes(cmd)) {
              resolve(stderr.toString().trim())
            } else {
              reject(stderr.toString().trim())
            }
          } else {
            resolve(stdout.toString().trim())
          }
        })
      })
    })
  }

  /*
   * 管理service
   * @param {string} name service名称
   * @param {string} action 待执行动作: start/stop/restart/enable/disable
   * @return {promise}
   */
  manageService (name, action) {
    const cmd = `/etc/init.d/${name} ${action}`
    return this.execute(cmd)
  }

  async getIP (inf) {
    const cmd = `ifconfig ${inf} | grep 'inet addr'`
    const output = await this.execute(cmd)
    const reg = /^inet addr:(\d+.\d+.\d+.\d+)/
    const match = reg.exec(output.trim())
    return (match && match[1]) || ''
  }
  getMacAddress (inf = 'eth1') {
    const cmd = `cat /sys/class/net/${inf}/address`
    return this.execute(cmd)
  }
  getLan () {
    const cmd = 'ifconfig br-lan | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.execute(cmd)
  }
  getWan () {
    const cmd = 'ifconfig eth1 | grep "inet addr" | cut -d: -f2 | cut -d" " -f1'
    return this.execute(cmd)
  }
  getOpenwrtVersion () {
    const cmd = 'cat /etc/openwrt_version'
    return this.execute(cmd)
  }

  // shadowsocks
  installSs () {
    const cmd = `ls ${this.config.vrouter.configDir}/third_party/*.ipk | xargs opkg install`
    return this.remoteExec(cmd)
  }
  getSsVersion (type = 'ss') {
    const cmd = `${type}-redir -h | grep "shadowsocks-libev" | cut -d" " -f2`
    return this.execute(cmd)
  }
  async isSsRunning (type = 'ss', plugin) {
    const fileName = !plugin ? `${type}-client.json` : `${type}-over-kt.json`
    const cmd = `ps -w | grep "${type}-redir -c .*${fileName}"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // shadowsocksr
  installSsr () {
    const cmd = `mv ${this.config.vrouter.configDir}/third_party/ssr-* /usr/bin/ && chmod +x /usr/bin/ssr-*`
    return this.execute(cmd)
  }

  async isTunnelDnsRunning (type = 'ss') {
    const cmd = `ps -w| grep "${type}-tunnel -c .*tunnel-dns.jso[n]"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // kcptun
  installKt () {
    // const cmd = `tar -xvzf ${this.config.vrouter.configDir}/third_party/kcptun*.tar.gz ` +
      // ` && rm server_linux_* && mv client_linux* /usr/bin/kcptun`
    const cmd = `mv ${this.config.vrouter.configDir}/third_party/kcptun /usr/bin/ && chmod +x /usr/bin/kcptun`
    return this.execute(cmd)
  }
  getKtVersion () {
    const cmd = 'kcptun --version | cut -d" " -f3'
    return this.execute(cmd)
  }
  async isKtRunning () {
    const cmd = 'ps | grep "[k]cptun -c"'
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }
}

module.exports = {
  Openwrt
}
