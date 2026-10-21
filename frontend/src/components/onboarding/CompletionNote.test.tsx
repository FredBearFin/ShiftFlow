import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CompletionNote } from './CompletionNote';
import { makeRosterLine, makeSolution } from '../../test/solutionFixture';

describe('CompletionNote', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows no "warnings to review" line for flags the engine can no longer act on', () => {
    // Both flags set as high as the engine could ever set them. Neither is a compliance
    // alert any more: A5 stopped the product recording accommodations and A7 fixed the
    // predictability warning at False, so neither may drive a warning here.
    const solution = makeSolution({
      lineCount: 1,
      pricedLineCount: 1,
      solution: {
        roster_lines: [
          makeRosterLine(1, {
            assigned_person: 'Dana Reyes',
            hourly_wage: 18,
            estimated_weekly_payroll: 720,
            availability_conflicts_count: 1,
            statutory_accommodation_violation: true,
            fair_workweek_predictability_warning: true,
          }),
        ],
      },
    });
    solution.ergonomics_audit.clopening_violations = 0;

    render(<CompletionNote solution={solution} />);

    expect(screen.queryByText(/warnings to review/i)).toBeNull();
    // It also stops claiming to have checked fairness in general.
    expect(screen.queryByText(/No rest or fairness warnings/)).toBeNull();
  });

  it('speaks only about the rest rule it actually checks', () => {
    const solution = makeSolution();
    solution.ergonomics_audit.clopening_violations = 0;
    render(<CompletionNote solution={solution} />);
    expect(
      screen.getByText('No closing shift is followed by an opening shift the next day')
    ).toBeTruthy();
  });

  it('reports clopenings when the schedule has them', () => {
    const solution = makeSolution();
    solution.ergonomics_audit.clopening_violations = 3;
    render(<CompletionNote solution={solution} />);
    expect(screen.getByText(/Some shifts are clopenings/)).toBeTruthy();
  });

  it('still reports coverage and overtime', () => {
    const solution = makeSolution();
    render(<CompletionNote solution={solution} />);
    expect(screen.getByRole('heading', { name: 'What your schedule shows' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
