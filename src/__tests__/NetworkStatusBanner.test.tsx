import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import NetworkStatusBanner from '../renderer/components/NetworkStatusBanner';

describe('NetworkStatusBanner', () => {
  let onlineSpy: { mockReturnValue: (val: boolean) => void };

  beforeEach(() => {
    onlineSpy = vi.spyOn(navigator, 'onLine', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when online and never been offline', () => {
    onlineSpy.mockReturnValue(true);

    const { container } = render(<NetworkStatusBanner />);

    expect(container.querySelector('.network-banner')).not.toBeInTheDocument();
  });

  it('shows offline banner when offline', () => {
    onlineSpy.mockReturnValue(false);

    render(<NetworkStatusBanner />);

    expect(screen.getByText(/you are currently offline/i)).toBeInTheDocument();
    expect(document.querySelector('.network-banner-offline')).toBeInTheDocument();
  });

  it('shows reconnected banner after coming back online', () => {
    onlineSpy.mockReturnValue(true);

    render(<NetworkStatusBanner />);

    // Initially nothing shown
    expect(document.querySelector('.network-banner')).not.toBeInTheDocument();

    // Go offline
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText(/you are currently offline/i)).toBeInTheDocument();

    // Come back online
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.getByText(/connection restored/i)).toBeInTheDocument();
    expect(document.querySelector('.network-banner-online')).toBeInTheDocument();
  });

  it('displays warning icon when offline', () => {
    onlineSpy.mockReturnValue(false);

    const { container } = render(<NetworkStatusBanner />);

    expect(container.querySelector('.network-banner-icon')).toBeInTheDocument();
  });

  it('displays check icon when online after being offline', () => {
    onlineSpy.mockReturnValue(true);

    render(<NetworkStatusBanner />);

    // Go offline then online
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    const icon = document.querySelector('.network-banner-icon');
    expect(icon).toBeInTheDocument();
    expect(icon?.textContent).toBe('\u2713'); // checkmark
  });
});
