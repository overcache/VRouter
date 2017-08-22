/* eslint-env mocha */
/* eslint no-unused-expressions: "off" */
const path = require('path')
const fs = require('fs-extra')
const { expect } = require('chai')
const { VRouter } = require('../js/vrouter.js')
// const { Utils } = require('../js/utils.js')
const { VBox } = require('../js/vbox.js')
const { EventEmitter } = require('events')

describe('Test Suite for vroute.js', function () {
  let vrouter = null
  before('build vrouter', async function () {
    this.timeout(500000)
    const p = path.join(__dirname, '..', 'config', 'newconfig.json')
    const cfg = fs.readJsonSync(p)
    cfg.cfgDirName = 'vrouter-test'
    cfg.virtualbox.hostonlyInfIP = '10.10.10.10'
    cfg.virtualbox.macaddress = '080027a8b844'
    cfg.openwrt.ip = '10.10.10.11'
    cfg.virtualbox.vmName = 'abcd'
    vrouter = new VRouter(cfg)

    await fs.remove(path.join(__dirname, 'config')).catch()
    await VBox.delete(vrouter.name)
    // await fs.remove(vrouter.cfgDirPath).catch()
    await fs.copy(path.join(__dirname, '../config'), path.join(__dirname, 'config'))
    const process = new EventEmitter()
    process.on('init', info => console.log(info))
    await vrouter.build(process)
    await VBox.lockGUIConfig(vrouter.name, false)
    await VBox.hide(vrouter.name, false)
  })
  it('#getIP(br-lan) should return 10.10.10.11', async function () {
    const ip = await vrouter.getIP('br-lan')
    expect(ip).to.be.equal('10.10.10.11')
  })
  it('#getMacAddress', async function () {
    const mac = await vrouter.getMacAddress('eth1')
    const pattern = /.*:.*:.*:.*:.*:.*/mg
    expect(pattern.test(mac)).to.be.true
  })
  it('#getLan should return ip', async function () {
    const ip = await vrouter.getLan()
    expect(ip).to.be.equal('10.10.10.11')
  })
  it('#getWan should return ip', async function () {
    const ip = await vrouter.getWan()
    const pattern = /^\d+.\d+.\d+.\d+$/
    expect(pattern.test(ip)).to.be.true
  })
  it('#getOpenwrtVersion should return 15.05.1', async function () {
    const version = await vrouter.getOpenwrtVersion()
    expect(version).to.be.equal('15.05.1')
  })
  it('#getSsVersion with type=ss should return 3.0.8', async function () {
    const version = await vrouter.getSsVersion('shadowsocks', vrouter.config.proxiesInfo)
    expect(version).to.be.equal('3.0.8')
  })
  it('#getSsVersion with type=ssr should return 2.5.6', async function () {
    const version = await vrouter.getSsVersion('shadowsocksr', vrouter.config.proxiesInfo)
    expect(version).to.be.equal('2.5.6')
  })
  it('#getKtVersion should return 20170525', async function () {
    const version = await vrouter.getKtVersion(vrouter.config.proxiesInfo)
    expect(version).to.be.equal('20170525')
  })
  it('#setupProxies', async function () {
    const activedProfile = vrouter.config.profiles.filter(profile => profile.active === true)[0]
    const proxies = activedProfile.proxies
    const proxiesInfo = vrouter.config.proxiesInfo
    // await vrouter.scpProxiesCfgs(activedProfile, vrouter.config.proxiesInfo, '/etc/vrouter')
    // await vrouter.scpProxiesServices(activedProfile, vrouter.config.proxiesInfo, '/etc/vrouter')
    await vrouter.setupProxies(activedProfile, proxiesInfo, '/etc/vrouter')
    if (activedProfile.enableTunnelDns) {
      const b = await vrouter.isTunnelDnsRunning(proxies, proxiesInfo)
      expect(b).to.be.true
    }
    if (/kt/ig.test(proxies)) {
      const b = await vrouter.isKtRunning(proxiesInfo)
      expect(b).to.be.true
    }
    const b = await vrouter.isSsRunning(proxies, proxiesInfo)
    expect(b).to.be.true
  })
  it('#setupFirewall', async function () {
    const activedProfile = vrouter.config.profiles.filter(profile => profile.active === true)[0]
    const proxiesInfo = vrouter.config.proxiesInfo
    const firewallInfo = vrouter.config.firewallInfo
    await vrouter.setupFirewall(activedProfile, proxiesInfo, firewallInfo, '/etc/vrouter')
  })
  it('#setupDnsmasq', async function () {
    this.timeout(5000)
    const activedProfile = vrouter.config.profiles.filter(profile => profile.active === true)[0]
    const proxiesInfo = vrouter.config.proxiesInfo
    const firewallInfo = vrouter.config.firewallInfo
    await vrouter.setupDnsmasq(activedProfile, proxiesInfo, firewallInfo, '/etc/dnsmasq.d')
  })
  it('#applyProfile', async function () {
    this.timeout(5000)
    const activedProfile = vrouter.config.profiles.filter(profile => profile.active === true)[0]
    const proxiesInfo = vrouter.config.proxiesInfo
    const firewallInfo = vrouter.config.firewallInfo
    await vrouter.applyProfile(activedProfile, proxiesInfo, firewallInfo, '/etc/vrouter', '/etc/dnsmasq.d')
  })
})
