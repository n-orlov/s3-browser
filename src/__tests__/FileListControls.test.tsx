import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FileListControls, {
  sortItems,
  filterByType,
  filterBySearch,
  FILE_TYPE_FILTERS,
  SortConfig,
} from '../renderer/components/FileListControls';
import { S3Object } from '../renderer/components/FileList';

describe('FileListControls Component', () => {
  const defaultProps = {
    sortConfig: { field: 'name' as const, direction: 'asc' as const },
    onSortChange: vi.fn(),
    filterType: 'all',
    onFilterTypeChange: vi.fn(),
    searchQuery: '',
    onSearchChange: vi.fn(),
    totalCount: 10,
    filteredCount: 10,
  };

  describe('rendering', () => {
    it('renders search input', () => {
      render(<FileListControls {...defaultProps} />);
      expect(screen.getByPlaceholderText('Quick filter...')).toBeInTheDocument();
    });

    it('renders type filter dropdown', () => {
      render(<FileListControls {...defaultProps} />);
      expect(screen.getByLabelText('Filter by type')).toBeInTheDocument();
    });

    it('renders all file type options', () => {
      render(<FileListControls {...defaultProps} />);
      const select = screen.getByLabelText('Filter by type');
      FILE_TYPE_FILTERS.forEach((filter) => {
        expect(select).toContainHTML(filter.label);
      });
    });

    it('shows item count', () => {
      render(<FileListControls {...defaultProps} totalCount={20} filteredCount={15} />);
      expect(screen.getByText('15 of 20 items')).toBeInTheDocument();
    });

    it('shows simple count when all items shown', () => {
      render(<FileListControls {...defaultProps} totalCount={10} filteredCount={10} />);
      expect(screen.getByText('10 items')).toBeInTheDocument();
    });

    it('hides count when no items', () => {
      render(<FileListControls {...defaultProps} totalCount={0} filteredCount={0} />);
      expect(screen.queryByText('items')).not.toBeInTheDocument();
    });
  });

  describe('search functionality', () => {
    it('calls onSearchChange when typing', () => {
      const onSearchChange = vi.fn();
      render(<FileListControls {...defaultProps} onSearchChange={onSearchChange} />);

      const input = screen.getByPlaceholderText('Quick filter...');
      fireEvent.change(input, { target: { value: 'test' } });

      expect(onSearchChange).toHaveBeenCalledWith('test');
    });

    it('shows clear button when search has value', () => {
      render(<FileListControls {...defaultProps} searchQuery="test" />);
      expect(screen.getByTitle('Clear filter')).toBeInTheDocument();
    });

    it('hides clear button when search is empty', () => {
      render(<FileListControls {...defaultProps} searchQuery="" />);
      expect(screen.queryByTitle('Clear filter')).not.toBeInTheDocument();
    });

    it('clears search on clear button click', () => {
      const onSearchChange = vi.fn();
      render(<FileListControls {...defaultProps} searchQuery="test" onSearchChange={onSearchChange} />);

      fireEvent.click(screen.getByTitle('Clear filter'));
      expect(onSearchChange).toHaveBeenCalledWith('');
    });
  });

  describe('filter functionality', () => {
    it('calls onFilterTypeChange when selecting filter', () => {
      const onFilterTypeChange = vi.fn();
      render(<FileListControls {...defaultProps} onFilterTypeChange={onFilterTypeChange} />);

      const select = screen.getByLabelText('Filter by type');
      fireEvent.change(select, { target: { value: 'images' } });

      expect(onFilterTypeChange).toHaveBeenCalledWith('images');
    });
  });

  describe('disabled state', () => {
    it('disables search input when disabled', () => {
      render(<FileListControls {...defaultProps} disabled />);
      expect(screen.getByPlaceholderText('Quick filter...')).toBeDisabled();
    });

    it('disables filter dropdown when disabled', () => {
      render(<FileListControls {...defaultProps} disabled />);
      expect(screen.getByLabelText('Filter by type')).toBeDisabled();
    });
  });
});

