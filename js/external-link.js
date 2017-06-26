const shell = require('electron').shell
$(document).on('click', 'a[href^="http"]', function (event) {
  event.preventDefault()
  shell.openExternal(this.href)
})
