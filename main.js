'use strict'

const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')
const url = require('url')

let win

function createWindow () {
  win = new BrowserWindow({
    width: 569,
    height: 710,
    minWidth: 569,
    minHeight: 710
  })
  win.loadURL(url.format({
    pathname: path.join(__dirname, 'html', 'prepare.html'),
    protocol: 'file',
    slashes: true
  }))

  // win.webContents.openDevTools()

  win.on('closed', () => {
    win = null
  })
}

function enableCopy(){
  if (process.platform !== 'darwin') {
		return
	}

  Menu.setApplicationMenu(Menu.buildFromTemplate([
			{
				label: 'Edit',
				submenu: [
					{ role: 'undo' },
					{ role: 'redo' },
					{ type: 'separator' },
					{ role: 'cut' },
					{ role: 'copy' },
					{ role: 'paste' },
					{ role: 'delete' },
					{ role: 'selectall' }
				]
			}
		]))
}

app.on('ready', () => {
  createWindow()
  enableCopy()
})

app.on('window-all-closed', () => {
  // if (process.platform !== 'darwin') {
  app.quit()
  // }
})

app.on('activate', () => {
  if (win === null) {
    createWindow()
  }
})
