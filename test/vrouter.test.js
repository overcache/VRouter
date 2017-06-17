/* eslint-env mocha */
const path = require('path')
const rewire = require('rewire')
const os = require('os')
const expect = require('chai').expect
const { VRouter } = require(path.join(__dirname, '../src/js/vrouter.js'))
const { getConfig } = require(path.join(__dirname, '../src/js/helper.js'))
const configFile = path.join(__dirname, './config.json')

describe('Test Suite for VRouterLocal', function () {
  const testVMfile = path.join(os.homedir(), 'Desktop', 'com.icymind.test.ova')
  const testVMName = path.basename(testVMfile, '.ova')
  let lib
  before('import test-vm', async function () {
    // local = new VRouter(await getConfig())
    lib = rewire('../src/js/vrouter.js')
    const func = lib.__get__('importVM')
    const check = lib.__get__('isVRouterExisted')
    return check(testVMName)
      .then(([err, result]) => {
        if (err) return func(testVMfile)
      })
  })

  /*
   * after('remove test-vm', async function () {
   *   const func = lib.__get__('deleteVM')
   *   return func(testVMName)
   * })
   */

  it('isVBInstalled show return no-error', function () {
    const func = lib.__get__('isVBInstalled')
    return func().then(([_err, result]) => expect(result).to.not.be.empty)
  })

  it('isVRouterExisted should works well', async function () {
    const func = lib.__get__('isVRouterExisted')
    await func(testVMName).then(([_err, result]) => expect(result).to.be.true)
    await func('notexisted').then(([err, result]) => expect(err).to.equal('not existed'))
  })

  it('isVRouterRunning should works well', async function () {
    const func = lib.__get__('isVRouterRunning')
    const stopVM = lib.__get__('stopVM')
    const startVM = lib.__get__('startVM')
    await stopVM(testVMName)
    await func(testVMName).then(([err, result]) => expect(err).to.equal('VRouter not running'))
    await startVM(testVMName)
    await func(testVMName).then(([err, result]) => expect(err).to.be.null)
    await stopVM(testVMName)
  })

  it.skip('stopVM should be able stop a vm', async function () {
    const func = lib.__get__('isVRouterRunning')
    const stopVM = lib.__get__('stopVM')
    await stopVM(testVMName)
    await func(testVMName).then(([err, result]) => expect(err).to.equal('VRouter not running'))
  })

  it.skip('startVM should be able start a vm', async function () {
    const func = lib.__get__('isVRouterRunning')
    const stopVM = lib.__get__('stopVM')
    const startVM = lib.__get__('startVM')
    await stopVM(testVMName)
    await func(testVMName).then(([err, result]) => expect(err).to.equal('VRouter not running'))
    await startVM(testVMName)
    await func(testVMName).then(([err, result]) => expect(err).to.be.null)
  })

  it('Test createHostonlyInf and removeHostonlyInf', async function () {
    const func = lib.__get__('createHostonlyInf')
    const removeHostonlyInf = lib.__get__('removeHostonlyInf')
    const localExec = lib.__get__('localExec')
    const inf = await func()
    let cmd = `ifconfig ${inf}`
    let result = await localExec(cmd)
    expect(result[0]).to.be.null
    result = await removeHostonlyInf(inf)
    expect(result[0]).to.be.null
  })

  it.skip('getHostonlyInf should work', async function () {
    const func = lib.__get__('getHostonlyInf')
    const ip = '192.168.64.2'
    const result = await func(ip)
    expect(result).to.be.deep.equal(['vboxnet0', 'vboxnet1'])
  })

  it('configHostonlyInf should work', async function () {
    const func = lib.__get__('configHostonlyInf')
    const getInfIP = lib.__get__('getInfIP')
    const ip = '3.3.3.3'
    const inf = (await func(ip))[1]
    expect((await getInfIP(inf))[1]).to.be.equal(ip)
  })

  it('isNIC2ConfigedAsBridged should works well', async function () {
    this.timeout(5000)
    await (new Promise(resolve => setTimeout(resolve, 2000)))
    const func = lib.__get__('isNIC2ConfigedAsBridged')
    const specifyHostonlyAdapter = lib.__get__('specifyHostonlyAdapter')
    const configHostonlyInf = lib.__get__('configHostonlyInf')
    const specifyBridgeAdapter = lib.__get__('specifyBridgeAdapter')
    const stopVM = lib.__get__('stopVM')
    await stopVM(testVMName)

    await specifyBridgeAdapter(testVMName)
    expect((await func(testVMName))[0]).to.be.null

    await specifyHostonlyAdapter(testVMName, 'vboxnet0', '2')
    expect((await func(testVMName))[0]).to.be.equal('NIC2 not bridged network')

    await specifyBridgeAdapter(testVMName, 'no-exist-inf')
    expect((await func(testVMName))[0]).to.equal('bridged adapter not existed')

    await specifyBridgeAdapter(testVMName, 'en1: Thunderbolt 1')
    expect((await func(testVMName))[0]).to.equal('bridged adapter not active')

  })

  it('isNIC1ConfigedAsHostonly should works well', async function () {
    this.timeout(5000)
    await (new Promise(resolve => setTimeout(resolve, 2000)))
    const func = lib.__get__('isNIC1ConfigedAsHostonly')
    const specifyHostonlyAdapter = lib.__get__('specifyHostonlyAdapter')
    const configHostonlyInf = lib.__get__('configHostonlyInf')
    const specifyBridgeAdapter = lib.__get__('specifyBridgeAdapter')
    const stopVM = lib.__get__('stopVM')
    await stopVM(testVMName)

    let hostIP = '1.1.1.4'
    let result = await configHostonlyInf(hostIP)
    if (result[0]) throw Error
    let inf = result[1]
    await specifyHostonlyAdapter(testVMName, inf)
    await func(testVMName, hostIP)
      .then(([err, result]) => expect(err).to.be.null)

    await func(testVMName, '8.8.8.8')
      .then(([err, result]) => expect(err).to.be.equal('host-only adapter not config as hostIP'))

    await specifyBridgeAdapter(testVMName, 'en0', '1')
    await func(testVMName, hostIP)
      .then(([err, result]) => expect(err).to.be.equal('NIC1 not hostonly network'))

    // This will cause vm fail to start
    await specifyHostonlyAdapter(testVMName, 'en0')
    await func(testVMName, hostIP)
      .then(([err, result]) => expect(err).to.be.equal('NIC1 not specify host-only adapter'))
    await specifyHostonlyAdapter(testVMName, inf)

    // This will cause vm fail to start
    await specifyHostonlyAdapter(testVMName, 'vboxnet999')
    await func(testVMName, hostIP)
      .then(([err, result]) => expect(err).to.be.equal('host-only adapter not existed'))
    await specifyHostonlyAdapter(testVMName, inf)
  })

  it('test getActiveAdapter', async function () {
    const getActiveAdapter = lib.__get__('getActiveAdapter')
    console.log(await getActiveAdapter())
  })

  it('test configVMNetwork', async function () {
    const configVMNetwork = lib.__get__('configVMNetwork')
    await configVMNetwork(testVMName, '4.4.4.4', '4.4.4.5')
  })
})

