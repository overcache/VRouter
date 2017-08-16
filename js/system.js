const os = require('os')

class System {
  static getInfIP (inf) {
    const ifs = os.networkInterfaces()
    return ifs[inf][0].address
  }
}

module.exports = {
  System
}
