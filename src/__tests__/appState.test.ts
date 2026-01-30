import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock electron's app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-app-data'),
  },
}));

// Import after mocking
import {
  loadAppState,
  saveAppState,
  clearAppState,
  getAppStatePath,
  createDefaultState,
  type AppState,
} from '../main/services/appState';

describe('appState service', () => {
  const testDataDir = '/tmp/test-app-data';
  const testStatePath = path.join(testDataDir, 'app-state.json');

  beforeEach(() => {
    // Clean up test directory before each test
    if (fs.existsSync(testStatePath)) {
      fs.unlinkSync(testStatePath);
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (fs.existsSync(testStatePath)) {
      fs.unlinkSync(testStatePath);
    }
  });

  describe('getAppStatePath', () => {
    it('should return path in userData directory', () => {
      const statePath = getAppStatePath();
      expect(statePath).toBe(testStatePath);
    });
  });

  describe('createDefaultState', () => {
    it('should create default state with null values', () => {
      const state = createDefaultState();
      expect(state).toEqual({
        lastProfile: null,
        lastBucket: null,
        lastPrefix: '',
        version: 1,
      });
    });
  });

  describe('loadAppState', () => {
    it('should return default state if file does not exist', () => {
      const state = loadAppState();
      expect(state.lastProfile).toBeNull();
      expect(state.lastBucket).toBeNull();
      expect(state.lastPrefix).toBe('');
      expect(state.version).toBe(1);
    });

    it('should load state from existing file', () => {
      // Create test state file
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true });
      }
      const testState: AppState = {
        lastProfile: 'test-profile',
        lastBucket: 'test-bucket',
        lastPrefix: 'test/prefix/',
        version: 1,
      };
      fs.writeFileSync(testStatePath, JSON.stringify(testState), 'utf-8');

      const state = loadAppState();
      expect(state.lastProfile).toBe('test-profile');
      expect(state.lastBucket).toBe('test-bucket');
      expect(state.lastPrefix).toBe('test/prefix/');
      expect(state.version).toBe(1);
    });

    it('should return default state for invalid JSON', () => {
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true });
      }
      fs.writeFileSync(testStatePath, 'not valid json', 'utf-8');

      const state = loadAppState();
      expect(state.lastProfile).toBeNull();
      expect(state.version).toBe(1);
    });

    it('should return default state if version is missing', () => {
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true });
      }
      fs.writeFileSync(testStatePath, JSON.stringify({ lastProfile: 'test' }), 'utf-8');

      const state = loadAppState();
      expect(state.lastProfile).toBeNull();
      expect(state.version).toBe(1);
    });

    it('should handle invalid field types gracefully', () => {
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir, { recursive: true });
      }
      fs.writeFileSync(
        testStatePath,
        JSON.stringify({
          lastProfile: 123, // Should be string or null
          lastBucket: { invalid: true }, // Should be string or null
          lastPrefix: null, // Should be string
          version: 1,
        }),
        'utf-8'
      );

      const state = loadAppState();
      expect(state.lastProfile).toBeNull();
      expect(state.lastBucket).toBeNull();
      expect(state.lastPrefix).toBe('');
    });
  });

  describe('saveAppState', () => {
    it('should create state file with provided values', () => {
      const success = saveAppState({
        lastProfile: 'my-profile',
        lastBucket: 'my-bucket',
        lastPrefix: 'my/prefix/',
      });

      expect(success).toBe(true);
      expect(fs.existsSync(testStatePath)).toBe(true);

      const savedContent = fs.readFileSync(testStatePath, 'utf-8');
      const savedState = JSON.parse(savedContent);
      expect(savedState.lastProfile).toBe('my-profile');
      expect(savedState.lastBucket).toBe('my-bucket');
      expect(savedState.lastPrefix).toBe('my/prefix/');
      expect(savedState.version).toBe(1);
    });

    it('should merge with existing state', () => {
      // First save
      saveAppState({
        lastProfile: 'profile-1',
        lastBucket: 'bucket-1',
      });

      // Second save with partial update
      saveAppState({
        lastBucket: 'bucket-2',
      });

      const state = loadAppState();
      expect(state.lastProfile).toBe('profile-1'); // Should be preserved
      expect(state.lastBucket).toBe('bucket-2'); // Should be updated
    });

    it('should create directory if it does not exist', () => {
      // Remove test directory
      if (fs.existsSync(testStatePath)) {
        fs.unlinkSync(testStatePath);
      }
      if (fs.existsSync(testDataDir)) {
        fs.rmdirSync(testDataDir);
      }

      const success = saveAppState({ lastProfile: 'test' });
      expect(success).toBe(true);
      expect(fs.existsSync(testStatePath)).toBe(true);
    });

    it('should handle null values correctly', () => {
      saveAppState({
        lastProfile: null,
        lastBucket: null,
        lastPrefix: '',
      });

      const state = loadAppState();
      expect(state.lastProfile).toBeNull();
      expect(state.lastBucket).toBeNull();
      expect(state.lastPrefix).toBe('');
    });
  });

  describe('clearAppState', () => {
    it('should delete state file', () => {
      // Create state first
      saveAppState({ lastProfile: 'test' });
      expect(fs.existsSync(testStatePath)).toBe(true);

      // Clear it
      const success = clearAppState();
      expect(success).toBe(true);
      expect(fs.existsSync(testStatePath)).toBe(false);
    });

    it('should return true if file does not exist', () => {
      expect(fs.existsSync(testStatePath)).toBe(false);
      const success = clearAppState();
      expect(success).toBe(true);
    });
  });
});
