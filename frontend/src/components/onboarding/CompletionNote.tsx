import { useId } from 'react';
import type { RosterLine, SolveResponse } from '../../types';

interface CompletionNoteProps {
  solution: SolveResponse | null;
}

function coverageLine(solution: SolveResponse): string {
  if (solution.roster_lines.length === 0) {
    return 'There are no roster lines to show yet.';
  }
  const anyUnderstaffed = solution.interval_coverage.some((cell) => cell.understaffing > 0);
  return anyUnderstaffed
    ? 'Some hours you asked for are understaffed.'
    : 'The schedule covers the hours you asked for';
}

function overtimeLine(rosterLines: RosterLine[]): string {
  const totalOvertime = rosterLines.reduce((sum, line) => sum + line.overtime_hours, 0);
  if (totalOvertime <= 0) {
    return 'No overtime is planned';
  }
  const hours = Math.round(totalOvertime);
  if (hours === 0) {
    return 'Under 1 hour of overtime is planned each week.';
  }
  return hours === 1
    ? 'About 1 hour of overtime is planned each week'
    : `About ${hours} hours of overtime are planned each week`;
}

function restLine(rosterLines: RosterLine[]): string {
  const flagged = rosterLines.filter(
    (line) =>
      line.statutory_accommodation_violation === true ||
      line.fair_workweek_predictability_warning === true
  ).length;
  return flagged > 0
    ? 'Some roster lines have warnings to review'
    : 'No rest or fairness warnings';
}

export function CompletionNote({ solution }: CompletionNoteProps) {
  const headingId = useId();

  if (solution === null) return null;

  const rosterLines = solution.roster_lines;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-slate-800"
    >
      <h2 id={headingId} className="text-base font-semibold text-indigo-900">
        What your schedule shows
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>{coverageLine(solution)}</li>
        <li>{overtimeLine(rosterLines)}</li>
        <li>{restLine(rosterLines)}</li>
      </ul>
    </section>
  );
}
