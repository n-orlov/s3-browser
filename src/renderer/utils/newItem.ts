export type NewItemKind = 'file' | 'folder';

export interface NewItemResult {
  success: boolean;
  error?: string;
}

export interface NewItemToast {
  type: 'success' | 'error';
  title: string;
  message: string;
  duration: number;
}

export interface NewItemOperations {
  createFile: (bucket: string, key: string) => Promise<NewItemResult>;
  createFolder: (bucket: string, key: string) => Promise<NewItemResult>;
}

/** Creates an empty file or a folder marker object, depending on the kind. */
export function createNewItem(
  ops: NewItemOperations,
  bucket: string,
  key: string,
  kind: NewItemKind
): Promise<NewItemResult> {
  return kind === 'file' ? ops.createFile(bucket, key) : ops.createFolder(bucket, key);
}

/** The toast reporting the outcome of creating an item named `name`. */
export function getNewItemToast(kind: NewItemKind, name: string, result: NewItemResult): NewItemToast {
  if (result.success) {
    return {
      type: 'success',
      title: kind === 'file' ? 'File Created' : 'Folder Created',
      message: name,
      duration: 3000,
    };
  }
  return { type: 'error', title: 'Creation Failed', message: result.error || 'Unknown error', duration: 5000 };
}
