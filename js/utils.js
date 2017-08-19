const { URL } = require('url')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const fs = require('fs-extra')
const dns = require('dns')
const crypto = require('crypto')
const { decompress } = require('decompress')

class Utils {
  static downloadFile (src, dest) {
    const protocol = (new URL(src)).protocol
    const method = protocol === 'https:' ? https : http
    const tmp = path.join(os.tmpdir(), path.basename(src))
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tmp)
      method.get(src, (response) => {
        response.pipe(file)
        file.on('finish', async () => {
          file.close()
          return fs.copy(tmp, dest)
            .then(() => {
              return resolve(dest)
            })
            .catch((err) => {
              return reject(err)
            })
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

  static unzip (input, output) {
    return decompress(input, output)
      .then(files => {
        return files
      })
  }

  static wait (time) {
    return new Promise(resolve => setTimeout(resolve, time))
  }

  async hashFile (file) {
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
}

module.exports = {
  Utils
}
