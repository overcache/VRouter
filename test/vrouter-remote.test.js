/* eslint-env mocha */
/* eslint no-unused-expressions: "off" */
const fs = require('fs-extra')
const path = require('path')
const os = require('os')
var chai = require('chai')
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const { VRouter } = require(path.join(__dirname, '../js/vrouter-local.js'))
const { VRouterRemote } = require(path.join(__dirname, '../js/vrouter-remote.js'))
const configFile = path.join(__dirname, '../config/config.json')

describe.skip('Test Suite for vrouter-remote', function () {
  // const SSVersion = '3.0.5'
  // const KTVersion = '20170329'
  // const OSVersion = 'CHAOS CALMER (15.05.1, r48532)'
  this.timeout(50000)
  let vrouter
  let remote
  before('connect to vrouter', async function () {
    vrouter = new VRouter(JSON.parse(fs.readFileSync(configFile)))
    const state = await vrouter.getVMState()
    if (state !== 'running') {
      await vrouter.startVM()
        .then(() => {
          return vrouter.wait(30000)
        })
    }
    await vrouter.connect()
      .then((r) => {
        remote = r
      })
      .catch(err => console.log(err))
  })

  after('close vrouter connection', function () {
    remote && remote.close()
  })

  it('connect should return a VRouterRemote object with correct properties', function () {
    return expect(remote instanceof VRouterRemote).to.be.true
  })
  it('remoteExec should be rejected when execute bad commands', function () {
    const promise = remote.remoteExec('non-existed')
    return expect(promise).to.be.rejected
  })
  it('Test Case for getSSVersion', function () {
    return expect(remote.getSSVersion())
      .to.eventually.match(/\d+\.\d+\.\d+/ig)
  })

  it('Test Case for getKTVersion', function () {
    return expect(remote.getKTVersion())
      .to.eventually.match(/\d{8}/ig)
  })

  it('Test Case for getOSVersion', function () {
    return expect(remote.getOSVersion())
      .to.be.eventually.match(/\w+ \w+ \(.*\)/ig)
  })

  it('Test Case for getBrlan', function () {
    return expect(remote.getBrlan())
      .to.eventually.match(/\d+\.\d+\.\d+\.\d+/ig)
  })

  it('Test Case for getWifilan', function () {
    return expect(remote.getWifilan())
      .to.eventually.match(/\d+\.\d+\.\d+.\d+/ig)
  })

  it('Test getProcess', function () {
    return Promise.all([
      remote.getSSProcess(),
      remote.getSSOverKTProcess(),
      remote.getSSDNSProcess(),
      remote.getKTProcess()
    ])
      .then((result) => {
        result.forEach(p => p && console.log(p))
      })
  })

  it('getFile: /etc/config/network must equal generateNetworkCfg()', function () {
    return remote.remoteExec('cat /etc/config/network')
      .then((output) => {
        return expect(output.trim().indexOf(remote.config.vrouter.ip) >= 0).to.be.true
      })
  })
  it('Test scp, verify with getFile.', function () {
    const tempName = `scp-testing-${Date.now()}.txt`
    const tempContent = 'hello world'
    const tempFile = path.join(os.tmpdir(), tempName)
    return fs.outputFile(tempFile, tempContent)
      .then(() => {
        // return expect(vrouter.scp(tempFile, '/'))
        // console.log(tempFile)
        return expect(vrouter.scp(tempFile, '/'))
          .to.be.fulfilled
      })
      .then(() => {
        return remote.getFile(`/${tempName}`)
      })
      .then((output) => {
        return expect(output).to.equal(tempContent)
      })
      .then(() => {
        return remote.remoteExec(`rm /${tempName}`)
      })
  })

  it('Test Case for uptime', function () {
    return remote.getUptime()
      .then((output) => {
        expect(output.indexOf('load average') >= 0).to.be.true
      })
  })
  it.skip('shutdown sould turn vrouter off.', function () {
    return expect(remote.shutdown()).to.be.fulfilled
  })

  it('restartFireall', function () {
    return expect(remote.restartFirewall()).to.be.fulfilled
  })
  it('restartDnsmasq', function () {
    const promise = remote.remoteExec('pgrep dnsmasq')
      .then((pid) => {
        return remote.restartDnsmasq()
          .then(() => {
            return remote.remoteExec('pgrep dnsmasq')
          })
          .then((newPid) => {
            return Promise.resolve(pid === newPid)
          })
      })
    return expect(promise).to.eventually.be.false
  })
  it('changeMode', function () {
    return remote.changeMode('whitelist', 'shadowsocks')
      .then(() => {
        return remote.getFWUsersRules()
          .then((output) => {
            const reg = /^iptables -t nat -A PREROUTING -d -p tcp -j REDIRECT --to-ports 1080$/mg
            expect(reg.test(output)).to.be.true
            // console.log(output)
          })
      })
      .then(() => {
        return remote.changeMode('blacklist', 'kcptun')
      })
      .then(() => {
        return remote.getFWUsersRules()
          .then((output) => {
            const reg = /^iptables -t nat -A PREROUTING -d -p tcp -m set --match-set BLACKLIST dst -j REDIRECT --to-port 1090$/mg
            expect(reg.test(output)).to.be.true
          })
      })
  })
  it('changeProtocol', function () {
    return remote.changeProtocol('shadowsocks', 'global')
      .then(() => {
        return remote.getFWUsersRules()
          .then((output) => {
            let reg = /^# workMode: global/mg
            expect(reg.test(output)).to.be.true
            reg = /^iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 1080$/mg
            expect(reg.test(output)).to.be.true
            // console.log(output)
          })
      })
      .then(() => {
        return remote.changeProtocol('kcptun', 'whitelist')
      })
      .then(() => {
        return remote.getFWUsersRules()
          .then((output) => {
            let reg = /^# workMode: whitelist$/mg
            expect(reg.test(output)).to.be.true
            reg = /^iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 1090$/mg
            expect(reg.test(output)).to.be.true
            // console.log(output)
          })
      })
  })
})
