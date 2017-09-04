/* eslint-env mocha */
/* eslint no-unused-expressions: "off" */
const { VBox } = require('../js/vbox.js')
const { expect } = require('chai')

describe.skip('Test suit for VBox.js', function () {
  const name = 'test'
  before('#create test vm', async function () {
    return VBox.create(name)
  })
  after('#delete test vm', async function () {
    return VBox.delete(name)
  })
  it('#getVersion', async function () {
    const version = await VBox.getVersion()
    const pattern = /^5.1.12r112440$/mg
    return expect(pattern.test(version)).to.be.true
  })
  it('#isVBInstalled', async function () {
    return expect(VBox.isVBInstalled()).to.eventually.be.true
  })
  it('#convertImg')
  it('#modify')
  it('#storagectl')
  it('#storageattach')
  it('#start')
  it('#attachHeadless')
  it('#saveState')
  it('#discardState')
  it('#powerOff')
  it('#hide')
  it('#lockGUIConfig')
  it('#isVmExisted')
  it('#getVmInfo')
  it('#getVmState')
  it('#toggleSerialPort')
  it('#isSerialPortOn')
  it('#createHostonlyInf')
  it('#removeHostonlyInf')
  it('#initHostonlyNetwork')
  it('#initBridgeNetwork')
  it('#amendBridgeNetwork')
  it('#getAssignedBridgeService')
  it('#getAvailableHostonlyInf')
  it('#getAllBridgeServices')
  it('#getBridgeService')
  it('#configHostonlyNetwork')
})
