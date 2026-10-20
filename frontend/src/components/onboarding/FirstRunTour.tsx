import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '../ui/Button';

export const TOUR_DONE_KEY = 'shiftflow.tour.done';

// Storage can be blocked (private window, cleared site data). If it is,
// the tour is treated as not done, so it shows instead of crashing.
export function readTourDone(): boolean {
  try {
    return window.localStorage.getItem(TOUR_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTourDone(): void {
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, '1');
  } catch {
    // Storage is unavailable: the tour may show again on the next visit.
  }
}

export function clearTourDone(): void {
  try {
    window.localStorage.removeItem(TOUR_DONE_KEY);
  } catch {
    // Storage is unavailable: nothing to clear.
  }
}

const TOUR_STEPS = [
  'Pick the business type that is closest',
  'Say how many people you need each hour',
  'Your bard guide sits beside each step and explains it.',
];

interface FirstRunTourProps {
  onDone: () => void;
  returnFocusTo?: RefObject<HTMLElement>;
}

export function FirstRunTour({ onDone, returnFocusTo }: FirstRunTourProps) {
  const titleId = useId();
  const [index, setIndex] = useState<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const isLast = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    const previous = document.activeElement;
    headingRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous !== document.body) {
        previous.focus();
      } else {
        returnFocusTo?.current?.focus();
      }
    };
  }, [returnFocusTo]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
      return;
    }
    if (e.key !== 'Tab') return;

    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    if (buttons.length === 0) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const position = buttons.indexOf(document.activeElement as HTMLButtonElement);

    if (e.shiftKey) {
      if (position <= 0) {
        e.preventDefault();
        last.focus();
      }
    } else if (position === -1 || position === buttons.length - 1) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/60 flex items-center justify-center p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl p-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600">
          Quick tour, step {index + 1} of {TOUR_STEPS.length}
        </p>
        <h3
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="text-lg font-bold text-slate-900 mt-2"
        >
          {TOUR_STEPS[index]}
        </h3>

        <div className="flex items-center gap-1.5 mt-4" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={
                i === index
                  ? 'h-1.5 w-6 rounded-full bg-indigo-600'
                  : 'h-1.5 w-1.5 rounded-full bg-slate-300'
              }
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 mt-6">
          <Button variant="ghost" size="sm" onClick={onDone}>
            Skip tour
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              if (isLast) {
                onDone();
              } else {
                setIndex((i) => i + 1);
              }
            }}
          >
            {isLast ? 'Got it' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
