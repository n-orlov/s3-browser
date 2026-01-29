import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../renderer/App';

describe('App', () => {
  it('renders the app header with title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('S3 Browser');
  });

  it('renders the sidebar with Buckets section', () => {
    render(<App />);
    expect(screen.getByText('Buckets')).toBeInTheDocument();
  });

  it('renders the main content area with Files section', () => {
    render(<App />);
    expect(screen.getByText('Files')).toBeInTheDocument();
  });

  it('shows placeholder text when no bucket is selected', () => {
    render(<App />);
    expect(screen.getByText('Select a bucket to view files')).toBeInTheDocument();
  });
});
