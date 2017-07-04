/* eslint-env jquery */
$(document).on('click', 'a[href^="http"]', function (event) {
  event.preventDefault()
  require('electron').shell.openExternal(this.href)
})
