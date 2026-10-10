import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { registerCredentialsIpc } from './ipc/credentials';
import { registerS3Ipc } from './ipc/s3';
import { registerAppStateIpc } from './ipc/appState';
import { secureWebContents } from './windowSecurity';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'S3 Browser',
    show: false,
    autoHideMenuBar: true,
  });

  // Remove the application menu for a cleaner native look
  Menu.setApplicationMenu(null);

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const devUrl = 'http://localhost:5173';
  const prodFile = path.join(__dirname, '../renderer/index.html');
  secureWebContents(mainWindow.webContents, isDev ? devUrl : pathToFileURL(prodFile).href);

  if (isDev) {
    // In development, load from Vite dev server
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built index.html
    mainWindow.loadFile(prodFile);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Register IPC handlers before creating window
  registerCredentialsIpc();
  registerS3Ipc();
  registerAppStateIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
