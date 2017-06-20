/* eslint-env mocha */
const fs = require('fs-extra')
const path = require('path')
var chai = require('chai')
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const { VRouter } = require(path.join(__dirname, '../src/js/vrouter-local.js'))
const configFile = path.join(__dirname, './config-test.json')

describe.skip('Test Suite for vrouter-remote', function () {
  // const SSVersion = '3.0.5'
  // const KTVersion = '20170329'
  // const OSVersion = 'CHAOS CALMER (15.05.1, r48532)'
  this.timeout(50000)
  let local
  let remote
  before('connect to vrouter', function () {
    local = new VRouter(JSON.parse(fs.readFileSync(configFile)))
    return local.configVMNetwork()
      .then(() => {
        return local.wait(500)
      })
      .then(() => {
        return local.isVRouterRunning()
          .catch(() => {
            return local.startVM()
              .then(() => {
                return local.wait(20000)
              })
          })
      })
      .then(() => {
        return local.connect()
      })
      .then((r) => {
        remote = r
      })
      .catch(err => console.log(err))
  })

  /*
   * after('close vrouter connection', function () {
   *   remote.close()
   *   return local.wait(500)
   *     .then(() => {
   *       return local.stopVM()
   *     })
   * })
   */

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
        result.forEach(p => console.log(p))
      })
  })

  it('Test getFile', function () {
    return remote.getFWUsersRules()
      .then(console.log)
  })

  it('Test Case for uptime', function () {
    const hours = new Date().getHours()
    return remote.getUptime()
      .then((output) => {
        const h = parseInt(output.split(':')[0], 10)
        expect(h).to.be.equal(hours)
      })
  })
})
