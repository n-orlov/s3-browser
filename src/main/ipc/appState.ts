import { ipcMain } from 'electron';
import { loadAppState, saveAppState, type AppState } from '../services/appState';

/**
 * Interface for the state data exposed to renderer
 * (excludes internal version field)
 */
export interface AppStateData {
  lastProfile: string | null;
  lastBucket: string | null;
  lastPrefix: string;
}

/**
 * Register IPC handlers for app state persistence
 */
export function registerAppStateIpc(): void {
  // Load app state
  ipcMain.handle('app-state:load', async (): Promise<AppStateData> => {
    const state = loadAppState();
    return {
      lastProfile: state.lastProfile,
      lastBucket: state.lastBucket,
      lastPrefix: state.lastPrefix,
    };
  });

  // Save app state
  ipcMain.handle(
    'app-state:save',
    async (
      _event,
      data: Partial<AppStateData>
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const success = saveAppState(data);
        if (!success) {
          return { success: false, error: 'Failed to write state file' };
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error saving state',
        };
      }
    }
  );
}
