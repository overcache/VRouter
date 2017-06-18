/* eslint-env mocha */
const path = require('path')
// const rewire = require('rewire')
const os = require('os')
const fs = require('fs')
var chai = require('chai')
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const { VRouter } = require(path.join(__dirname, '../src/js/vrouter.js'))
// const { getConfig } = require(path.join(__dirname, '../src/js/helper.js'))
const configFile = path.join(__dirname, './config-test.json')
const vmFile = path.join(os.homedir(), 'Desktop', 'com.icymind.test.ova')
// const vmName = path.basename(vmFile, '.ova')

describe('Test Suite for VRouterLocal', function () {
  const vrouter = new VRouter(JSON.parse(fs.readFileSync(configFile)))
  before('import test-vm', function () {
    return vrouter.isVRouterExisted()
      .catch((err) => {
        console.log(err)
        return vrouter.importVM(vmFile)
      })
  })

  /*
   * after('remove test-vm', async function () {
   *   const func = lib.__get__('deleteVM')
   *   return func()
   * })
   */

  it('isVBInstalled show return no-error', function () {
    return expect(vrouter.isVBInstalled()).to.be.fullfilled
  })

  it('isVRouterExisted should works well', function () {
    return Promise.all([
      expect(vrouter.isVRouterExisted()).to.be.fullfilled
    ])
  })

  it('isVRouterRunning should works well', function () {
    return vrouter.stopVM()
      .catch(() => {})
      .then(() => {
        expect(vrouter.isVRouterRunning()).to.be.rejectedWith(Error, 'vm not running')
      })
      .then(() => vrouter.startVM())
      .then(() => {
        return expect(vrouter.isVRouterRunning()).to.be.fullfilled
      })
      .then(() => vrouter.stopVM())
  })

  it('stopVM should be able stop a vm')

  it('startVM should be able start a vm')

  it('Test createHostonlyInf and removeHostonlyInf', function () {
    return vrouter.createHostonlyInf()
      .then(function (inf) {
        return Promise.resolve(() => {
          return expect(vrouter.localExec(`ifconfig ${inf}`)).to.be.fullfilled
        })
          .then(() => inf)
      })
      .then((inf) => {
        return vrouter.removeHostonlyInf(inf)
          .then(() => inf)
      })
      .then((inf) => {
        return expect(vrouter.localExec(`ifconfig ${inf}`)).to.be.rejected
      })
  })

  it.skip('getHostonlyInf should work', function () {
    return expect(vrouter.getHostonlyInf()).to.become(['vboxnet4', null])
  })

  it('configHostonlyInf should work', async function () {
    return vrouter.configHostonlyInf()
      .then((inf) => {
        return expect(vrouter.getInfIP(inf)).to.eventually.equal(vrouter.config.host.ip)
      })
  })

  it('isNIC2ConfigedAsBridged should works well', function () {
    this.timeout(5000)

    // 确保在测试完start/stopVM后再运行, 因为指定网络适配器为不存在会引起无法开机
    return vrouter.wait(2000)
      .then(() => vrouter.stopVM()).catch(() => {})
      .then(() => {
        const promise = vrouter.specifyBridgeAdapter()
        return expect(promise).to.be.fullfilled
      })
      .then(() => {
        return vrouter.wait(500)
      })
      .then(() => {
        const promise = vrouter.specifyHostonlyAdapter('vboxnet0', '2').then(console.log)
        return expect(promise).to.be.fullfilled
      })
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return expect(vrouter.isNIC2ConfigedAsBridged())
          .to.be.rejectedWith(Error, "NIC2 isn't bridged network")
      })
      .then(() => {
        const promise = vrouter.specifyBridgeAdapter('no-exist-inf')
        return expect(promise).to.be.fullfilled
      })
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return expect(vrouter.isNIC2ConfigedAsBridged())
          .to.be.rejectedWith(Error, 'ifconfig: interface no-exist-inf does not exist')
      })
      .then(() => {
        const promise = vrouter.specifyBridgeAdapter('en1: Thunderbolt 1')
        return expect(promise).to.be.fullfilled
      })
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return expect(vrouter.isNIC2ConfigedAsBridged())
          .to.be.rejectedWith(Error, "bridged adapter doesn't active")
      })
  })

  it('isNIC1ConfigedAsHostonly should works well', function () {
    this.timeout(5000)
    return vrouter.wait(2000)
      .then(() => {
        return vrouter.stopVM().catch(() => {})
      })
      .then(() => {
        return vrouter.specifyHostonlyAdapter()
      })
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return expect(vrouter.isNIC1ConfigedAsHostonly())
          .to.be.fullfilled
      })
      .then(() => {
        const ip = vrouter.config.host.ip
        return vrouter.wait(200)
          .then(() => {
            vrouter.config.host.ip = '8.8.8.8'
          })
          .then(() => {
            return expect(vrouter.isNIC1ConfigedAsHostonly())
              .to.be.rejectedWith(Error, "host-only adapter doesn't config as hostIP")
          })
          .then(() => {
            vrouter.config.host.ip = ip
          })
      })
      .then(() => {
        return vrouter.wait(100)
          .then(() => {
            return expect(vrouter.specifyBridgeAdapter('en0', '1'))
              .to.be.fullfilled
          })
      })
      .then(() => {
        return vrouter.wait(100)
          .then(() => {
            return expect(vrouter.isNIC1ConfigedAsHostonly())
              .to.be.rejectedWith(Error, "NIC1 isn't hostonly network")
          })
      })
      .then(() => {
        return vrouter.wait(100)
          .then(() => {
            return expect(vrouter.specifyHostonlyAdapter('vboxnet999'))
              .to.be.fullfilled
          })
      })
      .then(() => {
        return vrouter.wait(100)
          .then(() => {
            return expect(vrouter.isNIC1ConfigedAsHostonly())
              .to.be.rejectedWith(Error, 'ifconfig: interface vboxnet999 does not exist')
          })
      })
      .then(() => {
        return vrouter.wait(100)
          .then(() => {
            return expect(vrouter.specifyHostonlyAdapter())
              .to.be.fullfilled
          })
      })
  })

  it('test getActiveAdapter', function () {
    return vrouter.getActiveAdapter()
      .then(output => console.log(output))
  })

  it('test configVMNetwork', function () {
    return vrouter.configVMNetwork('4.4.4.4', '4.4.4.5')
  })
})

describe.only('Test Suite for vrouter-remote', function () {
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
