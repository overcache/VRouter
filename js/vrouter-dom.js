const { VRouter } = require('../js/vrouter-local.js')
let intervals = exports.intervals = []

const fillElement = exports.fillElement = function (selector, content) {
  const element = document.querySelector(selector)
  if (element.tagName.toLowerCase() === "input") {
    element.value = content
  } else if (element.tagName.toLowerCase() === "span") {
    element.innerHTML = content
  }
}

const toggleEditForm = exports.toggleEditForm = function (element) {
  if (element.innerHTML === "Edit") {
    element.innerHTML = "Cancle"
    disabledField(false)
    togglePassword(document.getElementById("password-icon"), false)
  } else {
    element.innerHTML = "Edit"
    disabledField(true)
    togglePassword(document.getElementById("password-icon"), true)
  }
}

const togglePassword = exports.togglePassword = function (icon, hideit = true) {
  const passwordField = document.getElementById("password")
  const isHiding = element.classList.contains("unhide")
  if (isHiding || !hideit) {
    icon.classList.remove("unhide")
    icon.classList.add("hide")
    passwordField.type = "text"
  } else {
    icon.classList.remove("hide")
    icon.classList.add("unhide")
    passwordField.type = "password"
  }
}

const disabledField = exports.disabledField = function (disable) {
  const form = document.getElementById("vrouter-mode-form")
  ;[...form.getElementsByTagName("input")].forEach(field => field.disabled = disable)

  if (disable) {
    document.getElementById("proxy-chains").classList.add("disabled")
    document.getElementById("bypass-mode").classList.add("disabled")
  } else {
    document.getElementById("proxy-chains").classList.remove("disabled")
    document.getElementById("bypass-mode").classList.remove("disabled")
  }
}

const fillSSConfig = exports.fillSSConfig = function (str) {
  const data = JSON.parse(str)
  disabledField(true)
  fillElement("#server", data.server)
  fillElement("#server", data.server)
  fillElement("#server-port", data.server_port)
  fillElement("#password", data.password)
  fillElement("#encrypt", data.method)
  fillElement("#fast-open", data.fast_open)
  fillElement("#timeout", data.timeout)
}

const fillKcptunConfig = exports.fillKcptunConfig = function (str) {
  const data = JSON.parse(str)
  let options = []
  for (const key in data) {
    options.push(`${key}=${data[key]}`)
  }
  fillElement("#kcptun", options.join(";"))
}

const toggleBlink = exports.toggleBlink = function (value) {
  const blinkIcons = document.getElementsByClassName("ui circle icon")
  if (value) {
    ;[...blinkIcons].forEach((icon) => {
      let interval = setInterval(() => {
        setTimeout(() => {
          $(icon).transition("pulse")
          icon.classList.toggle("green")
        }, Math.random() * 1400)
      }, 1500)
      intervals.push(interval)
    })
  } else {
    intervals.forEach(interval => clearInterval(interval))
    intervals.length = 0
    setTimeout(() => {
      ;[...blinkIcons].forEach((icon) => {
        if (icon.classList.contains("green")) {
          icon.classList.remove("green")
        }
      })
    }, 2000)
  }
}

const toggleGateway = exports.toggleGateway = async function () {
  const { dns, gateway, router } = await checkTrafficStatus()
  let ip = dns === router ? config.vrouter.ip : router
  await vrouter.changeHostDnsGateway(ip)
  await checkTrafficStatus()
}

const checkTrafficStatus = exports.checkTrafficStatus = async function (vrouter) {
  const vmState = await vrouter.getVMState()
  console.log(vmState)
  const dns = await vrouter.hostDns()
  fillElement("#dns", dns)
  const gateway = await vrouter.hostGateway()
  fillElement("#gateway", gateway)
  const router = await vrouter.hostRouter()
  const toggle = document.getElementById("toggle-gateway")
  const icon = document.getElementById("toggle-gateway-icon")
  const demoDiv = document.getElementById("demo")
  if (router === gateway) {
    toggle.dataset.content = "开始接管网络流量."
    icon.classList.remove("pause")
    icon.classList.add("play")
    demoDiv.classList.remove("info")
    demoDiv.classList.add("negative")
    toggleBlink(false)
  } else {
    toggle.dataset.content = "停止接管网络流量, 但不关闭虚拟机."
    icon.classList.remove("play")
    icon.classList.add("pause")
    demoDiv.classList.add("info")
    demoDiv.classList.remove("negative")
    toggleBlink(true)
  }
  return { dns, gateway, router }
}
