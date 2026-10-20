import { useId, useState } from 'react';
import { getLesson } from './lessons';

export const BARD_HIDDEN_KEY = 'shiftflow.bard.hidden';

// Phones (below 640px) start collapsed; wider screens start expanded.
// A missing or throwing matchMedia counts as expanded.
function isNarrowViewport(): boolean {
  try {
    return window.matchMedia('(max-width: 639px)').matches;
  } catch {
    return false;
  }
}

function readHidden(): boolean {
  try {
    const saved = window.localStorage.getItem(BARD_HIDDEN_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // Storage is unavailable (private window, blocked site data): use the width default.
  }
  return isNarrowViewport();
}

function writeHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(BARD_HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // Storage is unavailable: the panel still works for this visit.
  }
}

interface BardPanelProps {
  stepId: number;
  className?: string;
}

export function BardPanel({ stepId, className }: BardPanelProps) {
  const bodyId = useId();
  const [hidden, setHidden] = useState<boolean>(readHidden);
  const lesson = getLesson(stepId);

  if (!lesson) return <div aria-live="polite" />;

  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    writeHidden(next);
  };

  const wrapperClass = ['rounded-xl border border-indigo-100 bg-indigo-50 p-4', className]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={wrapperClass}>
      <div aria-live="polite">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-indigo-900">{lesson.title}</h2>
          <button
            type="button"
            aria-expanded={!hidden}
            aria-controls={bodyId}
            onClick={toggle}
            className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {hidden ? 'Show the guide' : 'Hide the guide'}
          </button>
        </div>
        <div id={bodyId} hidden={hidden} className="mt-3 space-y-3 text-sm text-slate-700">
          <p>{lesson.explanation}</p>
          <div>
            <p className="font-semibold text-slate-900">For example</p>
            <p>{lesson.example}</p>
          </div>
          <p>{lesson.whyItMatters}</p>
        </div>
      </div>
    </section>
  );
}
