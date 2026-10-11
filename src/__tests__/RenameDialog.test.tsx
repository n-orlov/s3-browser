/**
 * @jest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RenameDialog from '../renderer/components/RenameDialog';

function renderDialog(isOpen: boolean, currentName = 'report.txt') {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const ui = (open: boolean, name: string) => (
    <RenameDialog isOpen={open} currentName={name} onConfirm={onConfirm} onCancel={onCancel} />
  );
  const view = render(ui(isOpen, currentName));
  return { ...view, ui, onConfirm, onCancel };
}

describe('RenameDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = renderDialog(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts with the current name in the input', () => {
    renderDialog(true);
    expect(screen.getByLabelText('New name:')).toHaveValue('report.txt');
  });

  it('confirms the trimmed new name and disables Rename for an unchanged name', () => {
    const { onConfirm } = renderDialog(true);
    const button = screen.getByRole('button', { name: 'Rename' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New name:'), { target: { value: ' other.txt ' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledWith('other.txt');
  });

  it('cancels on Escape', () => {
    const { onCancel } = renderDialog(true);
    fireEvent.keyDown(screen.getByLabelText('New name:'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('re-opening the dialog resets the input to the current name, discarding typed text', () => {
    const { rerender, ui } = renderDialog(true);
    fireEvent.change(screen.getByLabelText('New name:'), { target: { value: 'typed-then-closed' } });
    expect(screen.getByLabelText('New name:')).toHaveValue('typed-then-closed');

    rerender(ui(false, 'report.txt'));
    expect(screen.queryByLabelText('New name:')).not.toBeInTheDocument();

    rerender(ui(true, 'report.txt'));
    expect(screen.getByLabelText('New name:')).toHaveValue('report.txt');
  });

  it('re-opening for a different file shows that file name', () => {
    const { rerender, ui } = renderDialog(true, 'a.txt');
    fireEvent.change(screen.getByLabelText('New name:'), { target: { value: 'edited' } });
    rerender(ui(false, 'a.txt'));
    rerender(ui(true, 'b.txt'));
    expect(screen.getByLabelText('New name:')).toHaveValue('b.txt');
  });
});
