/* eslint-env jquery */

const fs = require('fs-extra')
const path = require('path')
const { VRouter } = require('../js/vrouter-local.js')
// const dom = require('../js/vrouter-dom.js')

// TODO: mem leak
// TODO: vm pulse

document.addEventListener('DOMContentLoaded', () => {
  // dom.checkTrafficStatus()

  const cfgPath = path.join(__dirname, '..', 'config', 'config.json')
  const vrouter = new VRouter(fs.readJsonSync(cfgPath))
  document.getElementById('toggle-gateway').addEventListener('click', () => {
    $('.ui.basic.modal').modal('show')
    // dom.toggleGateway()
    return vrouter.changeRouteTo('wifi')
  })
  document.getElementById('shutdown-vrouter').addEventListener('click', () => {
    return vrouter.stopVM()
  })
  document.getElementById('password-icon').addEventListener('click', (event) => {
    // dom.togglePassword(event.target)
  })

  document.getElementById('edit-form').addEventListener('click', (event) => {
    // dom.toggleEditForm(event.target)
  })

  // vrouter.vrouterBrlan()
    // .then(ip => dom.fillElement('#lan', ip))

  // vrouter.vrouterWan()
    // .then(ip => dom.fillElement('#wan', ip))

  // vrouter.vrouterKcptunVersion()
    // .then(version => dom.fillElement('#kt-version', version))

  // vrouter.vrouterSSVersion()
    // .then(version => dom.fillElement('#ss-version', version))

  // vrouter.vrouterOpenwrtVersion()
    // .then(version => dom.fillElement('#openwrt-version', version))

  // vrouter.vrouterSSConfig()
    // .then(dom.fillSSConfig)

  // vrouter.vrouterKcptunConfig()
    // .then(dom.fillKcptunConfig)

  $('.tabular.menu .item').tab()
  $('#proxy-chains').dropdown()
  $('#bypass-mode').dropdown()
  $('.ui.button').popup()
  // $(".ui.basic.modal").show()
})
