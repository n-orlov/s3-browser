import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Interface for persisted app state
 */
export interface AppState {
  lastProfile: string | null;
  lastBucket: string | null;
  lastPrefix: string;
  // Version for future migration support
  version: number;
}

const STATE_FILE_NAME = 'app-state.json';
const CURRENT_VERSION = 1;

/**
 * Get the path to the app state file
 * Uses Electron's app.getPath('userData') for platform-agnostic storage
 * - Windows: %APPDATA%\s3-browser
 * - macOS: ~/Library/Application Support/s3-browser
 * - Linux: ~/.config/s3-browser
 */
export function getAppStatePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, STATE_FILE_NAME);
}

/**
 * Create a default empty state
 */
export function createDefaultState(): AppState {
  return {
    lastProfile: null,
    lastBucket: null,
    lastPrefix: '',
    version: CURRENT_VERSION,
  };
}

/**
 * Load app state from disk
 * Returns default state if file doesn't exist or is invalid
 */
export function loadAppState(): AppState {
  const statePath = getAppStatePath();

  try {
    if (!fs.existsSync(statePath)) {
      return createDefaultState();
    }

    const content = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(content) as AppState;

    // Validate required fields
    if (typeof state.version !== 'number') {
      console.warn('Invalid app state version, using default');
      return createDefaultState();
    }

    // Handle future version migrations here if needed
    if (state.version > CURRENT_VERSION) {
      console.warn(`App state version ${state.version} is newer than supported ${CURRENT_VERSION}`);
      // Still try to use it, but may miss new fields
    }

    // Ensure all fields have valid types
    return {
      lastProfile: typeof state.lastProfile === 'string' ? state.lastProfile : null,
      lastBucket: typeof state.lastBucket === 'string' ? state.lastBucket : null,
      lastPrefix: typeof state.lastPrefix === 'string' ? state.lastPrefix : '',
      version: CURRENT_VERSION,
    };
  } catch (error) {
    console.error('Failed to load app state:', error);
    return createDefaultState();
  }
}

/**
 * Save app state to disk
 * Creates the userData directory if it doesn't exist
 */
export function saveAppState(state: Partial<Omit<AppState, 'version'>>): boolean {
  const statePath = getAppStatePath();

  try {
    // Load existing state and merge with new values
    const existingState = loadAppState();
    const newState: AppState = {
      ...existingState,
      ...state,
      version: CURRENT_VERSION,
    };

    // Ensure directory exists
    const dir = path.dirname(statePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write state file
    fs.writeFileSync(statePath, JSON.stringify(newState, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to save app state:', error);
    return false;
  }
}

/**
 * Clear app state (for testing or reset)
 */
export function clearAppState(): boolean {
  const statePath = getAppStatePath();

  try {
    if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath);
    }
    return true;
  } catch (error) {
    console.error('Failed to clear app state:', error);
    return false;
  }
}
