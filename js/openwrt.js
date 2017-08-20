const { Client } = require('ssh2')
const path = require('path')

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
  changeTZ (name) {
    const subCmds = []
    subCmds.push(`uci set system.@system[0].hostname='${name}'`)
    subCmds.push("uci set system.@system[0].timezone='HKT-8'")
    subCmds.push("uci set system.@system[0].zonename='Asia/Hong Kong'")
    subCmds.push('uci commit system')
    return this.execute(subCmds.join(' && '))
  }
  turnOnFastOpen () {
    const cmd = 'echo "net.ipv4.tcp_fastopen = 3" >> /etc/sysctl.conf && sysctl -p /etc/sysctl.conf'
    return this.execute(cmd)
  }

  changePwd (username = 'root', passwd = 'root') {
    const cmd = `"echo -e '${passwd}\\n${passwd}' | (passwd ${username})"`
    return this.execute(cmd)
  }

  installCronJob (content) {
    const cmd = `echo "${content}" > /tmp/vroutercron && crontab /tmp/vroutercron && rm /tmp/vroutercron`
    return this.execute(cmd)
  }

  async scp (src, dest) {
    if (!this.conn) {
      await this.connect()
    }
    let isDestDir = false
    if (dest.endsWith('/')) {
      isDestDir = true
      await this.execute(`mkdir -p ${dest}`)
    } else {
      await this.execute(`mkdir -p ${path.dirname(dest)}`)
    }

    let files
    try {
      const names = require('fs').readdirSync(src)
      files = names.map(name => `${src}/${name}`)
    } catch (error) {
      if (error.code === 'ENOTDIR') {
        files = [src]
      } else {
        throw error
      }
    }
    const promises = []
    for (let i = 0; i < files.length; i++) {
      const p = new Promise((resolve, reject) => {
        let s = files[i]
        let d = isDestDir ? `${dest}${path.basename(files[i])}` : dest
        this.conn.sftp((err, sftp) => {
          err && reject(err)
          sftp.fastPut(s, d, (err) => {
            err ? reject(err) : resolve()
          })
        })
      })
      promises.push(p)
    }
    return Promise.all(promises)
  }

  // dnsmasq
  configDnsmasq () {
    const cmd = "mkdir /etc/dnsmasq.d && echo 'conf-dir=/etc/dnsmasq.d/' > /etc/dnsmasq.conf"
    return this.execute(cmd)
  }

  // shadowsocks
  async installSs () {
    const src = path.join(__dirname, '..', 'third_party', 'shadowsocks.tar.gz')
    const dst = '/tmp/shadowsocks/shadowsocks.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && ls ${dstDir}/*.ipk | xargs opkg install && rm -rf /tmp/shadowsocks`
    return this.execute(cmd)
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
  async installSsr () {
    const src = path.join(__dirname, '..', 'third_party', 'shadowsocksr.tar.gz')
    const dst = '/tmp/shadowsocksr/shadowsocksr.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && mv ${dstDir}/ssr-* /usr/bin/ && chmod +x /usr/bin/ssr-* && rm -rf /tmp/shadowsocksr`
    return this.execute(cmd)
  }

  async isTunnelDnsRunning (type = 'ss') {
    const cmd = `ps -w| grep "${type}-tunnel -c .*tunnel-dns.jso[n]"`
    const output = await this.execute(cmd)
    return output.trim() !== ''
  }

  // kcptun
  async installKt () {
    // const cmd = `tar -xvzf ${this.config.vrouter.configDir}/third_party/kcptun*.tar.gz ` +
      // ` && rm server_linux_* && mv client_linux* /usr/bin/kcptun`
    const src = path.join(__dirname, '..', 'third_party', 'kcptun.tar.gz')
    const dst = '/tmp/kcptun/kcptun.tar.gz'
    const dstDir = path.dirname(dst)
    await this.scp(src, dst)
    const cmd = `cd ${dstDir} && tar xzf ${dst} && mv ${dstDir}/kcptun /usr/bin/ && chmod +x /usr/bin/kcptun && rm -rf /tmp/kcptun`
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

  async installProxies () {
    await this.installSs()
    await this.installSsr()
    await this.installKt()
  }

  async setupProxies () {

  }
  async setupIPset () {

  }
  async setupFirewall () {

  }
  async setupDnsmasq () {

  }
  async setupWatchdog () {

  }
}

module.exports = {
  Openwrt
}
