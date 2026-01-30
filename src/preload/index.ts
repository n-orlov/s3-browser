import { contextBridge, ipcRenderer } from 'electron';

// Types for AWS credentials API
export interface ProfileInfo {
  name: string;
  region?: string;
  hasCredentials: boolean;
  isValid: boolean;
  validationMessage?: string;
}

export interface CredentialsState {
  profiles: ProfileInfo[];
  currentProfile: string | null;
  defaultRegion?: string;
}

export interface ProfileDetails {
  name: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  output?: string;
  sourceProfile?: string;
  roleArn?: string;
  hasCredentials: boolean;
}

// Types for S3 API
export interface S3Bucket {
  name: string;
  creationDate?: Date;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
  storageClass?: string;
  isPrefix: boolean;
}

export interface ListObjectsResult {
  objects: S3Object[];
  prefixes: S3Object[];
  continuationToken?: string;
  isTruncated: boolean;
  prefix: string;
  keyCount: number;
}

export interface ListObjectsOptions {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
  continuationToken?: string;
}

export interface S3ListBucketsResult {
  success: boolean;
  buckets?: S3Bucket[];
  error?: string;
}

export interface S3ListObjectsResult {
  success: boolean;
  result?: ListObjectsResult;
  error?: string;
}

export interface S3ParseUrlResult {
  success: boolean;
  bucket?: string;
  key?: string;
  error?: string;
}

export interface FileOperationResult {
  success: boolean;
  error?: string;
}

export interface UploadResult {
  path: string;
  success: boolean;
  error?: string;
}

export interface UploadFilesResult {
  success: boolean;
  results: UploadResult[];
}

// Types for App State API
export interface AppStateData {
  lastProfile: string | null;
  lastBucket: string | null;
  lastPrefix: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Platform info
  platform: process.platform,

  // App State persistence API
  appState: {
    load: (): Promise<AppStateData> => ipcRenderer.invoke('app-state:load'),
    save: (data: Partial<AppStateData>): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('app-state:save', data),
  },

