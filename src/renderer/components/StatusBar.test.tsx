import React from 'react';
import { render, screen } from '@testing-library/react';
import StatusBar from './StatusBar';
import type { S3Object } from './FileList';

describe('StatusBar', () => {
  const createFile = (key: string, size: number): S3Object => ({
    key,
    size,
    isPrefix: false,
    lastModified: new Date(),
  });

  const createFolder = (key: string): S3Object => ({
    key,
    size: 0,
    isPrefix: true,
  });

  describe('item count display', () => {
    it('shows item count when all items are loaded', () => {
      render(
        <StatusBar
          loadedCount={42}
          allLoaded={true}
          selectedFiles={[]}
        />
      );

      expect(screen.getByTestId('status-bar-items')).toHaveTextContent('42 items');
    });

    it('shows item count with "more available" when not all loaded', () => {
      render(
        <StatusBar
          loadedCount={100}
          allLoaded={false}
          selectedFiles={[]}
        />
      );

      expect(screen.getByTestId('status-bar-items')).toHaveTextContent('100 items loaded (more available)');
    });

    it('shows loading indicator when loading more', () => {
      render(
        <StatusBar
          loadedCount={100}
          allLoaded={false}
          selectedFiles={[]}
          loading={true}
        />
      );

      expect(screen.getByTestId('status-bar-items')).toHaveTextContent('100 items loaded...');
    });

    it('shows 0 items correctly', () => {
      render(
        <StatusBar
          loadedCount={0}
          allLoaded={true}
          selectedFiles={[]}
        />
      );

      expect(screen.getByTestId('status-bar-items')).toHaveTextContent('0 items');
    });
  });

  describe('selection display', () => {
    it('shows "No selection" when no files selected', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[]}
        />
      );

      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('No selection');
    });

    it('shows selection count and size for single file', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[createFile('test.txt', 1024)]}
        />
      );

      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('1 selected (1.0 KB)');
    });

    it('shows selection count and total size for multiple files', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[
            createFile('file1.txt', 1024),
            createFile('file2.txt', 2048),
            createFile('file3.txt', 1024),
          ]}
        />
      );

      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('3 selected (4.0 KB)');
    });

    it('excludes folders from selection count and size', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[
            createFile('file1.txt', 1024),
            createFolder('folder1/'),
            createFile('file2.txt', 1024),
          ]}
        />
      );

      // Should only count 2 files, not the folder
      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('2 selected (2.0 KB)');
    });

    it('formats large sizes correctly', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[
            createFile('large.zip', 1024 * 1024 * 500), // 500 MB
          ]}
        />
      );

      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('1 selected (500.0 MB)');
    });

    it('formats GB sizes correctly', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[
            createFile('huge.zip', 1024 * 1024 * 1024 * 2.5), // 2.5 GB
          ]}
        />
      );

      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('1 selected (2.5 GB)');
    });

    it('shows 0 B for zero-sized file', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[createFile('empty.txt', 0)]}
        />
      );

      expect(screen.getByTestId('status-bar-selection')).toHaveTextContent('1 selected (0 B)');
    });
  });

  describe('rendering', () => {
    it('renders status bar container with data-testid', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[]}
        />
      );

      expect(screen.getByTestId('status-bar')).toBeInTheDocument();
    });

    it('has correct CSS class', () => {
      render(
        <StatusBar
          loadedCount={10}
          allLoaded={true}
          selectedFiles={[]}
        />
      );

      const statusBar = screen.getByTestId('status-bar');
      expect(statusBar).toHaveClass('status-bar');
    });
  });
});
