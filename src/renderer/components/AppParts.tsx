import React from 'react';
import type { S3Object } from './FileList';
import TextEditor from './TextEditor';
import ParquetViewer from './ParquetViewer';
import CsvViewer from './CsvViewer';
import JsonViewer from './JsonViewer';
import YamlViewer from './YamlViewer';
import ImagePreview from './ImagePreview';
import { getFileNameOrKey, getLastSegment } from '../utils/appView';

interface SelectedFileInfoProps {
  selectedFile: S3Object | null;
  selectedCount: number;
}

/** Header summary of the current selection: a count for multi-select, the file name for one file, nothing otherwise. */
export function SelectedFileInfo({ selectedFile, selectedCount }: SelectedFileInfoProps): React.ReactElement | null {
  if (selectedCount > 1) {
    return (
      <div className="selected-file-info">
        <span className="selected-label">Selected:</span>
        <span className="selected-name selected-count">{selectedCount} files</span>
      </div>
    );
  }
  if (!selectedFile) return null;
  return (
    <div className="selected-file-info">
      <span className="selected-label">Selected:</span>
      <span className="selected-name" title={selectedFile.key}>
        {getLastSegment(selectedFile.key)}
      </span>
    </div>
  );
}

export interface OpenViewers {
  editor: boolean;
  parquet: boolean;
  csv: boolean;
  json: boolean;
  yaml: boolean;
  image: boolean;
}

interface FileViewersProps {
  bucket: string | null;
  file: S3Object | null;
  open: OpenViewers;
  onCloseEditor: () => void;
  onEditorSaved: () => void;
  onCloseParquet: () => void;
  onCloseCsv: () => void;
  onCloseJson: () => void;
  onCloseYaml: () => void;
  onCloseImage: () => void;
}

/** Renders whichever file viewer is open; renders nothing without a selected bucket and file. */
export function FileViewers(props: FileViewersProps): React.ReactElement | null {
  const { bucket, file, open } = props;
  if (!bucket || !file) return null;
  const common = { bucket, fileKey: file.key, fileName: getFileNameOrKey(file.key) };
  const sized = { ...common, fileSize: file.size };
  return (
    <>
      {open.editor && (
        <TextEditor {...common} onClose={props.onCloseEditor} onSaved={props.onEditorSaved} />
      )}
      {open.parquet && <ParquetViewer {...sized} onClose={props.onCloseParquet} />}
      {open.csv && <CsvViewer {...sized} onClose={props.onCloseCsv} />}
      {open.json && <JsonViewer {...sized} onClose={props.onCloseJson} />}
      {open.yaml && <YamlViewer {...sized} onClose={props.onCloseYaml} />}
      {open.image && <ImagePreview {...sized} onClose={props.onCloseImage} />}
    </>
  );
}
