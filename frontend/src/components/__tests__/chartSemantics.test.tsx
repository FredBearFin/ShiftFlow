import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ParetoExplorerView } from '../ParetoExplorerView';
import { ErgonomicsAuditView } from '../ErgonomicsAuditView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

describe('charts are decorative, their tables are not', () => {
  it('hides the Pareto chart from the reader and keeps the frontier list usable', () => {
    const { container } = render(
      <ParetoExplorerView
        solution={solutionFixture}
        selectedLeewayPct={10}
        onSelectLeewayPct={vi.fn()}
      />
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // Nothing focusable may sit inside an aria-hidden subtree.
    expect(svg.querySelectorAll('[tabindex], a, button, input').length).toBe(0);

    // The equivalent the chart defers to.
    expect(container.querySelectorAll('div[role="button"][tabindex="0"]').length).toBe(
      solutionFixture.pareto_frontier.length
    );
    expect(screen.getAllByRole('button', { name: /Apply|Active/ }).length).toBe(
      solutionFixture.pareto_frontier.length
    );
  });

  it('hides the ergonomics bar chart from the reader', () => {
    const { container } = render(<ErgonomicsAuditView solution={solutionFixture} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('[tabindex], a, button, input').length).toBe(0);

    // The same figures survive in the table below it.
    expect(screen.getAllByText('Weekend coverage').length).toBeGreaterThan(0);
  });
});
