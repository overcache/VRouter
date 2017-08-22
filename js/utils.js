const { URL } = require('url')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const dns = require('dns')
const crypto = require('crypto')
const zlib = require('zlib')
const { Mac } = require('./mac.js')
const NetcatClient = require('netcat').client
const { exec } = require('child_process')
const sudo = require('sudo-prompt')
const winston = require('winston')
winston.level = 'error'

const platform = os.platform()

class Utils {
  static execute (command) {
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

  static downloadFile (src) {
    const protocol = (new URL(src)).protocol
    const method = protocol === 'https:' ? https : http
    const tmp = path.join(os.tmpdir(), path.basename(src))
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmp)
      method.get(src, (response) => {
        response.pipe(file)
        file.on('finish', () => {
          file.close()
          return resolve(tmp)
        })
      }).on('error', (err) => {
        fs.unlink(tmp)
        return reject(err)
      })
    })
  }

  static resolveDomain (domain) {
    const ipPatthen = /^\d+.\d+.\d+.\d+$/ig
    if (ipPatthen.test(domain)) {
      return Promise.resolve(domain)
    }
    return new Promise((resolve, reject) => {
      dns.lookup(domain, { family: 4 }, (err, address, family) => {
        if (err) {
          reject(err)
        }
        resolve(address)
      })
    })
  }

  static gunzip (input, output) {
    const gunzip = zlib.createGunzip()
    const inStream = fs.createReadStream(input)
    const outStream = fs.createWriteStream(output)
    inStream.pipe(gunzip).pipe(outStream)
    return new Promise((resolve, reject) => {
      outStream.on('finish', function () {
        resolve(output)
      })
    })
  }

  static wait (time) {
    return new Promise(resolve => setTimeout(resolve, time))
  }

  static async hashFile (file) {
    try {
      fs.statSync(file)
    } catch (err) {
      winston.error(err)
      return Promise.resolve('')
    }
    const algo = 'sha256'
    const shasum = crypto.createHash(algo)
    const s = fs.ReadStream(file)
    return new Promise((resolve, reject) => {
      s.on('data', function (d) { shasum.update(d) })
      s.on('end', function () {
        var d = shasum.digest('hex')
        resolve(d)
      })
    })
  }

  static getAppDir () {
    return process.env.APPDATA || (platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : '/var/local')
  }

  static getActiveAdapter () {
    switch (platform) {
      case 'darwin':
        return Mac.getActiveAdapter()
      default:
        return Mac.getActiveAdapter()
    }
  }

  static async serialExec (file, command) {
    const nc = new NetcatClient()
    nc.unixSocket(file).enc('utf8')
      .connect()
      .send(`\n\n\n\n\n\n${command}\n\n`)
      .close()
  }

  static changeRouteTo (ip) {
    switch (platform) {
      case 'darwin':
        return Mac.changeRouteTo(ip)
    }
  }
  static resetRoute () {
    switch (platform) {
      case 'darwin':
        return Mac.resetRoute()
    }
  }
}

module.exports = {
  Utils
}
