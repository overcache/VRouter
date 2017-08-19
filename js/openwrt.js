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
}

module.exports = {
  Openwrt
}
