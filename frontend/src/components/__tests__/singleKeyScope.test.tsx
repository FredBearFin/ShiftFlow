import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ParetoExplorerView } from '../ParetoExplorerView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

/**
 * Stands in for App's global single-key handler: it listens on window, with the
 * same guard, and records the week-navigation keys that reach it.
 */
function installGlobalHandler(seen: string[]) {
  const handler = (e: KeyboardEvent) => {
    const activeEl = document.activeElement as HTMLElement | null;
    const activeTag = activeEl ? activeEl.tagName : '';
    const isFocusableWidget =
      !!activeEl && (activeEl.getAttribute('role') === 'button' || activeEl.hasAttribute('tabindex'));
    if (
      ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(activeTag) ||
      activeEl?.isContentEditable ||
      isFocusableWidget
    ) {
      return;
    }
    if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') seen.push(e.key);
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

describe('a single keypress fires one action', () => {
  it('does not also advance the week when a frontier row handles the key', () => {
    const onSelect = vi.fn();
    const seen: string[] = [];
    const remove = installGlobalHandler(seen);

    const { container } = render(
      <ParetoExplorerView
        solution={solutionFixture}
        selectedLeewayPct={10}
        onSelectLeewayPct={onSelect}
      />
    );

    const row = container.querySelector('div[role="button"][tabindex="0"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.focus();

    fireEvent.keyDown(row, { key: ' ', bubbles: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);

    fireEvent.keyDown(row, { key: 'ArrowRight', bubbles: true });
    expect(seen).toEqual([]);

    remove();
  });

  it('still reaches the global handler from the page body', () => {
    const seen: string[] = [];
    const remove = installGlobalHandler(seen);

    render(
      <ParetoExplorerView
        solution={solutionFixture}
        selectedLeewayPct={10}
        onSelectLeewayPct={vi.fn()}
      />
    );
    (document.activeElement as HTMLElement | null)?.blur();

    fireEvent.keyDown(document.body, { key: 'ArrowRight', bubbles: true });
    expect(seen).toEqual(['ArrowRight']);

    remove();
  });

  it('leaves the Apply buttons as the mouse-free way to pick a point', () => {
    const onSelect = vi.fn();
    render(
      <ParetoExplorerView
        solution={solutionFixture}
        selectedLeewayPct={10}
        onSelectLeewayPct={onSelect}
      />
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0]);
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});
