import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Header } from '../Header';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

describe('view tabs carry their state in markup', () => {
  it('marks exactly the active tab with aria-current="page"', () => {
    const { container, rerender } = render(
      <Header
        activeTab="roster"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={solutionFixture}
        leewayPct={10}
      />
    );

    const current = () =>
      Array.from(container.querySelectorAll('nav button[aria-current="page"]')).map(
        (b) => (b.textContent || '').trim()
      );

    expect(current().length).toBe(1);
    expect(current()[0]).toContain('Weekly Schedule');

    rerender(
      <Header
        activeTab="coverage"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={solutionFixture}
        leewayPct={10}
      />
    );
    expect(current().length).toBe(1);
    expect(current()[0]).toContain('24h Coverage Heatmap');
  });

  it('announces the active view, so a number-key jump is not silent', () => {
    const { rerender } = render(
      <Header
        activeTab="roster"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={solutionFixture}
        leewayPct={10}
      />
    );
    const status = screen.getAllByRole('status')[0];
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Weekly Schedule');

    rerender(
      <Header
        activeTab="pareto"
        onSelectTab={vi.fn()}
        onOpenWizard={vi.fn()}
        solution={solutionFixture}
        leewayPct={10}
      />
    );
    expect(screen.getAllByRole('status')[0].textContent).toContain('Flexibility vs. Rest');
  });
});
