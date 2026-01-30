import '@testing-library/dom';
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock electronAPI for renderer tests
const mockElectronAPI = {
  getAppVersion: vi.fn(() => Promise.resolve('0.1.0')),
  platform: 'linux' as NodeJS.Platform,
  appState: {
    load: vi.fn(() =>
      Promise.resolve({
        lastProfile: null,
        lastBucket: null,
        lastPrefix: '',
      })
    ),
    save: vi.fn(() => Promise.resolve({ success: true })),
  },
  aws: {
    getProfiles: vi.fn(() =>
      Promise.resolve({
        profiles: [],
        currentProfile: null,
        defaultRegion: undefined,
      })
    ),
    setProfile: vi.fn((profileName: string) =>
      Promise.resolve({ success: true })
    ),
    getCurrentProfile: vi.fn(() => Promise.resolve(null)),
    getProfileDetails: vi.fn(() => Promise.resolve(null)),
    refreshProfiles: vi.fn(() =>
      Promise.resolve({
        profiles: [],
        currentProfile: null,
        defaultRegion: undefined,
      })
    ),
  },
  s3: {
    listBuckets: vi.fn(() =>
      Promise.resolve({ success: true, buckets: [] })
    ),
    listObjects: vi.fn(() =>
      Promise.resolve({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 0,
        },
      })
    ),
    listAllObjects: vi.fn(() =>
      Promise.resolve({
        success: true,
        result: {
          objects: [],
          prefixes: [],
          continuationToken: undefined,
          isTruncated: false,
          prefix: '',
          keyCount: 0,
        },
      })
    ),
    cancelOperation: vi.fn(() => Promise.resolve(true)),
    parseUrl: vi.fn((url: string) =>
      Promise.resolve({ success: false, error: 'Not implemented' })
    ),
    getParentPrefix: vi.fn((key: string) => Promise.resolve('')),
    getKeyName: vi.fn((key: string) => Promise.resolve(key)),
    clearClient: vi.fn(() => Promise.resolve()),
    // File operations
    downloadFile: vi.fn(() => Promise.resolve({ success: true, localPath: '/downloads/file.txt' })),
    uploadFile: vi.fn(() => Promise.resolve({ success: true })),
    uploadFiles: vi.fn(() => Promise.resolve({ success: true, results: [] })),
    deleteFile: vi.fn(() => Promise.resolve({ success: true })),
    renameFile: vi.fn(() => Promise.resolve({ success: true })),
    copyFile: vi.fn(() => Promise.resolve({ success: true })),
    uploadContent: vi.fn(() => Promise.resolve({ success: true })),
    downloadContent: vi.fn(() => Promise.resolve({ success: true, content: '' })),
    getFileSize: vi.fn(() => Promise.resolve({ success: true, size: 0 })),
    downloadBinaryContent: vi.fn(() => Promise.resolve({ success: true, data: new Uint8Array() })),
    showOpenDialog: vi.fn(() => Promise.resolve(null)),
    openDownloadsFolder: vi.fn(() => Promise.resolve()),
    showFileInFolder: vi.fn(() => Promise.resolve()),
  },
};

// Assign to window
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Export for test access
export { mockElectronAPI };

// Cleanup after each test
afterEach(() => {
  cleanup();
  // Reset all mocks after each test
  vi.clearAllMocks();
});
