// import Utils from './utils.js'
const winston = require('winston')
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
//
const appDir = process.env.APPDATA || (os.platform() === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : '/var/local')
const logFilePath = path.join(appDir, 'vrouter', 'vrouter.log')
fs.ensureFileSync(logFilePath)

const transports = []

if (process.env.NODE_ENV === 'development') {
  winston.level = 'debug'
  transports.push(new (winston.transports.Console)({
    level: 'debug',
    timestamp: function () {
      return +new Date()
    }
  }))
  transports.push(new (winston.transports.File)({
    filename: logFilePath,
    json: false,
    level: 'debug'
  }))
} else {
  winston.level = 'info'
  transports.push(new (winston.transports.File)({
    filename: logFilePath,
    json: false,
    level: 'info',
    timestamp: function () {
      return +new Date()
    }
  }))
}

winston.configure({ transports })

const myLogger = {
  log: function (...msgs) {
    console.log(...msgs)
    winston.log(...msgs)
  },
  debug: function (...msgs) {
    console.log(...msgs)
    winston.debug(...msgs)
  },
  info: function (...msgs) {
    console.info(...msgs)
    winston.info(...msgs)
  },
  warn: function (...msgs) {
    console.warn(...msgs)
    winston.warn(...msgs)
  },
  error: function (...msgs) {
    console.error(...msgs)
    winston.error(...msgs)
  }
}

let logger = myLogger
if (process.env.NODE_ENV === 'development') {
  logger = myLogger
}

export default logger
// // for test
// export default myLogger
