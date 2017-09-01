// import VBox from './vbox.js'
// const path = require('path')
const { exec } = require('child_process')

function execute (command) {
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

class Win {
  static async getActiveAdapter () {
    const cmd = 'WMIC nic where "PhysicalAdapter = TRUE and NetConnectionStatus = 2" get InterfaceIndex,Name'

    // InterfaceIndex  Name
    // 11              Intel(R) 82577LM Gigabit Network Connection
    // 7               VirtualBox Host-Only Ethernet Adapter

    const headerIncludedIfs = await execute(cmd)
    const physicalIfs = []

    const indexAndNamePattern = /^(\d+)\s*(.*)$/i // 注意不要添加 g 标志
    headerIncludedIfs.split('\n').slice(1).forEach(line => {
      const matchResult = indexAndNamePattern.exec(line.trim())
      if (matchResult && !/virtualbox/ig.test(matchResult[2])) {
        physicalIfs.push({
          index: parseInt(matchResult[1].trim()),
          infName: matchResult[2]
        })
      }
    })
    return physicalIfs[0].infName
  }
}

export default Win