describe('sortItems', () => {
  const createItem = (key: string, size: number, lastModified: Date | undefined, isPrefix: boolean): S3Object => ({
    key,
    size,
    lastModified,
    isPrefix,
  });

  const items: S3Object[] = [
    createItem('folder1/', 0, undefined, true),
    createItem('alpha.txt', 500, new Date('2024-01-15'), false),
    createItem('folder2/', 0, undefined, true),
    createItem('beta.json', 1000, new Date('2024-01-10'), false),
    createItem('zeta.csv', 200, new Date('2024-01-20'), false),
  ];

  describe('by name', () => {
    it('sorts ascending by name', () => {
      const config: SortConfig = { field: 'name', direction: 'asc' };
      const sorted = sortItems(items, config);

      // Folders first, then files
      expect(sorted[0].key).toBe('folder1/');
      expect(sorted[1].key).toBe('folder2/');
      expect(sorted[2].key).toBe('alpha.txt');
      expect(sorted[3].key).toBe('beta.json');
      expect(sorted[4].key).toBe('zeta.csv');
    });

    it('sorts descending by name', () => {
      const config: SortConfig = { field: 'name', direction: 'desc' };
      const sorted = sortItems(items, config);

      // Folders first (descending), then files (descending)
      expect(sorted[0].key).toBe('folder2/');
      expect(sorted[1].key).toBe('folder1/');
      expect(sorted[2].key).toBe('zeta.csv');
      expect(sorted[3].key).toBe('beta.json');
      expect(sorted[4].key).toBe('alpha.txt');
    });
  });

  describe('by size', () => {
    it('sorts ascending by size', () => {
      const config: SortConfig = { field: 'size', direction: 'asc' };
      const sorted = sortItems(items, config);

      // Folders first (size 0), then files by size
      expect(sorted[0].key).toBe('folder1/');
      expect(sorted[1].key).toBe('folder2/');
      expect(sorted[2].key).toBe('zeta.csv'); // 200
      expect(sorted[3].key).toBe('alpha.txt'); // 500
      expect(sorted[4].key).toBe('beta.json'); // 1000
    });

    it('sorts descending by size', () => {
      const config: SortConfig = { field: 'size', direction: 'desc' };
      const sorted = sortItems(items, config);

      // Folders still first, then files by size descending
      expect(sorted[0].key).toBe('folder1/');
      expect(sorted[1].key).toBe('folder2/');
      expect(sorted[2].key).toBe('beta.json'); // 1000
      expect(sorted[3].key).toBe('alpha.txt'); // 500
      expect(sorted[4].key).toBe('zeta.csv'); // 200
    });
  });

  describe('by lastModified', () => {
    it('sorts ascending by date', () => {
      const config: SortConfig = { field: 'lastModified', direction: 'asc' };
      const sorted = sortItems(items, config);

      // Folders first (no date = 0), then files by date
      expect(sorted[0].key).toBe('folder1/');
      expect(sorted[1].key).toBe('folder2/');
      expect(sorted[2].key).toBe('beta.json'); // Jan 10
      expect(sorted[3].key).toBe('alpha.txt'); // Jan 15
      expect(sorted[4].key).toBe('zeta.csv'); // Jan 20
    });

    it('sorts descending by date', () => {
      const config: SortConfig = { field: 'lastModified', direction: 'desc' };
      const sorted = sortItems(items, config);

      // Folders first, then files by date descending
      expect(sorted[0].key).toBe('folder1/');
      expect(sorted[1].key).toBe('folder2/');
      expect(sorted[2].key).toBe('zeta.csv'); // Jan 20
      expect(sorted[3].key).toBe('alpha.txt'); // Jan 15
      expect(sorted[4].key).toBe('beta.json'); // Jan 10
    });
  });

  it('keeps folders always first regardless of sort', () => {
    const config: SortConfig = { field: 'name', direction: 'asc' };
    const mixedItems: S3Object[] = [
      createItem('aaa.txt', 100, new Date(), false),
      createItem('zzz/', 0, undefined, true),
    ];
    const sorted = sortItems(mixedItems, config);

    expect(sorted[0].isPrefix).toBe(true);
    expect(sorted[1].isPrefix).toBe(false);
  });
});

