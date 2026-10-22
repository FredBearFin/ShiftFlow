import React, { useRef } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  singleKeyEnabled: boolean;
  onToggleSingleKey: (enabled: boolean) => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  singleKeyEnabled,
  onToggleSingleKey,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  const shortcutGroups = [
    {
      category: 'Week Navigation',
      items: [
        { keys: ['Space', 'or', '→'], desc: 'Advance 1 week (simulates next Monday rollover)' },
        { keys: ['←'], desc: 'Go back 1 week' },
      ],
    },
    {
      category: 'Jump to a Tab',
      items: [
        { keys: ['1'], desc: 'Weekly Schedule' },
        { keys: ['2'], desc: 'Labor & Payroll' },
        { keys: ['3'], desc: '24h Coverage Heatmap' },
        { keys: ['4'], desc: 'Cost vs. Rest Trade-off' },
        { keys: ['5'], desc: 'Ergonomics Health Audit' },
        { keys: ['6'], desc: 'DOL Compliance' },
        { keys: ['7'], desc: 'Audit a Roster' },
      ],
    },
    {
      category: 'Staff & Printing',
      items: [
        { keys: ['D'], desc: 'Toggle Staff Directory & Availability' },
        { keys: ['A'], desc: 'Add Staff Member' },
        { keys: ['P'], desc: 'Print the schedule' },
      ],
    },
    {
      category: 'System & Dialog Controls',
      items: [
        { keys: ['?'], desc: 'Open / close this shortcuts list' },
        { keys: ['Esc'], desc: 'Close any open dialog' },
      ],
    },
  ];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#7F8A92] rounded-lg max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⌨️</span>
            <div>
              <h2 id="shortcuts-title" className="text-base font-bold text-white">
                ShiftFlow Studio — Keyboard Shortcuts
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Engineered for hands-on-keyboard operation in loud, high-distraction control rooms and back offices.
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={singleKeyEnabled}
                  onChange={(e) => onToggleSingleKey(e.target.checked)}
                />
                Single-key shortcuts on
              </label>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-colors"
            aria-label="Close shortcuts modal"
          >
            ✕ Esc
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 divide-y divide-slate-100">
          {shortcutGroups.map((group, gIdx) => (
            <div key={group.category} className={gIdx > 0 ? 'pt-4' : ''}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
                {group.category}
              </h3>
              <div className="space-y-2">
                {group.items.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 text-xs"
                  >
                    <span className="text-slate-700 font-medium">{item.desc}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-4">
                      {item.keys.map((k, kIdx) =>
                        k === 'or' ? (
                          <span key={kIdx} className="text-xs text-slate-400 font-medium">
                            or
                          </span>
                        ) : (
                          <kbd
                            key={kIdx}
                            className="px-2 py-1 rounded bg-slate-100 border border-slate-300 text-xs font-mono-tabular font-bold text-slate-800"
                          >
                            {k}
                          </kbd>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            💡 <strong>Pro Tip:</strong> Shortcuts are automatically paused when typing in form inputs.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#2B3A42] hover:bg-[#1E2A31] text-[#FFFFFF] rounded-md text-xs font-bold shadow-[0_1px_2px_rgba(43,58,66,0.08)] transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
