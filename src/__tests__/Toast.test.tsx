import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastContainer, useToasts, type ToastMessage } from '../renderer/components/Toast';
import { renderHook } from '@testing-library/react';

describe('ToastContainer', () => {
  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    mockOnDismiss.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createTestToast = (overrides?: Partial<ToastMessage>): ToastMessage => ({
    id: 'test-toast-1',
    type: 'info',
    title: 'Test Title',
    message: 'Test message',
    duration: 5000,
    ...overrides,
  });

  it('renders toasts correctly', () => {
    const toasts: ToastMessage[] = [
      createTestToast({ id: 'toast-1', title: 'First Toast' }),
      createTestToast({ id: 'toast-2', title: 'Second Toast' }),
    ];

    render(<ToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('First Toast')).toBeInTheDocument();
    expect(screen.getByText('Second Toast')).toBeInTheDocument();
  });

  it('renders empty when no toasts', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={mockOnDismiss} />);
    expect(container.querySelector('.toast-container')).toBeInTheDocument();
    expect(container.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('displays toast title and message', () => {
    const toast = createTestToast({ title: 'Alert Title', message: 'Alert message content' });
    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    expect(screen.getByText('Alert Title')).toBeInTheDocument();
    expect(screen.getByText('Alert message content')).toBeInTheDocument();
  });

  it('applies correct class based on toast type', () => {
    const toasts: ToastMessage[] = [
      createTestToast({ id: 'success', type: 'success', title: 'Success' }),
      createTestToast({ id: 'error', type: 'error', title: 'Error' }),
      createTestToast({ id: 'warning', type: 'warning', title: 'Warning' }),
      createTestToast({ id: 'info', type: 'info', title: 'Info' }),
    ];

    const { container } = render(<ToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(container.querySelector('.toast-success')).toBeInTheDocument();
    expect(container.querySelector('.toast-error')).toBeInTheDocument();
    expect(container.querySelector('.toast-warning')).toBeInTheDocument();
    expect(container.querySelector('.toast-info')).toBeInTheDocument();
  });

  it('calls onDismiss when dismiss button clicked', async () => {
    const toast = createTestToast({ duration: 0 }); // Persistent toast
    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    const dismissButton = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissButton);

    // Wait for exit animation
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(mockOnDismiss).toHaveBeenCalledWith('test-toast-1');
  });

  it('auto-dismisses toast after duration', async () => {
    const toast = createTestToast({ duration: 3000 });
    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    // Advance timers by duration + animation
    act(() => {
      vi.advanceTimersByTime(3200);
    });

    expect(mockOnDismiss).toHaveBeenCalledWith('test-toast-1');
  });

  it('does not auto-dismiss when duration is 0', () => {
    const toast = createTestToast({ duration: 0 });
    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(mockOnDismiss).not.toHaveBeenCalled();
  });

  it('displays correct icon for each type', () => {
    const toasts: ToastMessage[] = [
      createTestToast({ id: 'success', type: 'success', title: 'Success' }),
      createTestToast({ id: 'error', type: 'error', title: 'Error' }),
    ];

    const { container } = render(<ToastContainer toasts={toasts} onDismiss={mockOnDismiss} />);

    expect(container.querySelector('.toast-icon-success')).toBeInTheDocument();
    expect(container.querySelector('.toast-icon-error')).toBeInTheDocument();
  });

  it('renders action button when action is provided', () => {
    const mockAction = vi.fn();
    const toast = createTestToast({
      action: { label: 'Show in folder', onClick: mockAction },
    });

    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    const actionButton = screen.getByRole('button', { name: /show in folder/i });
    expect(actionButton).toBeInTheDocument();
  });

  it('calls action onClick when action button clicked', () => {
    const mockAction = vi.fn();
    const toast = createTestToast({
      action: { label: 'Show in folder', onClick: mockAction },
    });

    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    const actionButton = screen.getByRole('button', { name: /show in folder/i });
    fireEvent.click(actionButton);

    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('does not render action button when action is not provided', () => {
    const toast = createTestToast(); // No action

    render(<ToastContainer toasts={[toast]} onDismiss={mockOnDismiss} />);

    expect(screen.queryByRole('button', { name: /show in folder/i })).not.toBeInTheDocument();
    // Should still have dismiss button
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });
});

describe('useToasts hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes with empty toasts array', () => {
    const { result } = renderHook(() => useToasts());
    expect(result.current.toasts).toEqual([]);
  });

  it('adds toast with generated id', () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.addToast({
        type: 'success',
        title: 'Test Toast',
        message: 'Test message',
      });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].id).toMatch(/^toast-\d+-\d+$/);
    expect(result.current.toasts[0].title).toBe('Test Toast');
  });

  it('returns toast id when adding', () => {
    const { result } = renderHook(() => useToasts());

    let id: string = '';
    act(() => {
      id = result.current.addToast({
        type: 'info',
        title: 'Test',
      });
    });

    expect(id).toMatch(/^toast-\d+-\d+$/);
    expect(result.current.toasts[0].id).toBe(id);
  });

  it('removes toast by id', () => {
    const { result } = renderHook(() => useToasts());

    let toastId: string = '';
    act(() => {
      toastId = result.current.addToast({ type: 'info', title: 'Test' });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      result.current.removeToast(toastId);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('clears all toasts', () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.addToast({ type: 'info', title: 'Toast 1' });
      result.current.addToast({ type: 'success', title: 'Toast 2' });
      result.current.addToast({ type: 'error', title: 'Toast 3' });
    });

    expect(result.current.toasts).toHaveLength(3);

    act(() => {
      result.current.clearToasts();
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it('sets default duration of 5000ms', () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.addToast({ type: 'info', title: 'Test' });
    });

    expect(result.current.toasts[0].duration).toBe(5000);
  });

  it('respects custom duration', () => {
    const { result } = renderHook(() => useToasts());

    act(() => {
      result.current.addToast({ type: 'info', title: 'Test', duration: 10000 });
    });

    expect(result.current.toasts[0].duration).toBe(10000);
  });
});