describe('filterByType', () => {
  const createItem = (key: string, isPrefix: boolean): S3Object => ({
    key,
    size: 100,
    isPrefix,
  });

  const items: S3Object[] = [
    createItem('folder/', true),
    createItem('image.png', false),
    createItem('photo.jpg', false),
    createItem('doc.pdf', false),
    createItem('data.json', false),
    createItem('config.yaml', false),
    createItem('archive.zip', false),
    createItem('script.py', false),
  ];

  it('returns all items for "all" filter', () => {
    const filtered = filterByType(items, 'all');
    expect(filtered).toHaveLength(items.length);
  });

  it('always includes folders', () => {
    const filtered = filterByType(items, 'images');
    expect(filtered.some((i) => i.isPrefix)).toBe(true);
  });

  it('filters images correctly', () => {
    const filtered = filterByType(items, 'images');
    const fileNames = filtered.filter((i) => !i.isPrefix).map((i) => i.key);
    expect(fileNames).toContain('image.png');
    expect(fileNames).toContain('photo.jpg');
    expect(fileNames).not.toContain('doc.pdf');
    expect(fileNames).not.toContain('data.json');
  });

  it('filters documents correctly', () => {
    const filtered = filterByType(items, 'documents');
    const fileNames = filtered.filter((i) => !i.isPrefix).map((i) => i.key);
    expect(fileNames).toContain('doc.pdf');
    expect(fileNames).not.toContain('image.png');
    expect(fileNames).not.toContain('data.json');
  });

  it('filters data files correctly', () => {
    const filtered = filterByType(items, 'data');
    const fileNames = filtered.filter((i) => !i.isPrefix).map((i) => i.key);
    expect(fileNames).toContain('data.json');
    expect(fileNames).toContain('config.yaml');
    expect(fileNames).not.toContain('image.png');
    expect(fileNames).not.toContain('doc.pdf');
  });

  it('filters archives correctly', () => {
    const filtered = filterByType(items, 'archives');
    const fileNames = filtered.filter((i) => !i.isPrefix).map((i) => i.key);
    expect(fileNames).toContain('archive.zip');
    expect(fileNames).not.toContain('image.png');
  });

  it('filters code files correctly', () => {
    const filtered = filterByType(items, 'code');
    const fileNames = filtered.filter((i) => !i.isPrefix).map((i) => i.key);
    expect(fileNames).toContain('script.py');
    expect(fileNames).not.toContain('doc.pdf');
  });
});

describe('filterBySearch', () => {
  const createItem = (key: string, isPrefix: boolean): S3Object => ({
    key,
    size: 100,
    isPrefix,
  });

  const items: S3Object[] = [
    createItem('folder/', true),
    createItem('report-2024.pdf', false),
    createItem('Report_Final.docx', false),
    createItem('data.json', false),
    createItem('images/', true),
  ];

  it('returns all items for empty query', () => {
    const filtered = filterBySearch(items, '', '');
    expect(filtered).toHaveLength(items.length);
  });

  it('returns all items for whitespace query', () => {
    const filtered = filterBySearch(items, '   ', '');
    expect(filtered).toHaveLength(items.length);
  });

  it('filters by partial match (case insensitive)', () => {
    const filtered = filterBySearch(items, 'report', '');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((i) => i.key)).toContain('report-2024.pdf');
    expect(filtered.map((i) => i.key)).toContain('Report_Final.docx');
  });

  it('filters folders too', () => {
    const filtered = filterBySearch(items, 'folder', '');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe('folder/');
  });

  it('respects current prefix when matching', () => {
    const items: S3Object[] = [
      createItem('prefix/subfolder/', true),
      createItem('prefix/file.txt', false),
    ];
    const filtered = filterBySearch(items, 'sub', 'prefix/');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe('prefix/subfolder/');
  });

  it('matches anywhere in filename', () => {
    const filtered = filterBySearch(items, 'json', '');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe('data.json');
  });
});
