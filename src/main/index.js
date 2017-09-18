'use strict'

import { autoUpdater } from 'electron-updater'
import logger from '@/lib/logger'
import VRouter from '@/lib/vrouter'

const { app, BrowserWindow, Menu, Tray, ipcMain } = require('electron')
const os = require('os')
const path = require('path')

let win
const winURL = process.env.NODE_ENV === 'development'
  ? 'http://localhost:9080'
  : `file://${__dirname}/index.html`

function createWindow () {
  win = new BrowserWindow({
    width: 600,
    height: 760,
    minWidth: 600,
    minHeight: 760
  })

  win.loadURL(winURL)

  // win.webContents.openDevTools()

  win.on('closed', () => {
    win = null
  })
}

function setMenu () {
  const template = [
    {
      label: 'Edit',
      submenu: [
        {role: 'undo'},
        {role: 'redo'},
        {type: 'separator'},
        {role: 'cut'},
        {role: 'copy'},
        {role: 'paste'},
        {role: 'pasteandmatchstyle'},
        {role: 'delete'},
        {role: 'selectall'}
      ]
    },
    {
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'forcereload'},
        {role: 'toggledevtools'},
        {type: 'separator'},
        {role: 'resetzoom'},
        {role: 'zoomin'},
        {role: 'zoomout'},
        {type: 'separator'},
        {role: 'togglefullscreen'}
      ]
    },
    {
      role: 'window',
      submenu: [
        {role: 'minimize'},
        {role: 'close'}
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click () { require('electron').shell.openExternal('https://github.com/icymind/VRouter') }
        }
      ]
    }
  ]

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        // {role: 'about'},
        // {type: 'separator'},
        {role: 'services', submenu: []},
        {type: 'separator'},
        {role: 'hide'},
        {role: 'hideothers'},
        {role: 'unhide'},
        {type: 'separator'},
        {role: 'quit'}
      ]
    })

    // Edit menu
    template[1].submenu.push(
      {type: 'separator'},
      {
        label: 'Speech',
        submenu: [
          {role: 'startspeaking'},
          {role: 'stopspeaking'}
        ]
      }
    )

    // Window menu
    template[3].submenu = [
      {role: 'close'},
      {role: 'minimize'},
      {role: 'zoom'},
      {type: 'separator'},
      {role: 'front'}
    ]
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.on('ready', () => {
  createWindow()
  setMenu()
  app.dock.show()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  } else {
    app.dock.hide()
  }
})

app.on('activate', () => {
  if (win === null) {
    createWindow()
  }
})

process.on('uncaughtException', function (err) {
  // handle the error safely
  console.log(err)
})

/**
 * Auto Updater
 *
 * Uncomment the following code below and install `electron-updater` to
 * support auto updating. Code Signing with a valid certificate is required.
 * https://simulatedgreg.gitbooks.io/electron-vue/content/en/using-electron-builder.html#auto-updating
 */

function sendToRenderer (arg) {
  win.webContents.send('updater', arg)
}

autoUpdater.autoDownload = true
autoUpdater.allowPrerelease = false

autoUpdater.on('checking-for-update', () => {
  sendToRenderer('checking-for-update')
})
autoUpdater.on('update-downloaded', () => {
  sendToRenderer('update downloaded')
  autoUpdater.quitAndInstall()
})
autoUpdater.on('update-available', () => {
  sendToRenderer('update available')
  console.log('update available')
})
autoUpdater.on('update-not-available', () => {
  sendToRenderer('no update available')
  console.info('no update available')
})
autoUpdater.on('error', (err) => {
  sendToRenderer(err.toString())
})
app.on('ready', () => {
  if (process.env.NODE_ENV === 'development') return
  setTimeout(() => {
    if (os.platform() === 'darwin') {
      autoUpdater.checkForUpdates()
    }
  }, 5000)
})

/**
 * tray
*/

let tray = null
app.on('ready', () => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      tray = new Tray(path.join(__dirname, '/static/icons/trayTemplate.png'))
    } else {
      tray = new Tray(path.join(__static, 'icons/trayTemplate.png')) // eslint-disable-line
    }
  } catch (err) {
    logger.error(err)
  }
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open VRouter',
      click: () => {
        if (win === null) {
          createWindow()
        }
        app.show()
        app.focus()
        app.dock.show()
      }
    },
    {
      label: 'Pause',
      type: 'checkbox',
      click: async () => {
        if (win === null) {
          return VRouter.toggleRouting()
        }
        win.webContents.send('toggleRouting', !contextMenu.items[1].checked)
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit VRouter',
      role: 'quit'
    }
  ])
  tray.setToolTip('VRouter')
  tray.setContextMenu(contextMenu)
  ipcMain.on('toggleRouting', (event, arg) => {
    contextMenu.items[1].checked = !arg
  })
})
