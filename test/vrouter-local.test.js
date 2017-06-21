/* eslint-env mocha */
const path = require('path')
const os = require('os')
const fs = require('fs-extra')
var chai = require('chai')
var chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const { VRouter } = require(path.join(__dirname, '../js/vrouter-local.js'))
const { VRouterRemote } = require(path.join(__dirname, '../js/vrouter-remote.js'))
// const configFile = path.join(__dirname, './config-test.json')
const configFile = path.join(__dirname, '../config/config.json')
// const vmFile = path.join(os.homedir(), 'Desktop', 'com.icymind.test.ova')

describe.only('Test ability of building VM', function () {
  this.timeout(600000)
  let vrouter
  before('get vrouter instance', function () {
    return fs.readJson(configFile)
      .then((obj) => {
        vrouter = new VRouter(obj)
      })
  })
  it('buildVM', function () {
    return vrouter.buildVM(null, true)
      .then(() => {
        return vrouter.wait(5000)
      })
      .then(() => {
        console.log('startting vm')
        return vrouter.startVM()
      })
      .then(() => {
        console.log('wait vm to finish startting')
        return vrouter.wait(30000)
      })
      .then(() => {
        console.log('vm started, now loggin')
        return vrouter.connect()
      })
      .then((vrouterRemote) => {
        return expect(vrouterRemote instanceof VRouterRemote).to.be.true
      })
      .then(() => {
        return vrouter.stopVM()
          .then(() => {
            return vrouter.wait(5000)
          })
      })
  })
  it.only('test serialExec.', function () {
    // return vrouter.serialExec('touch /serialExec')
    return vrouter.serialExec('echo `date` > /`date "+%H%M%S"`')
  })
})

