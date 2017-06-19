const path = require('path')

function getAppDir () {
  return process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : '/var/local')
}

module.exports = {
  getAppDir
}
