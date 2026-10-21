import React from 'react';

/**
 * A placeholder shaped like the roster, shown while the first solve runs.
 *
 * The first load used to show a centred spinner in a short card, so the page
 * jumped from one small box to a 3000px roster. This holds the shape the
 * schedule is about to take — five KPI tiles and a seven-day grid — so the
 * layout does not move underneath the reader when it lands.
 *
 * Decorative: it is aria-hidden, and the live region in App announces the
 * solve to a screen reader. The pulse is governed by the global
 * prefers-reduced-motion block in index.css.
 */
const Bar: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-surface-sunken ${className}`} />
);

export const RosterSkeleton: React.FC = () => (
  <div aria-hidden="true" className="space-y-5">
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {[0, 1, 2, 3, 4].map((tile) => (
        <div key={tile} className="card space-y-3 p-5">
          <Bar className="h-2.5 w-24" />
          <Bar className="h-7 w-20" />
          <Bar className="h-2.5 w-full" />
        </div>
      ))}
    </div>

    <div className="card space-y-4 p-5">
      <Bar className="h-5 w-72 max-w-full" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="grid grid-cols-4 gap-2 sm:grid-cols-9">
            <Bar className="h-10 sm:col-span-2" />
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <Bar key={day} className="h-10" />
            ))}
          </div>
        ))}
      </div>
    </div>
  </div>
);
