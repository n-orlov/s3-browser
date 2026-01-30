import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BucketTree from '../renderer/components/BucketTree';
import { mockElectronAPI } from './setup';

describe('BucketTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('without profile', () => {
    it('shows placeholder when no profile selected', () => {
      render(
        <BucketTree
          currentProfile={null}
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      expect(screen.getByText('Select a profile to view buckets')).toBeInTheDocument();
    });
  });

  describe('with profile', () => {
    it('shows loading state initially', () => {
      // Make the API call hang
      mockElectronAPI.s3.listBuckets.mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      expect(screen.getByText('Loading buckets...')).toBeInTheDocument();
    });

    it('displays buckets after loading', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [
          { name: 'bucket-alpha', creationDate: new Date() },
          { name: 'bucket-beta', creationDate: new Date() },
        ],
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('bucket-alpha')).toBeInTheDocument();
        expect(screen.getByText('bucket-beta')).toBeInTheDocument();
      });
    });

    it('shows empty message when no buckets', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [],
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No buckets found')).toBeInTheDocument();
      });
    });

    it('shows error message on API failure', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: false,
        error: 'Access Denied',
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Access Denied')).toBeInTheDocument();
      });
    });

    it('calls onSelectBucket when bucket is clicked', async () => {
      const onSelectBucket = vi.fn();
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'my-bucket', creationDate: new Date() }],
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={onSelectBucket}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-bucket')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('my-bucket'));
      expect(onSelectBucket).toHaveBeenCalledWith('my-bucket');
    });

    it('highlights selected bucket', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [
          { name: 'bucket-1', creationDate: new Date() },
          { name: 'bucket-2', creationDate: new Date() },
        ],
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket="bucket-1"
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('bucket-1')).toBeInTheDocument();
      });

      const selectedItem = screen.getByText('bucket-1').closest('.bucket-item');
      expect(selectedItem).toHaveClass('selected');

      const unselectedItem = screen.getByText('bucket-2').closest('.bucket-item');
      expect(unselectedItem).not.toHaveClass('selected');
    });

    it('reloads buckets when profile changes', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'bucket-a', creationDate: new Date() }],
      });

      const { rerender } = render(
        <BucketTree
          currentProfile="profile-1"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('bucket-a')).toBeInTheDocument();
      });

      expect(mockElectronAPI.s3.listBuckets).toHaveBeenCalledTimes(1);

      // Change profile
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'bucket-b', creationDate: new Date() }],
      });

      rerender(
        <BucketTree
          currentProfile="profile-2"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('bucket-b')).toBeInTheDocument();
      });

      expect(mockElectronAPI.s3.listBuckets).toHaveBeenCalledTimes(2);
    });

    it('handles keyboard navigation', async () => {
      const onSelectBucket = vi.fn();
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [{ name: 'test-bucket', creationDate: new Date() }],
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={onSelectBucket}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('test-bucket')).toBeInTheDocument();
      });

      const bucketItem = screen.getByText('test-bucket').closest('.bucket-item')!;
      fireEvent.keyDown(bucketItem, { key: 'Enter' });

      expect(onSelectBucket).toHaveBeenCalledWith('test-bucket');
    });

    it('retries loading on retry button click', async () => {
      mockElectronAPI.s3.listBuckets.mockResolvedValueOnce({
        success: false,
        error: 'Network error',
      });

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });

      mockElectronAPI.s3.listBuckets.mockResolvedValueOnce({
        success: true,
        buckets: [{ name: 'recovered-bucket', creationDate: new Date() }],
      });

      fireEvent.click(screen.getByText('Retry'));

      await waitFor(() => {
        expect(screen.getByText('recovered-bucket')).toBeInTheDocument();
      });
    });
  });

  describe('bucket filter', () => {
    beforeEach(() => {
      mockElectronAPI.s3.listBuckets.mockResolvedValue({
        success: true,
        buckets: [
          { name: 'my-production-bucket', creationDate: new Date() },
          { name: 'my-staging-bucket', creationDate: new Date() },
          { name: 'data-lake-raw', creationDate: new Date() },
          { name: 'data-lake-processed', creationDate: new Date() },
          { name: 'logs-archive', creationDate: new Date() },
        ],
      });
    });

    it('renders filter input when buckets are loaded', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Filter buckets (contains)...')).toBeInTheDocument();
      });
    });

    it('shows total bucket count initially', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('5 buckets')).toBeInTheDocument();
      });
    });

    it('filters buckets using case-insensitive contains logic', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');
      fireEvent.change(filterInput, { target: { value: 'production' } });

      // Only production bucket should be visible
      expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      expect(screen.queryByText('my-staging-bucket')).not.toBeInTheDocument();
      expect(screen.queryByText('data-lake-raw')).not.toBeInTheDocument();
    });

    it('filter is case-insensitive', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');

      // Test uppercase filter
      fireEvent.change(filterInput, { target: { value: 'PRODUCTION' } });
      expect(screen.getByText('my-production-bucket')).toBeInTheDocument();

      // Test mixed case filter
      fireEvent.change(filterInput, { target: { value: 'ProDuCtiOn' } });
      expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
    });

    it('shows filtered count when filter is active', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('5 buckets')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');
      fireEvent.change(filterInput, { target: { value: 'data-lake' } });

      expect(screen.getByText('2 of 5 buckets')).toBeInTheDocument();
    });

    it('shows clear button when filter has text', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      });

      // No clear button initially
      expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument();

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');
      fireEvent.change(filterInput, { target: { value: 'staging' } });

      // Clear button should appear
      expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument();
    });

    it('clears filter when clear button is clicked', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');
      fireEvent.change(filterInput, { target: { value: 'staging' } });

      // Only staging bucket visible
      expect(screen.queryByText('my-production-bucket')).not.toBeInTheDocument();
      expect(screen.getByText('my-staging-bucket')).toBeInTheDocument();

      // Click clear
      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

      // All buckets visible again
      expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      expect(screen.getByText('my-staging-bucket')).toBeInTheDocument();
      expect(screen.getByText('data-lake-raw')).toBeInTheDocument();
    });

    it('shows "No matching buckets" when filter matches nothing', async () => {
      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');
      fireEvent.change(filterInput, { target: { value: 'nonexistent' } });

      expect(screen.getByText('No matching buckets')).toBeInTheDocument();
      expect(screen.getByText('0 of 5 buckets')).toBeInTheDocument();
    });

    it('can still select filtered buckets', async () => {
      const onSelectBucket = vi.fn();

      render(
        <BucketTree
          currentProfile="test-profile"
          selectedBucket={null}
          onSelectBucket={onSelectBucket}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('my-production-bucket')).toBeInTheDocument();
      });

      const filterInput = screen.getByPlaceholderText('Filter buckets (contains)...');
      fireEvent.change(filterInput, { target: { value: 'staging' } });

      fireEvent.click(screen.getByText('my-staging-bucket'));
      expect(onSelectBucket).toHaveBeenCalledWith('my-staging-bucket');
    });
  });
});
