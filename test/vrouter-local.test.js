/* eslint-env mocha */
const path = require('path')
const os = require('os')
const fs = require('fs')
var chai = require('chai')
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const { VRouter } = require(path.join(__dirname, '../src/js/vrouter-local.js'))
const configFile = path.join(__dirname, './config-test.json')
const vmFile = path.join(os.homedir(), 'Desktop', 'com.icymind.test.ova')

describe.only('Test ability of manage vm', function () {
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

  it('localExec("echo hello") should return hello', function () {
    return expect(vrouter.localExec('echo hello'))
      .to.eventually.equal('hello\n')
  })
  it('wait(500) should return after 500ms', function () {
    const promise = Promise.resolve()
      .then(() => Date.now())
      .then((startT) => {
        return vrouter.wait(500)
          .then(() => Date.now() - startT)
      })
    return expect(promise).to.eventually.within(500, 510)
  })
  it.skip('startVM/stopVM should be able start/stop a vm', function () {
  })
  it('hideVM should hide vm in virtualbox manager', function () {
    const promise = vrouter.hideVM()
      .then(() => {
        const cmd = `VBoxManage getextradata ${vrouter.config.vrouter.name} GUI/HideFromManager`
        return vrouter.localExec(cmd)
      })
    return expect(promise).to.eventually.equal('Value: true\n')
      .then(() => {
        return vrouter.hideVM(false)
      })
  })

  it('isVBInstalled should be fulfilled when VBoxManage cmd exist, and should be rejected when VBoxManage absence.', function () {
    return vrouter.localExec('VBoxManage')
      .catch(() => {
        return expect(vrouter.isVBInstalled()).to.be.rejected
      })
      .then(() => {
        return expect(vrouter.isVBInstalled()).to.be.fulfilled
      })
  })

  it('isVRouterExisted should be fulfilled when vm exist', function () {
    return expect(vrouter.isVRouterExisted()).to.be.fulfilled
  })
  it('isVRouterExisted should be reject when vm absent', function () {
    const name = vrouter.config.vrouter.name
    vrouter.config.vrouter.name = 'non-exist-name'
    const promise = vrouter.isVRouterExisted()
      // .then(() => {
        // return vrouter.isVRouterExisted()
      // })
      .catch(() => {
        vrouter.config.vrouter.name = name
        return Promise.reject(Error('vmnot exist'))
      })
    // to fixed:not working
    return expect(promise).to.eventually.rejected
  })

  it('getVMState should return "running" or "poweroff" depend on vm state', function () {
    return vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep VMState=`)
      .then((output) => {
        if (output.indexOf('running') >= 0) {
          return expect(vrouter.getVMState())
            .to.eventually.equal('running')
        } else if (output.indexOf('poweroff') >= 0) {
          return expect(vrouter.getVMState())
            .to.eventually.equal('poweroff')
        }
      })
  })
  it('benchmark getVMState', function () {
    return vrouter.getVMState().catch(() => {})
  })
  it('benchmark isVRouterRunning', function () {
    return vrouter.isVRouterRunning().catch(() => {})
  })
  it('isVRouterRunning should works well', function () {
    return vrouter.stopVM()
      .catch(() => {})
      .then(() => {
        expect(vrouter.isVRouterRunning()).to.be.rejectedWith(Error, 'vm not running')
      })
      .then(() => vrouter.startVM())
      .then(() => {
        return expect(vrouter.isVRouterRunning()).to.be.fulfilled
      })
      .then(() => vrouter.stopVM())
  })

  it("getInfIP should be able get a inf's ip", function () {
    return expect(vrouter.getInfIP('lo0')).to.eventually.equal('127.0.0.1')
  })
  it('getAllInf should return all ifconfig', function () {
    const promise = vrouter.getAllInf()
      .then((output) => {
        return vrouter.localExec('ifconfig')
          .then((out) => output === out)
      })
    return expect(promise).to.be.eventually.true
  })
  it('getHostonlyInf() should return array: [correspondingInf, firstAvailableInf]', function () {
    return expect(vrouter.getHostonlyInf()).to.become(['vboxnet4', null])
  })
  it('Test createHostonlyInf and removeHostonlyInf', function () {
    return vrouter.createHostonlyInf()
      .then(function (inf) {
        return Promise.resolve(() => {
          return expect(vrouter.localExec(`ifconfig ${inf}`)).to.be.fulfilled
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
  it('configHostonlyInf should modify correspondingInf to hostIP', function () {
    return vrouter.configHostonlyInf()
      .then((inf) => {
        return expect(vrouter.getInfIP(inf)).to.eventually.equal(vrouter.config.host.ip)
      })
  })

  it('test getActiveAdapter should return an array', function () {
    return expect(vrouter.getActiveAdapter()).to.eventually.be.array
  })
  it('specifyHostonlyAdapter(inf, nic) should change vm\'s adapter', function () {
    let currentInf = ''
    const promise = vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep hostonlyadapter`)
      .then((output) => {
        currentInf = output.trim().split('=')[1]
      })
      // .then(() => {
        // return vrouter.wait(100)
      // })
      .then(() => {
        return vrouter.specifyHostonlyAdapter('something')
      })
      .then(() => {
        return vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep hostonlyadapter`)
      })
    return expect(promise).to.eventually.equal('hostonlyadapter1="something"\n')
      .then(() => {
        return vrouter.specifyHostonlyAdapter(currentInf)
      })
  })
  it('specifyBridgeAdapter(inf, nic) should change vm\'s adapter', function () {
    let currentInf = ''
    const promise = vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep bridgeadapter`)
      .then((output) => {
        currentInf = output.trim().split('=')[1]
      })
      .then(() => {
        return vrouter.specifyBridgeAdapter('something')
      })
      .then(() => {
        return vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep bridgeadapter`)
      })
    return expect(promise).to.eventually.equal('bridgeadapter2="something"\n')
      .then(() => {
        return vrouter.specifyBridgeAdapter(currentInf)
      })
  })

  it('isNIC1ConfigedAsHostonly should be fulfilled when adapter1 was config as hostonly network', function () {
    this.timeout(5000)
    return vrouter.stopVM().catch(() => {})
      .then(() => {
        return vrouter.specifyHostonlyAdapter()
      })
      // .then(() => {
        // return vrouter.wait(100)
      // })
      .then(() => {
        return expect(vrouter.isNIC1ConfigedAsHostonly())
          .to.be.fulfilled
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
              .to.be.fulfilled
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
              .to.be.fulfilled
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
              .to.be.fulfilled
          })
      })
  })
  it('isNIC2ConfigedAsBridged should be fulfilled when vm\'s first adapter config as bridged', function () {
    this.timeout(5000)

    // 确保在测试完start/stopVM后再运行, 因为指定网络适配器为不存在会引起无法开机
    return vrouter.stopVM().catch(() => {})
      .then(() => {
        const promise = vrouter.specifyBridgeAdapter()
        return expect(promise).to.be.fulfilled
      })
      .then(() => {
        return vrouter.wait(500)
      })
      .then(() => {
        const promise = vrouter.specifyHostonlyAdapter('vboxnet0', '2').then(console.log)
        return expect(promise).to.be.fulfilled
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
        return expect(promise).to.be.fulfilled
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
        return expect(promise).to.be.fulfilled
      })
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return expect(vrouter.isNIC2ConfigedAsBridged())
          .to.be.rejectedWith(Error, "bridged adapter doesn't active")
      })
  })

  it('configVMNetwork should config adapter1 as hostonly, adapter2 as bridged', function () {
    const promise = vrouter.configVMNetwork()
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep "nic[12]"')
      })
    return expect(promise).to.eventually.become('nic1="hostonly"\nnic2="bridged"\n')
  })
  it('configVMNetwork should config adapter1 as with host.ip', function () {
    const promise = vrouter.configVMNetwork()
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep hostonlyadapter')
      })
      .then((output) => {
        return vrouter.getInfIP(output.trim().split('=')[1])
      })
    return expect(promise).to.eventually.equal(vrouter.config.host.ip)
  })

  it('toggleSerialPort("on") should turnon serialport 1', function () {
    const promise = vrouter.toggleSerialPort('on')
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep "uart.*1"')
      })
    return expect(promise).to.eventually.equal(
      `uart1="0x03f8,4"\nuartmode1="server,${path.join(vrouter.config.host.configDir, vrouter.config.host.serialFile)}"\n`
    )
  })
  it('toggleSerialPort("off") should turnoff serialport 1', function () {
    const promise = vrouter.toggleSerialPort('off')
      .then(() => {
        return vrouter.wait(100)
      })
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep uart1')
      })
    return expect(promise).to.eventually.equal('uart1="off"\n')
  })
  it('isSerialPortOn should fulfilled with true after toggleSerialPort', function () {
    const promise = vrouter.toggleSerialPort('on')
      .then(() => {
        return vrouter.isSerialPortOn()
      })
    return expect(promise).to.eventually.be.true
  })
  it("configVMLanIP should config vm's br-lan with vrouter.ip", function () {
    this.timeout(50000)
    const promise = vrouter.configVMLanIP()
      .then(() => {
        const cmd = `ping -c 1 -t 1 ${vrouter.config.vrouter.ip}`
        // const cmd = `ping -c 1 -t 1 9.9.9.9`
        return vrouter.localExec(cmd)
      })
    return expect(promise).to.be.fulfilled
  })
  it('connect should return a VRouterRemote object with correct properties', function () {
    this.timeout(50000)
    const promise = vrouter.isVRouterRunning()
      .catch(() => {
        return vrouter.startVM()
          .then(() => {
            return vrouter.wait(30000)
          })
      })
      .then(() => {
        return vrouter.connect()
      })
    return promise
  })
})

describe('Test ability of manage file', function () {
  it('getServerIP should return correct ip')
  it('generateFWRulesHelper should return two lines with newline')
  it('generateFWRules should redirect all traffic in "none" mode')
  it('getDNSServer should return an array: [dnsmasq, ss-dns-tunnel]')
  it('downloadFile should be able download a complete file')
})