describe('Test ability of manage vm', function () {
  this.slow(1000)
  let vrouter
  let isImportByTest = false
  before('buildvm is necessary', function () {
    return fs.readJson(configFile)
      .then((obj) => {
        vrouter = new VRouter(obj)
      })
      .then(() => {
        return vrouter.isVRouterExisted()
      })
      .catch((err) => {
        console.log(err)
        return vrouter.importVM(vmFile)
          .then(() => {
            isImportByTest = true
          })
      })
  })

  after('remove test-vm', function () {
    if (isImportByTest) {
      return vrouter.deleteVM(true)
    }
  })

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
  it('startVM/stopVM should be able start/stop a vm', function () {
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
  it.skip('isVRouterRunning should works well(toooooo slow)', function () {
    this.timeout(20000)
    return vrouter.stopVM()
      .catch(() => {})
      .then(() => {
        return expect(vrouter.isVRouterRunning()).to.be.rejectedWith(Error, 'vm not running')
      })
      .then(() => {
        return vrouter.startVM()
      })
      .then(() => {
        return vrouter.wait(15000)
      })
      .then(() => {
        return expect(vrouter.isVRouterRunning()).to.be.fulfilled
      })
      .then(() => {
        return vrouter.stopVM()
      })
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
    return vrouter.getHostonlyInf()
      .then((arr) => {
        return expect(vrouter.getInfIP(arr[0])).to.eventually.equal(vrouter.config.host.ip)
          .then(() => expect(vrouter.getInfIP(arr[1])).to.eventually.equal(''))
      })
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
})

describe('Test ability of modify vm', function () {
  this.slow(15000)
  let vrouter
  before('get instance', function () {
    return fs.readJson(configFile)
      .then((obj) => {
        vrouter = new VRouter(obj)
      })
  })
  it('hideVM should hide vm in virtualbox manager', function () {
    this.timeout(10000)
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.hideVM()
      })
      .then(() => {
        const cmd = `VBoxManage getextradata ${vrouter.config.vrouter.name} GUI/HideFromManager`
        return vrouter.localExec(cmd)
      })
    return expect(promise).to.eventually.equal('Value: true\n')
      .then(() => {
        return vrouter.hideVM(false)
      })
  })
  it('specifyHostonlyAdapter(inf, nic) should change vm\'s adapter', function () {
    this.timeout(10000)
    let currentInf = ''
    const promise = vrouter.stopVM('poweroff')
      .catch(() => {
        // don't panic, that's allright. catch isVRouterRunning error
      })
      .then(() => {
        return vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep hostonlyadapter`)
          .then((output) => {
            currentInf = output.trim().split('=')[1]
          })
      })
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
    this.timeout(10000)
    let currentInf = ''
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.localExec(`VBoxManage showvminfo ${vrouter.config.vrouter.name} --machinereadable | grep bridgeadapter`)
      })
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
    return vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.specifyHostonlyAdapter()
      })
      .then(() => {
        return expect(vrouter.isNIC1ConfigedAsHostonly())
          .to.be.fulfilled
      })
      .then(() => {
        const ip = vrouter.config.host.ip
        vrouter.config.host.ip = '8.8.8.8'
        return expect(vrouter.isNIC1ConfigedAsHostonly())
          .to.be.rejectedWith(Error, "host-only adapter doesn't config as hostIP")
          .then(() => {
            vrouter.config.host.ip = ip
          })
      })
      .then(() => {
        return expect(vrouter.specifyBridgeAdapter('en0', '1'))
          .to.be.fulfilled
      })
      .then(() => {
        return expect(vrouter.isNIC1ConfigedAsHostonly())
          .to.be.rejectedWith(Error, "NIC1 isn't hostonly network")
      })
      .then(() => {
        return expect(vrouter.specifyHostonlyAdapter('vboxnet999'))
          .to.be.fulfilled
      })
      .then(() => {
        return expect(vrouter.isNIC1ConfigedAsHostonly())
          .to.be.rejectedWith(Error, 'ifconfig: interface vboxnet999 does not exist')
      })
      .then(() => {
        return expect(vrouter.specifyHostonlyAdapter())
          .to.be.fulfilled
      })
  })
  it('isNIC2ConfigedAsBridged should be fulfilled when vm\'s first adapter config as bridged', function () {
    this.timeout(5000)

    // const promise = vrouter.specifyBridgeAdapter()
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.specifyBridgeAdapter()
      })

    return expect(promise).to.be.fulfilled
      .then(() => {
        const promise = vrouter.specifyHostonlyAdapter('vboxnet0', '2')
        return expect(promise).to.be.fulfilled
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
        return expect(vrouter.isNIC2ConfigedAsBridged())
          .to.be.rejectedWith(Error, 'ifconfig: interface no-exist-inf does not exist')
      })
      .then(() => {
        const promise = vrouter.specifyBridgeAdapter('en1: Thunderbolt 1')
        return expect(promise).to.be.fulfilled
      })
      .then(() => {
        return expect(vrouter.isNIC2ConfigedAsBridged())
          .to.be.rejectedWith(Error, "bridged adapter doesn't active")
      })
  })
  it('configVMNetwork should config adapter1 as with host.ip', function () {
    this.timeout(10000)
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.configVMNetwork()
      })
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep hostonlyadapter')
      })
      .then((output) => {
        return vrouter.getInfIP(output.trim().split('=')[1])
      })
    return expect(promise).to.eventually.equal(vrouter.config.host.ip)
  })

  it('configVMNetwork should config adapter1 as hostonly, adapter2 as bridged', function () {
    this.timeout(10000)
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.configVMNetwork()
      })
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep "nic[12]"')
      })
    return expect(promise).to.eventually.become('nic1="hostonly"\nnic2="bridged"\n')
  })

  it('toggleSerialPort("on") should turnon serialport 1', function () {
    this.timeout(10000)
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.toggleSerialPort('on')
      })
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep "uart.*1"')
      })
    return expect(promise).to.eventually.equal(
      `uart1="0x03f8,4"\nuartmode1="server,${path.join(vrouter.config.host.configDir, vrouter.config.host.serialFile)}"\n`
    )
  })
  it('toggleSerialPort("off") should turnoff serialport 1', function () {
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.toggleSerialPort('off')
      })
      .then(() => {
        return vrouter.localExec('VBoxManage showvminfo com.icymind.test --machinereadable | grep uart1')
      })
    return expect(promise).to.eventually.equal('uart1="off"\n')
  })
  it.skip("configVMLanIP should config vm's br-lan with vrouter.ip", function () {
    // need fixed
    // When test alone, it pass test
    // When test togeter, Uncaught Error: read ECONNRESET
    this.timeout(50000)
    // configVMLanIP will handle stopVM
    // const promise = Promise.resolve()
    const promise = vrouter.configVMLanIP()
      .catch((err) => {
        console.log('error when configVMLanIP. try again')
        console.log(err)
        return vrouter.configVMLanIP()
      })
      .then(() => {
        const cmd = `ping -c 1 -t 5 ${vrouter.config.vrouter.ip}`
        // const cmd = `ping -c 20 ${vrouter.config.vrouter.ip}`
        return vrouter.localExec(cmd)
          .then(() => {
            return Promise.resolve()
          })
          .catch((err) => {
            console.log('error when ping')
            console.log(err)
            return Promise.reject(err)
          })
      })
    return expect(promise).to.be.fulfilled
  })
  it('isSerialPortOn should fulfilled with true after toggleSerialPort', function () {
    this.timeout(10000)
    const promise = vrouter.stopVM('poweroff')
      .then(() => {
        return vrouter.toggleSerialPort('on')
      })
      .then(() => {
        return vrouter.isSerialPortOn()
      })
    return expect(promise).to.eventually.be.true
  })
})

describe.skip('Test ability of manage file', function () {
  let vrouter
  before('get a vrouter instance', function () {
    return fs.readJson(configFile)
      .then((obj) => {
        vrouter = new VRouter(obj)
      })
  })
  it('cfg should be delte after running deleteCfgFile(cfg)', function () {
    const cfg = vrouter.config.firewall.ipsetsFile
    const filePath = path.join(vrouter.config.host.configDir, cfg)
    return fs.ensureFile(filePath)
      .then(() => {
        return expect(fs.pathExists(filePath)).to.eventually.be.true
      })
      .then(() => {
        return vrouter.deleteCfgFile(cfg)
      })
      .then(() => {
        return expect(fs.pathExists(filePath)).to.eventually.be.false
      })
  })
  it('getCfgContent(file) should be fulfilled with content.', function () {
    const cfg = vrouter.config.firewall.whiteIPs
    const cfgPath = path.join(vrouter.config.host.configDir, cfg)
    const template = path.join(__dirname, '../src/config', cfg)
    let originTemplateData = ''
    let originCfgData = ''
    return fs.readFile(cfgPath, 'utf8').catch(() => {})
      .then((data) => {
        originCfgData = data || ''
        return fs.outputFile(cfgPath, '1.1.1.1')
      })
      .then(() => {
        const promise = fs.readFile(cfgPath, 'utf8')
        return expect(promise).to.eventually.equal('1.1.1.1')
      })
      .then(() => {
        return expect(vrouter.getCfgContent(cfg)).to.eventually.equal('1.1.1.1')
      })
      .then(() => {
        return fs.remove(cfgPath)
      })
      .then(() => {
        return fs.readFile(template, 'utf8')
          .catch(() => {
            // don't panic.
          })
          .then((data) => {
            originTemplateData = data || ''
          })
      })
      .then(() => {
        return fs.outputFile(template, '2.2.2.2')
      })
      .then(() => {
        return expect(vrouter.getCfgContent(cfg)).to.eventually.equal('2.2.2.2')
      })
      .then(() => {
        return Promise.all([
          fs.outputFile(template, originTemplateData),
          fs.outputFile(cfgPath, originCfgData)
        ])
      })
  })
  it("generateIPsets's output should contains 127.0.0.0/chinaip/extraip", function () {
    const cfg = vrouter.config.firewall.ipsetsFile
    const cfgPath = path.join(vrouter.config.host.configDir, cfg)
    let originData = ''
    return fs.readFile(cfgPath, 'utf8').catch(() => {})
      .then((data) => {
        originData = data || ''
      })
      .then(() => {
        return fs.remove(cfgPath).catch(() => {})
      })
      .then(() => {
        return vrouter.generateIPsets()
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        // console.log(data)
        expect(/^add LAN 127.0.0.0\/8$/mg.test(data)).to.be.true
        expect(/^add WHITELIST 114.114.0.0\/16$/mg.test(data)).to.be.true
        expect(/^add BLACKLIST 8.8.8.8\/32$/m.test(data)).to.be.true
      })
      .then(() => {
        return fs.outputFile(cfgPath, originData, 'utf8')
      })
  })

  it('generateFWRulesHelper should return two lines with newline', function () {
    const rule = vrouter.generateFWRulesHelper('a test')
    return expect(rule).to.be.equal(`iptables -t nat -A PREROUTING -d a test\niptables -t nat -A OUTPUT a test\n`)
  })
  it('getServerIP should return server ip', function () {
    const origin = [vrouter.config.server.domain, vrouter.config.server.ip]
    return Promise.resolve()
      .then(() => {
        vrouter.config.server.ip = '1.2.3.4'
        return expect(vrouter.getServerIP()).to.eventually.equal('1.2.3.4')
      })
      .then(() => {
        vrouter.config.server.ip = ''
        vrouter.config.server.domain = 'localhost'
        const promise = vrouter.getServerIP()
        return expect(promise).to.eventually.equal('127.0.0.1')
      })
      .then(() => {
        vrouter.config.server.domain = origin[0]
        vrouter.config.server.ip = origin[1]
      })
  })
  it('generateFWRules should redirect only lan traffic in "none" mode', function () {
    return vrouter.generateFWRules('kcptun', 'none')
      .then(() => {
        const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.firewallFile)
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
# com.icymind.vrouter
# workMode: none
# create ipsets in order to avoid errors when run firewall.user
ipset create LAN   hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create WHITELIST hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create BLACKLIST hash:net family inet hashsize 1024 maxelem 65536 -exist
/usr/sbin/ipset restore -exist -file /etc/com.icymind.vrouter/custom.ipset &> /dev/null
`
        return expect(data.trim()).to.equal(expectContent.trim())
      })
  })
  it('generateFWRules should works fine with kt+global mode', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.firewallFile)
    const originIP = vrouter.config.server.ip
    let originRules = ''
    vrouter.config.server.ip = '1.2.3.4'
    return fs.readFile(cfgPath, 'utf8')
      .then((data) => {
        originRules = data || ''
      })
      .then(() => {
        return vrouter.generateFWRules('kcptun', 'global')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
# com.icymind.vrouter
# workMode: global
# create ipsets in order to avoid errors when run firewall.user
ipset create LAN   hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create WHITELIST hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create BLACKLIST hash:net family inet hashsize 1024 maxelem 65536 -exist
/usr/sbin/ipset restore -exist -file /etc/com.icymind.vrouter/custom.ipset &> /dev/null
# bypass server ip
iptables -t nat -A PREROUTING -d -d 1.2.3.4 -j RETURN
iptables -t nat -A OUTPUT -d 1.2.3.4 -j RETURN
# bypass lan networks
iptables -t nat -A PREROUTING -d -m set --match-set LAN dst -j RETURN
iptables -t nat -A OUTPUT -m set --match-set LAN dst -j RETURN
# route all traffic
iptables -t nat -A PREROUTING -d -p tcp -j REDIRECT --to-ports 1090
iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 1090`
        return expect(data.trim()).to.equal(expectContent.trim())
      })
      .then(() => {
        vrouter.config.server.ip = originIP
        return fs.outputFile(cfgPath, originRules)
      })
  })
  it('generateFWRules should works fine with kt+whitelist mode', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.firewallFile)
    const originIP = vrouter.config.server.ip
    let originRules = ''
    vrouter.config.server.ip = '1.2.3.4'
    return fs.readFile(cfgPath, 'utf8')
      .then((data) => {
        originRules = data
      })
      .then(() => {
        return vrouter.generateFWRules('kcptun', 'whitelist')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
# com.icymind.vrouter
# workMode: whitelist
# create ipsets in order to avoid errors when run firewall.user
ipset create LAN   hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create WHITELIST hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create BLACKLIST hash:net family inet hashsize 1024 maxelem 65536 -exist
/usr/sbin/ipset restore -exist -file /etc/com.icymind.vrouter/custom.ipset &> /dev/null
# bypass server ip
iptables -t nat -A PREROUTING -d -d 1.2.3.4 -j RETURN
iptables -t nat -A OUTPUT -d 1.2.3.4 -j RETURN
# bypass lan networks
iptables -t nat -A PREROUTING -d -m set --match-set LAN dst -j RETURN
iptables -t nat -A OUTPUT -m set --match-set LAN dst -j RETURN
# bypass whitelist
iptables -t nat -A PREROUTING -d -m set --match-set WHITELIST dst -j RETURN
iptables -t nat -A OUTPUT -m set --match-set WHITELIST dst -j RETURN
# route all other traffic
iptables -t nat -A PREROUTING -d -p tcp -j REDIRECT --to-ports 1090
iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 1090`
        return expect(data.trim()).to.equal(expectContent.trim())
      })
      .then(() => {
        vrouter.config.server.ip = originIP
        return fs.outputFile(cfgPath, originRules)
      })
  })
  it('generateFWRules should works fine with ss+blacklist', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.firewallFile)
    const originIP = vrouter.config.server.ip
    let originRules = ''
    vrouter.config.server.ip = '1.2.3.4'
    return fs.readFile(cfgPath, 'utf8')
      .then((data) => {
        originRules = data | ''
      })
      .then(() => {
        return vrouter.generateFWRules('shadowsocks', 'blacklist')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
# com.icymind.vrouter
# workMode: blacklist
# create ipsets in order to avoid errors when run firewall.user
ipset create LAN   hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create WHITELIST hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create BLACKLIST hash:net family inet hashsize 1024 maxelem 65536 -exist
/usr/sbin/ipset restore -exist -file /etc/com.icymind.vrouter/custom.ipset &> /dev/null
# bypass server ip
iptables -t nat -A PREROUTING -d -d 1.2.3.4 -j RETURN
iptables -t nat -A OUTPUT -d 1.2.3.4 -j RETURN
# bypass lan networks
iptables -t nat -A PREROUTING -d -m set --match-set LAN dst -j RETURN
iptables -t nat -A OUTPUT -m set --match-set LAN dst -j RETURN
# route all blacklist traffic
iptables -t nat -A PREROUTING -d -p tcp -m set --match-set BLACKLIST dst -j REDIRECT --to-port 1080
iptables -t nat -A OUTPUT -p tcp -m set --match-set BLACKLIST dst -j REDIRECT --to-port 1080`
        return expect(data.trim()).to.equal(expectContent.trim())
      })
      .then(() => {
        vrouter.config.server.ip = originIP
        return fs.outputFile(cfgPath, originRules)
      })
  })
  it('generateFWRules should works fine with ss+whitelist', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.firewallFile)
    const originIP = vrouter.config.server.ip
    let originRules = ''
    vrouter.config.server.ip = '1.2.3.4'
    return fs.readFile(cfgPath, 'utf8')
      .then((data) => {
        originRules = data || ''
      })
      .then(() => {
        return vrouter.generateFWRules('shadowsocks', 'whitelist')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
# com.icymind.vrouter
# workMode: whitelist
# create ipsets in order to avoid errors when run firewall.user
ipset create LAN   hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create WHITELIST hash:net family inet hashsize 1024 maxelem 65536 -exist
ipset create BLACKLIST hash:net family inet hashsize 1024 maxelem 65536 -exist
/usr/sbin/ipset restore -exist -file /etc/com.icymind.vrouter/custom.ipset &> /dev/null
# bypass server ip
iptables -t nat -A PREROUTING -d -d 1.2.3.4 -j RETURN
iptables -t nat -A OUTPUT -d 1.2.3.4 -j RETURN
# bypass lan networks
iptables -t nat -A PREROUTING -d -m set --match-set LAN dst -j RETURN
iptables -t nat -A OUTPUT -m set --match-set LAN dst -j RETURN
# bypass whitelist
iptables -t nat -A PREROUTING -d -m set --match-set WHITELIST dst -j RETURN
iptables -t nat -A OUTPUT -m set --match-set WHITELIST dst -j RETURN
# route all other traffic
iptables -t nat -A PREROUTING -d -p tcp -j REDIRECT --to-ports 1080
iptables -t nat -A OUTPUT -p tcp -j REDIRECT --to-ports 1080`
        return expect(data.trim()).to.equal(expectContent.trim())
      })
      .then(() => {
        vrouter.config.server.ip = originIP
        return fs.outputFile(cfgPath, originRules)
      })
  })
  it('getDNSServer should return an array: [dnsmasq, ss-dns-tunnel]', function () {
    return expect(vrouter.getDNSServer()).to.be.deep.equal([
      '127.0.0.1#53',
      `127.0.0.1#${vrouter.config.shadowsocks.dnsPort}`
    ])
  })
  it('generateDnsmasqCfg should generate expect content to file', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.dnsmasqFile)
    let originContent
    return fs.readFile(cfgPath).catch(() => {})
      .then((data) => {
        originContent = data || ''
      })
      .then(() => {
        return vrouter.generateDnsmasqCf()
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const reg = /server=\/google.com\/127.0.0.1#1081\nipset=\/google.com\/BLACKLIST/
        return expect(reg.test(data)).to.be.true
      })
      .then(() => {
        return fs.outputFile(cfgPath, originContent)
      })
  })

  it('generateWatchdog should works', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.firewall.watchdogFile)
    const expectContent = String.raw`
#!/bin/sh
# KCPTUN
if ! pgrep kcptun;then
    /etc/init.d/kcptun restart
    date >> /root/watchdog.log
    echo "restart kcptun" >> /root/watchdog.log
fi
# SHADOWSOCKS
if ! (pgrep ss-redir && pgrep ss-tunnel);then
    /etc/init.d/shadowsocks restart
    date >> /root/watchdog.log
    echo "restart ss" >> /root/watchdog.log
fi`
    return vrouter.generateWatchdog()
      .then(() => {
        // return expect(fs.readFile(cfgPath, 'utf8').then((data => {console.log(data);return data})))
          // .to.eventually.equal(expectContent)
        return expect(fs.readFile(cfgPath, 'utf8'))
          .to.eventually.equal(expectContent)
      })
  })

  it('generateService("kcptun") should generate expect content to file', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.kcptun.service)
    let originContent = ''
    return fs.readFile(cfgPath).catch(() => {})
      .then((data) => {
        originContent = data || ''
      })
      .then(() => {
        return vrouter.generateService('kcptun')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const kt = String.raw`
#!/bin/sh /etc/rc.common
# Copyright (C) 2006-2011 OpenWrt.org

START=88

SERVICE_USE_PID=1
SERVICE_WRITE_PID=1
SERVICE_DAEMONIZE=1

start() {
    # kcptun will fail if network not ready
    while true;do
        service_start /usr/bin/kcptun -c ${vrouter.config.vrouter.configDir}/${vrouter.config.kcptun.client}
        sleep 30
        (pgrep kcptun) && break
    done
}

stop() {
    killall kcptun
}`
        return expect(data).to.equal(kt)
      })
      .then(() => {
        return fs.outputFile(cfgPath, originContent)
      })
  })
  it('generateService("shadowsocks") should generate expect content to file', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.shadowsocks.service)
    let originContent = ''
    return fs.readFile(cfgPath).catch(() => {})
      .then((data) => {
        originContent = data || ''
      })
      .then(() => {
        return vrouter.generateService('shadowsocks')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const kt = String.raw`
#!/bin/sh /etc/rc.common
# Copyright (C) 2006-2011 OpenWrt.org

START=90

SERVICE_USE_PID=1
SERVICE_WRITE_PID=1
SERVICE_DAEMONIZE=1


start() {
    # ss-tunnel cannot work fine with kcptun.
    service_start /usr/bin/ss-tunnel -c ${vrouter.config.vrouter.configDir}/${vrouter.config.shadowsocks.dns}
    service_start /usr/bin/ss-redir  -c ${vrouter.config.vrouter.configDir}/${vrouter.config.shadowsocks.client}
    service_start /usr/bin/ss-redir  -c ${vrouter.config.vrouter.configDir}/${vrouter.config.shadowsocks.overKt}
}

stop() {
    service_stop /usr/bin/ss-tunnel
    service_stop /usr/bin/ss-redir
    killall ss-redir
}`
        return expect(data).to.equal(kt)
      })
      .then(() => {
        return fs.outputFile(cfgPath, originContent)
      })
  })
  it('generateConfig("ss-client") should generate expect content to file', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.shadowsocks.client)
    let originServer = vrouter.config.shadowsocks.server
    let originContent
    return fs.readFile(cfgPath).catch(() => {})
      .then((data) => {
        originContent = data || ''
      })
      .then(() => {
        vrouter.config.shadowsocks.server = {
          ip: '5.5.5.5',
          domain: '',
          port: '999',
          password: 'a-test-passwd',
          timeout: 300,
          method: 'chacha30',
          fastOpen: true
        }
      })
      .then(() => {
        return vrouter.generateConfig('ss-client')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
{
    "server":"5.5.5.5",
    "server_port":999,
    "local_address": "0.0.0.0",
    "local_port":1080,
    "password":"a-test-passwd",
    "timeout":300,
    "method":"chacha30",
    "fast_open": true,
    "mode": "tcp_only"
}`
        return expect(data).to.equal(expectContent)
      })
      .then(() => {
        vrouter.config.shadowsocks.server = originServer
        return fs.outputFile(cfgPath, originContent)
      })
  })
  it('generateConfig("ss-overKt") should generate expect content to file', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.shadowsocks.overKt)
    let originServer = vrouter.config.shadowsocks.server
    let originContent
    return fs.readFile(cfgPath).catch(() => {})
      .then((data) => {
        originContent = data || ''
      })
      .then(() => {
        vrouter.config.shadowsocks.server = {
          ip: '5.5.5.5',
          domain: '',
          port: '999',
          password: 'a-test-passwd',
          timeout: 300,
          method: 'chacha30',
          fastOpen: true
        }
      })
      .then(() => {
        return vrouter.generateConfig('ss-overKt')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
{
    "server":       "127.0.0.1",
    "server_port":  ${vrouter.config.kcptun.clientPort},
    "local_address": "0.0.0.0",
    "local_port":   ${vrouter.config.shadowsocks.overKtPort},
    "password":     "a-test-passwd",
    "timeout":      20,
    "method":       "chacha30",
    "fast_open":    true,
    "mode":         "tcp_only"
}`
        return expect(data).to.equal(expectContent)
      })
      .then(() => {
        vrouter.config.shadowsocks.server = originServer
        return fs.outputFile(cfgPath, originContent)
      })
  })
  it('generateConfig("ss-dns") should generate expect content to file', function () {
    const cfgPath = path.join(vrouter.config.host.configDir, vrouter.config.shadowsocks.dns)
    let originServer = vrouter.config.shadowsocks.server
    let originContent
    return fs.readFile(cfgPath).catch(() => {})
      .then((data) => {
        originContent = data || ''
      })
      .then(() => {
        vrouter.config.shadowsocks.server = {
          ip: '5.5.5.5',
          domain: '',
          port: '999',
          password: 'a-test-passwd',
          timeout: 300,
          method: 'chacha30',
          fastOpen: true
        }
      })
      .then(() => {
        return vrouter.generateConfig('ss-dns')
      })
      .then(() => {
        return fs.readFile(cfgPath, 'utf8')
      })
      .then((data) => {
        const expectContent = String.raw`
{
    "server":"5.5.5.5",
    "server_port":999,
    "local_address": "0.0.0.0",
    "local_port":1080,
    "password":"a-test-passwd",
    "timeout":300,
    "method":"chacha30",
    "fast_open": true,
    "mode": "udp_only"
}`
        return expect(data).to.equal(expectContent)
      })
      .then(() => {
        vrouter.config.shadowsocks.server = originServer
        return fs.outputFile(cfgPath, originContent)
      })
  })

  it.skip('downloadFile should be able download a complete file', function () {
    this.timeout(50000)
    const url = 'http://downloads.openwrt.org/chaos_calmer/15.05.1/x86/generic/openwrt-15.05.1-x86-generic-combined-ext4.img.gz'
    const dest = path.join(os.tmpdir(), path.basename(url))
    const sha = '3f3d92a088b24e6aa4ae856270ffcd714efb1be8867ceef4cf619abf1ad09bfc'
    return vrouter.downloadFile(url, dest)
      .then(() => {
        return fs.readFile(dest)
      })
      .then((data) => {
        return expect(vrouter.hashFile(dest)).to.eventually.equal(sha)
      })
      .then(() => {
        return fs.remove(dest)
      })
  })
  it('generateNetworkCfg should should return expect string', function () {
    const originIP = vrouter.config.vrouter.ip
    vrouter.config.vrouter.ip = '7.7.7.7'
    const ret = vrouter.generateNetworkCfg()
    vrouter.config.vrouter.ip = originIP
    const expectContent = String.raw`
config interface 'loopback'
        option ifname 'lo'
        option proto 'static'
        option ipaddr '127.0.0.1'
        option netmask '255.0.0.0'

config interface 'lan'
        option ifname 'eth0'
        option type 'bridge'
        option proto 'static'
        option ipaddr '7.7.7.7'
        option netmask '255.255.255.0'
        option ip6assign '60'

config interface 'wan'
        option ifname 'eth1'
        option proto 'dhcp'

config interface 'wan6'
        option ifname 'eth1'
        option proto 'dhcpv6'

config globals 'globals'
        # option ula_prefix 'fd2c:a5b2:c85d::/48'
    `
    return expect(ret.trim()).to.be.equal(expectContent.trim())
  })
})
