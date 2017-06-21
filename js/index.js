"use strict"

const url = require("url")
const path = require("path")

document.getElementById("btn-redir").addEventListener("click", () => {
  window.location.replace(url.format({
    pathname: path.join(__dirname, "install.html"),
    protocol: "file",
    slashes: true,
  }))
})
