export const FOLDER_ICON = '📁';
export const DEFAULT_FILE_ICON = '📄';

/** Icon per lower-case file extension; extensions not listed use DEFAULT_FILE_ICON. */
export const EXTENSION_ICONS: Readonly<Record<string, string>> = {
  json: '📋',
  yaml: '📋',
  yml: '📋',
  txt: '📄',
  csv: '📊',
  parquet: '📊',
  png: '🖼️',
  jpg: '🖼️',
  jpeg: '🖼️',
  gif: '🖼️',
  webp: '🖼️',
  pdf: '📕',
  zip: '📦',
  tar: '📦',
  gz: '📦',
};

/** Lower-case text after the last '.' of the key (the whole key lower-cased when it has no dot). */
export function getKeyExtension(key: string): string {
  return key.split('.').pop()?.toLowerCase() ?? '';
}

/** Icon for a file extension (already lower-cased). */
export function getIconForExtension(ext: string): string {
  return Object.hasOwn(EXTENSION_ICONS, ext) ? EXTENSION_ICONS[ext] : DEFAULT_FILE_ICON;
}
