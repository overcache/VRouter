const myPath = require('path')

function getAppDir () {
  return process.env.APPDATA || (process.platform === 'darwin' ? myPath.join(process.env.HOME, 'Library', 'Application Support') : '/var/local')
}

module.exports = {
  getAppDir
}
