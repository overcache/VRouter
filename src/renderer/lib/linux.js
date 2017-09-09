// import logger from './logger'
const { exec } = require('child_process')
const sudo = require('sudo-prompt')

function execute (command) { // eslint-disable-line
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
function sudoExec (cmd, options = {name: 'VRouter'}) { // eslint-disable-line
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

class Linux {
  static async getActiveAdapter () {
    console.warn('fix me')
  }

  static async getCurrentGateway () {
    console.warn('fix me')
  }

  static async getCurrentDns () {
    console.warn('fix me')
  }

  static async trafficToVirtualRouter (infName, gateway) {
    console.warn('fix me')
  }

  static async trafficToPhysicalRouter (infName, ip, mask) {
    console.warn('fix me')
  }
}

export default Linux