  // AWS Credentials API
  aws: {
    getProfiles: (): Promise<CredentialsState> => ipcRenderer.invoke('aws:get-profiles'),
    setProfile: (profileName: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('aws:set-profile', profileName),
    getCurrentProfile: (): Promise<string | null> => ipcRenderer.invoke('aws:get-current-profile'),
    getProfileDetails: (profileName: string): Promise<ProfileDetails | null> =>
      ipcRenderer.invoke('aws:get-profile-details', profileName),
    refreshProfiles: (): Promise<CredentialsState> => ipcRenderer.invoke('aws:refresh-profiles'),
  },

  // S3 API
  s3: {
    listBuckets: (): Promise<S3ListBucketsResult> => ipcRenderer.invoke('s3:list-buckets'),
    listObjects: (options: ListObjectsOptions): Promise<S3ListObjectsResult> =>
      ipcRenderer.invoke('s3:list-objects', options),
    listAllObjects: (
      options: Omit<ListObjectsOptions, 'continuationToken'>,
      operationId: string
    ): Promise<S3ListObjectsResult> =>
      ipcRenderer.invoke('s3:list-all-objects', options, operationId),
    cancelOperation: (operationId: string): Promise<boolean> =>
      ipcRenderer.invoke('s3:cancel-operation', operationId),
    parseUrl: (url: string): Promise<S3ParseUrlResult> => ipcRenderer.invoke('s3:parse-url', url),
    getParentPrefix: (keyOrPrefix: string): Promise<string> =>
      ipcRenderer.invoke('s3:get-parent-prefix', keyOrPrefix),
    getKeyName: (keyOrPrefix: string): Promise<string> =>
      ipcRenderer.invoke('s3:get-key-name', keyOrPrefix),
    clearClient: (): Promise<void> => ipcRenderer.invoke('s3:clear-client'),

    // File operations
    downloadFile: (
      bucket: string,
      key: string,
      operationId: string
    ): Promise<FileOperationResult & { localPath?: string }> =>
      ipcRenderer.invoke('s3:download-file', bucket, key, operationId),
    uploadFile: (
      bucket: string,
      prefix: string,
      filePath: string,
      operationId: string
    ): Promise<FileOperationResult> =>
      ipcRenderer.invoke('s3:upload-file', bucket, prefix, filePath, operationId),
    uploadFiles: (
      bucket: string,
      prefix: string,
      filePaths: string[],
      operationId: string
    ): Promise<UploadFilesResult> =>
      ipcRenderer.invoke('s3:upload-files', bucket, prefix, filePaths, operationId),
    deleteFile: (bucket: string, key: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('s3:delete-file', bucket, key),
    renameFile: (bucket: string, sourceKey: string, newName: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('s3:rename-file', bucket, sourceKey, newName),
    copyFile: (
      sourceBucket: string,
      sourceKey: string,
      destinationBucket: string,
      destinationKey: string
    ): Promise<FileOperationResult> =>
      ipcRenderer.invoke('s3:copy-file', sourceBucket, sourceKey, destinationBucket, destinationKey),
    uploadContent: (bucket: string, key: string, content: string): Promise<FileOperationResult> =>
      ipcRenderer.invoke('s3:upload-content', bucket, key, content),
    downloadContent: (
      bucket: string,
      key: string
    ): Promise<{ success: boolean; content?: string; error?: string }> =>
      ipcRenderer.invoke('s3:download-content', bucket, key),
    getFileSize: (
      bucket: string,
      key: string
    ): Promise<{ success: boolean; size?: number; error?: string }> =>
      ipcRenderer.invoke('s3:get-file-size', bucket, key),
    downloadBinaryContent: (
      bucket: string,
      key: string
    ): Promise<{ success: boolean; data?: Uint8Array; error?: string }> =>
      ipcRenderer.invoke('s3:download-binary-content', bucket, key),
    showOpenDialog: (): Promise<string[] | null> => ipcRenderer.invoke('s3:show-open-dialog'),
    openDownloadsFolder: (): Promise<void> => ipcRenderer.invoke('s3:open-downloads-folder'),
    showFileInFolder: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('s3:show-file-in-folder', filePath),
  },
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      platform: NodeJS.Platform;
      appState: {
        load: () => Promise<AppStateData>;
        save: (data: Partial<AppStateData>) => Promise<{ success: boolean; error?: string }>;
      };
      aws: {
        getProfiles: () => Promise<CredentialsState>;
        setProfile: (profileName: string) => Promise<{ success: boolean; error?: string }>;
        getCurrentProfile: () => Promise<string | null>;
        getProfileDetails: (profileName: string) => Promise<ProfileDetails | null>;
        refreshProfiles: () => Promise<CredentialsState>;
      };
      s3: {
        listBuckets: () => Promise<S3ListBucketsResult>;
        listObjects: (options: ListObjectsOptions) => Promise<S3ListObjectsResult>;
        listAllObjects: (
          options: Omit<ListObjectsOptions, 'continuationToken'>,
          operationId: string
        ) => Promise<S3ListObjectsResult>;
        cancelOperation: (operationId: string) => Promise<boolean>;
        parseUrl: (url: string) => Promise<S3ParseUrlResult>;
        getParentPrefix: (keyOrPrefix: string) => Promise<string>;
        getKeyName: (keyOrPrefix: string) => Promise<string>;
        clearClient: () => Promise<void>;
        // File operations
        downloadFile: (
          bucket: string,
          key: string,
          operationId: string
        ) => Promise<FileOperationResult & { localPath?: string }>;
        uploadFile: (
          bucket: string,
          prefix: string,
          filePath: string,
          operationId: string
        ) => Promise<FileOperationResult>;
        uploadFiles: (
          bucket: string,
          prefix: string,
          filePaths: string[],
          operationId: string
        ) => Promise<UploadFilesResult>;
        deleteFile: (bucket: string, key: string) => Promise<FileOperationResult>;
        renameFile: (bucket: string, sourceKey: string, newName: string) => Promise<FileOperationResult>;
        copyFile: (
          sourceBucket: string,
          sourceKey: string,
          destinationBucket: string,
          destinationKey: string
        ) => Promise<FileOperationResult>;
        uploadContent: (bucket: string, key: string, content: string) => Promise<FileOperationResult>;
        downloadContent: (
          bucket: string,
          key: string
        ) => Promise<{ success: boolean; content?: string; error?: string }>;
        getFileSize: (
          bucket: string,
          key: string
        ) => Promise<{ success: boolean; size?: number; error?: string }>;
        downloadBinaryContent: (
          bucket: string,
          key: string
        ) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
        showOpenDialog: () => Promise<string[] | null>;
        openDownloadsFolder: () => Promise<void>;
        showFileInFolder: (filePath: string) => Promise<void>;
      };
    };
  }
}
