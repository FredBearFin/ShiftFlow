import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LaborAnalysisView } from '../LaborAnalysisView';
import { CompletionNote } from '../onboarding/CompletionNote';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

// jsdom has no blob URL support and no real navigation.
function stubDownload() {
  vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, {
    createObjectURL: () => 'blob:test',
    revokeObjectURL: () => undefined,
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
}

describe('async results announce themselves', () => {
  it('puts the payroll download confirmation in a polite live region', () => {
    stubDownload();

    render(<LaborAnalysisView solution={solutionFixture} />);
    fireEvent.click(screen.getByRole('button', { name: /Gusto CSV/ }));

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Gusto CSV');

    vi.restoreAllMocks();
  });

  it('keeps the confirmation until it is dismissed rather than on a timer', () => {
    stubDownload();
    vi.useFakeTimers();

    render(<LaborAnalysisView solution={solutionFixture} />);
    fireEvent.click(screen.getByRole('button', { name: /ADP CSV/ }));
    vi.advanceTimersByTime(10_000);
    expect(screen.getByRole('status').textContent).toContain('ADP CSV');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss download confirmation' }));
    expect(screen.getByRole('status').textContent).toBe('');

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('announces the schedule summary when a solve finishes', () => {
    render(<CompletionNote solution={solutionFixture} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Some hours you asked for are understaffed.');
  });
});
