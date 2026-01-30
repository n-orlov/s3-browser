/**
 * @jest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewItemDialog from '../renderer/components/NewItemDialog';

describe('NewItemDialog', () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    mockOnConfirm.mockClear();
    mockOnCancel.mockClear();
  });

  describe('when closed', () => {
    it('should not render anything when isOpen is false', () => {
      const { container } = render(
        <NewItemDialog
          isOpen={false}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('when open for new file', () => {
    it('should render with "New File" title', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByRole('heading', { name: 'New File' })).toBeInTheDocument();
    });

    it('should have default file name "new-file.txt"', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveValue('new-file.txt');
    });

    it('should show preview of the file path without prefix', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByText('new-file.txt')).toBeInTheDocument();
    });

    it('should show preview of the file path with prefix', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix="some/prefix/"
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByText('some/prefix/new-file.txt')).toBeInTheDocument();
    });

    it('should call onConfirm with the trimmed name when Create is clicked', async () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, '  myfile.json  ');
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      expect(mockOnConfirm).toHaveBeenCalledWith('myfile.json');
    });

    it('should call onCancel when Cancel is clicked', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('should call onCancel when overlay is clicked', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      fireEvent.click(screen.getByClassName('dialog-overlay'));
      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('should call onCancel when Escape key is pressed', async () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(mockOnCancel).toHaveBeenCalled();
    });

    it('should disable Create button when name is empty', async () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    });

    it('should disable Create button when name contains path separator', async () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'folder/file.txt');
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    });
  });

  describe('when open for new folder', () => {
    it('should render with "New Folder" title', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="folder"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByRole('heading', { name: 'New Folder' })).toBeInTheDocument();
    });

    it('should have default folder name "new-folder"', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="folder"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveValue('new-folder');
    });

    it('should show preview of the folder path with trailing slash', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="folder"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByText('new-folder/')).toBeInTheDocument();
    });

    it('should show preview of the folder path with prefix', () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="folder"
          currentPrefix="some/prefix/"
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      expect(screen.getByText('some/prefix/new-folder/')).toBeInTheDocument();
    });

    it('should call onConfirm with the folder name when Create is clicked', async () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="folder"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'my-new-folder');
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));
      expect(mockOnConfirm).toHaveBeenCalledWith('my-new-folder');
    });
  });

  describe('form submission', () => {
    it('should call onConfirm when form is submitted via Enter key', async () => {
      render(
        <NewItemDialog
          isOpen={true}
          itemType="file"
          currentPrefix=""
          onConfirm={mockOnConfirm}
          onCancel={mockOnCancel}
        />
      );
      const input = screen.getByRole('textbox');
      await userEvent.clear(input);
      await userEvent.type(input, 'test.txt{enter}');
      expect(mockOnConfirm).toHaveBeenCalledWith('test.txt');
    });
  });
});

// Helper function for testing class presence
function getByClassName(className: string): Element {
  const element = document.querySelector(`.${className}`);
  if (!element) {
    throw new Error(`Element with class "${className}" not found`);
  }
  return element;
}

// Add to screen
Object.assign(screen, { getByClassName });
