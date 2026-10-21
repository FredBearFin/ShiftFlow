import { useEffect, useId, useRef, useState } from 'react';
import { getTerm, type GlossaryEntry } from './glossary';

/** Glossary terms shown for each wizard step. */
const STEP_TERMS: Record<number, string[]> = {
  1: ['rule'],
  2: ['people needed', 'shift'],
  3: ['shift', 'shift type'],
  4: ['rule', 'consecutive days', 'consecutive nights', 'consecutive evenings', 'rest between shifts'],
  5: ['staffing flexibility', 'extra cost', 'staff comfort'],
  6: ['role', 'hourly wage', 'available days'],
};

interface ExplainThisProps {
  stepId: number;
}

export function ExplainThis({ stepId }: ExplainThisProps) {
  const [open, setOpen] = useState<boolean>(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const entries: GlossaryEntry[] = (STEP_TERMS[stepId] ?? [])
    .map((term) => getTerm(term))
    .filter((entry): entry is GlossaryEntry => entry !== undefined);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stop here so the Escape press does not also reach the page-level shortcut handler.
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        Explain these words
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-ink-soft"
      >
        <dl className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.term}>
              <dt className="font-semibold text-indigo-900">{entry.term}</dt>
              <dd>{entry.plain}</dd>
              <dd className="text-muted">Example: {entry.example}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
