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

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Platform info
  platform: process.platform,

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
  },
});

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
      getAppVersion: () => Promise<string>;
      platform: NodeJS.Platform;
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
      };
    };
  }
}
