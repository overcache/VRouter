/* eslint-env jquery */
const path = require('path')
const url = require('url')
const VRouter = require('../js/vrouter.js')
const { getConfig } = require('../js/helper.js')

function redirect () {
  window.location.replace(url.format({
    pathname: path.join(__dirname, '../html/index.html'),
    protocol: 'file',
    slashes: true
  }))
}

function toggleModal (cla, toggle) {
  $(`.ui.${cla}.modal`)
    .modal({
      dimmerSettings: {
        opacity: 0.2
      },
      closable: false
    })
    .modal(toggle)
}
async function checkRequirement (config) {
  let ret = await VRouter.isVBInstalled()
  if (ret[0]) {
    toggleModal('installVB', 'show')
    return false
  }
  ret = await VRouter.isBridgeExisted(config.vrouter.ip)
  if (ret[0]) {
    throw new Error(ret[0])
  }
  ret = await VRouter.isVRouterExisted()
  if (ret[0]) {
    throw new Error(ret[0])
  }
  ret = await VRouter.isVRouterRunning()
  if (ret[0]) {
    toggleModal('startVM', 'show')
    return false
  }
  redirect()
}
document.addEventListener('DOMContentLoaded', async () => {
  const config = await getConfig()
  document.querySelector('.ui.startVM.modal .action').addEventListener('click', async () => {
    let [err, result] = await VRouter.startVM()
    if (err) return
    console.log(result)
    toggleModal('startVM', 'hide')
    console.log('hided')
    await checkRequirement(config)
  })
  checkRequirement(config)
})