describe.only('Test Suite for vrouter-remote', function () {
  // const SSVersion = '3.0.5'
  // const KTVersion = '20170329'
  // const OSVersion = 'CHAOS CALMER (15.05.1, r48532)'
  this.timeout(5000)
  let remote
  before('connect to vrouter', async function () {
    const local = new VRouter(await getConfig(configFile))
    await local.stopVM()
    await local.configVMNetwork()
    await local.startVM()
    remote = await local.connect()
  })

  after('close vrouter connection', async function () {
    return remote.close()
  })

  it('Test Case for getSSVersion', function () {
    return remote.getSSVersion().then(([_err, result]) => expect(/\d+\.\d+\.\d+/ig.test(result)).to.be.true)
  })

  it('Test Case for getKTVersion', function () {
    return remote.getKTVersion().then(([_err, result]) => expect(/\d{8}/ig.test(result)).to.be.true)
  })

  it('Test Case for getOSVersion', function () {
    return remote.getOSVersion().then(([_err, result]) => expect(/\w+ \w+ \(.*\)/ig.test(result)).to.be.true)
  })

  it('Test Case for getBrlan', function () {
    return remote.getBrlan().then(([_err, result]) => expect(/\d+\.\d+\.\d+\.\d+/ig.test(result)).to.be.true)
  })

  it('Test Case for getWifilan', function () {
    return remote.getWifilan().then(([_err, result]) => expect(/\d+\.\d+\.\d+.\d+/i.test(result)).to.be.true)
  })

  it('Test Case for uptime', function () {
    const hours = new Date().getHours()
    return remote.getUptime().then(([_err, result]) => {
      const h = result.split(':')[0]
      expect(parseInt(h)).to.be.equal(hours)
    })
  })
})
