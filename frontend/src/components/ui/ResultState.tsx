import React from 'react';

/**
 * A designed state for when the content area has no content to show.
 *
 * A failed solve used to put a 1px red-outlined bar at the top of the page
 * and leave roughly 800px of blank cream underneath it, which reads as a
 * broken page rather than as a result. This fills the area the schedule would
 * have taken, and carries the four things a supervisor needs in order to get
 * moving again: a mark, a headline that says what happened, what to change,
 * and an action that actually does something.
 */
export type ResultStateTone = 'problem' | 'neutral';

const TONE_CLASSES: Record<ResultStateTone, string> = {
  // --status-risk-ink on --status-risk-soft measures 7.27:1.
  problem: 'bg-status-risk-soft text-status-risk-ink border-status-risk',
  neutral: 'bg-surface-subtle text-ink-soft border-border-control',
};

export interface ResultStateProps {
  tone?: ResultStateTone;
  /** Decorative mark. The headline carries the meaning on its own. */
  glyph: string;
  headline: string;
  /** What to change: one or two sentences, not a stack trace. */
  children: React.ReactNode;
  /** The recovery action. Buttons that do something, not a dead end. */
  actions?: React.ReactNode;
  /** Shown verbatim under the explanation, for the service's own message. */
  detail?: string;
  /** "alert" when this state is the page's announcement that something failed. */
  role?: 'alert' | 'status';
}

export const ResultState: React.FC<ResultStateProps> = ({
  tone = 'neutral',
  glyph,
  headline,
  children,
  actions,
  detail,
  role,
}) => (
  <div
    role={role}
    // 60vh: fills the area the schedule would have taken, rather than sitting
    // as a short box above several hundred pixels of blank canvas.
    className="card flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-16 text-center"
  >
    <span
      aria-hidden="true"
      className={`flex h-14 w-14 items-center justify-center rounded-full border text-2xl font-bold ${TONE_CLASSES[tone]}`}
    >
      {glyph}
    </span>
    <h2 className="type-section-title text-ink">{headline}</h2>
    <div className="type-prose max-w-xl text-ink-soft">{children}</div>
    {detail && (
      <p className="max-w-xl rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-ink-soft">
        {detail}
      </p>
    )}
    {actions && (
      <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
    )}
  </div>
);
