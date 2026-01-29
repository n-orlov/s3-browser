import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Placeholder for future IPC methods
  // S3 operations will be added here
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Platform info
  platform: process.platform,
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      platform: NodeJS.Platform;
    };
  }
}
