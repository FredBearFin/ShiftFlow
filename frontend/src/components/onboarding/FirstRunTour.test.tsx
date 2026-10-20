import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { FirstRunTour } from './FirstRunTour';

describe('FirstRunTour', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Escape dismisses the tour without reaching the wizard close handler', () => {
    const onDone = vi.fn();
    // Stands in for the page-level Escape handler in App.tsx that closes the wizard.
    const wizardClose = vi.fn();
    window.addEventListener('keydown', wizardClose);

    try {
      render(<FirstRunTour onDone={onDone} />);
      const dialog = screen.getByRole('dialog');

      fireEvent.keyDown(dialog, { key: 'Escape' });

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(wizardClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', wizardClose);
    }
  });
});
