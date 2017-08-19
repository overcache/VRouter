/* eslint-env mocha */
const path = require('path')
const fs = require('fs-extra')
const { VRouter } = require('../js/vrouter.js')
const { VBox } = require('../js/vbox.js')
const { Utils } = require('../js/utils.js')
const { EventEmitter } = require('events')

describe('Test Suite for vroute.js', function () {
  let vrouter = null
  before('build vrouter', async function () {
    this.timeout(500000)
    const p = path.join(__dirname, '..', 'config', 'config.json')
    const cfg = fs.readJsonSync(p)
    cfg.host.ip = '10.10.10.10'
    cfg.host.configDir = path.join(Utils.getAppDir(), 'VRouter-test')
    cfg.vrouter.ip = '10.10.10.11'
    cfg.vrouter.macaddress = '080027a8b844'
    cfg.vrouter.name = 'abcd'
    vrouter = new VRouter(cfg)
    await fs.remove(path.join(__dirname, 'config')).catch(() => {})
    await VBox.delete(vrouter.name)
    await fs.remove(cfg.host.configDir)
    await fs.copy(path.join(__dirname, '../config'), path.join(__dirname, 'config'))

    await vrouter.create()

    const process = new EventEmitter()
    process.on('init', info => console.log(info))
    await vrouter.init(process)
  })
  it('#getSsVersion', async function () {
    const version = await vrouter.getSsVersion('ss')
    console.log(version)
  })
})
