import Utils from './utils.js'
const winston = require('winston')
const fs = require('fs-extra')
const path = require('path')
//
const logFilePath = path.join(Utils.getAppDir(), 'vrouter', 'vrouter.log')
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
    level: 'debug'
  }))
} else {
  winston.level = 'info'
  transports.push(new (winston.transports.File)({
    filename: logFilePath,
    level: 'info',
    timestamp: function () {
      return +new Date()
    }
  }))
}

winston.configure({ transports })

export default winston
