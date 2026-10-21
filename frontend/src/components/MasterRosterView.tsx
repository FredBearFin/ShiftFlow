import React, { useRef, useState } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { Term } from './ui/Term';
import {
  EmployeeRecord,
  NewEmployeeInput,
  RosterCellOverride,
  RosterLine,
  SeparationCategory,
  ShiftOrOffCode,
  ShiftSwapValidationResponse,
  SolveResponse,
  StaffMemberAssignment,
} from '../types';
import { DAYS_OF_WEEK, validateShiftSwapApi } from '../services/api';
import {
  OVERTIME_THRESHOLD_HOURS,
  SHIFT_CODE_LABELS,
  availableShiftCodes,
  buildSwapLines,
  findingsByLine,
  indexOverrides,
  overrideKey,
  previewOverride,
  resolveCell,
  resolvedLineHours,
  shiftClocksFromSolution,
  swapAsOverrides,
} from '../services/rosterOverrides';
import { formatCurrency, formatHourlyRate } from '../utils/format';
import { Button } from './ui/Button';

const WAGE_MIN = 7.25;
const WAGE_MAX = 100;

// A blank or out-of-bounds wage is not a number: no substitute value is ever used.
const parseWage = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= WAGE_MIN && n <= WAGE_MAX ? n : null;
};

const WAGE_ERROR = `Enter an hourly wage between $${WAGE_MIN.toFixed(2)} and $${WAGE_MAX.toFixed(2)}. Until it is in range nothing is saved.`;

const DAY_FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const SEPARATION_OPTIONS: { value: SeparationCategory; label: string }[] = [
  { value: 'voluntary_resignation', label: 'Voluntary resignation' },
  { value: 'mutual_agreement', label: 'Mutual agreement' },
  { value: 'involuntary_for_cause', label: 'Involuntary (for cause)' },
  { value: 'layoff_reduction', label: 'Layoff / reduction in force' },
];

interface MasterRosterViewProps {
  solution: SolveResponse;
  rotationWeekOffset: number;
  staffAssignments: StaffMemberAssignment[];
  employees: EmployeeRecord[];
  onAdvanceWeek: (delta: number) => void;
  onResetWeek: () => void;
  onUpdateStaffAssignments: (assignments: StaffMemberAssignment[]) => void;
  /**
   * The manager's hand edits to the generated roster. Optional so a caller that does
   * not own them (and the view tests) renders the generated roster unchanged; when the
   * setter is absent the edits are held in this component for the session instead.
   */
  rosterOverrides?: RosterCellOverride[];
  onUpdateRosterOverrides?: (overrides: RosterCellOverride[]) => void;
  onAddEmployee: (emp: NewEmployeeInput) => void;
  onToggleEmployeeStatus: (
    empId: string,
    separation?: { category: SeparationCategory; reason: string; recorded_by: string }
  ) => void;
  onUpdateEmployee: (emp: EmployeeRecord) => void;
  onExportCsv: () => void;
  showAddModal?: boolean;
  onSetShowAddModal?: (show: boolean) => void;
  showDirectoryDrawer?: boolean;
  onSetShowDirectoryDrawer?: (show: boolean) => void;
}

export const MasterRosterView: React.FC<MasterRosterViewProps> = ({
  solution,
  rotationWeekOffset,
  staffAssignments,
  employees,
  onAdvanceWeek,
  onResetWeek,
  onUpdateStaffAssignments,
  rosterOverrides: extOverrides,
  onUpdateRosterOverrides: extSetOverrides,
  onAddEmployee,
  onToggleEmployeeStatus,
  onUpdateEmployee,
  onExportCsv,
  showAddModal: extAddModal,
  onSetShowAddModal: extSetAddModal,
  showDirectoryDrawer: extDirectoryDrawer,
  onSetShowDirectoryDrawer: extSetDirectoryDrawer,
}) => {
  const [internalDirectoryDrawer, setInternalDirectoryDrawer] = useState(false);
  const [internalAddModal, setInternalAddModal] = useState(false);

  const showDirectoryDrawer = extDirectoryDrawer !== undefined ? extDirectoryDrawer : internalDirectoryDrawer;
  const setShowDirectoryDrawer = extSetDirectoryDrawer || setInternalDirectoryDrawer;

  const showAddModal = extAddModal !== undefined ? extAddModal : internalAddModal;
  const setShowAddModal = extSetAddModal || setInternalAddModal;
  const addDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(addDialogRef, showAddModal, () => setShowAddModal(false));

  /* ------------------------------------------------------------------
   * Editing a generated roster cell
   *
   * A supervisor's week is edits: someone calls out, one person cannot work Sundays.
   * An edit is applied to the solved roster as it stands and only the affected line is
   * re-checked, because re-solving would reshuffle everybody else's week to deliver the
   * one cell that was asked for.
   * ------------------------------------------------------------------ */
  const [internalOverrides, setInternalOverrides] = useState<RosterCellOverride[]>([]);
  const overrides = extOverrides ?? internalOverrides;
  const setOverrides = extSetOverrides ?? setInternalOverrides;

  const [editingCell, setEditingCell] = useState<{ cycleWeek: number; dayIndex: number } | null>(null);
  const [draftCode, setDraftCode] = useState<ShiftOrOffCode>('OFF');

  const shiftClocks = shiftClocksFromSolution(solution);
  const shiftCodeChoices = availableShiftCodes(shiftClocks);
  const overridesByKey = indexOverrides(overrides);
  const lineFindings = findingsByLine(solution, overrides);

  const editedCycleWeeks = new Set(overrides.map((o) => o.cycle_week));

  const startEditingCell = (cycleWeek: number, dayIndex: number, currentCode: ShiftOrOffCode) => {
    setEditingCell({ cycleWeek, dayIndex });
    setDraftCode(currentCode);
  };

  const commitEdit = (cycleWeek: number, dayIndex: number, generatedCode: ShiftOrOffCode) => {
    const key = overrideKey(cycleWeek, dayIndex);
    const withoutThisCell = overrides.filter((o) => overrideKey(o.cycle_week, o.day_index) !== key);
    // Choosing the generated value back is not an edit, so no override is recorded and
    // the cell stops reporting itself as modified.
    setOverrides(
      draftCode === generatedCode
        ? withoutThisCell
        : [
            ...withoutThisCell,
            {
              cycle_week: cycleWeek,
              day_index: dayIndex,
              shift_code: draftCode,
              original_shift_code: generatedCode,
            },
          ]
    );
    setEditingCell(null);
  };

  const revertEdit = (cycleWeek: number, dayIndex: number) => {
    const key = overrideKey(cycleWeek, dayIndex);
    setOverrides(overrides.filter((o) => overrideKey(o.cycle_week, o.day_index) !== key));
    setEditingCell(null);
  };

  /* ------------------------------------------------------------------
   * Trading two assigned shifts between two people
   *
   * The manager picks two shifts and the backend validates both resulting weeks
   * against the 16-hour rest rule, the zero-clopening guardrail and the 40-hour
   * overtime boundary. A trade that breaks one of those is refused with the reason,
   * and nothing is applied.
   * ------------------------------------------------------------------ */
  type SwapPick = { line_number: number; day_index: number; shift_code: ShiftOrOffCode };

  const [swapMode, setSwapMode] = useState(false);
  const [swapPicks, setSwapPicks] = useState<SwapPick[]>([]);
  const [swapVerdict, setSwapVerdict] = useState<ShiftSwapValidationResponse | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapChecking, setSwapChecking] = useState(false);

  const resetSwap = () => {
    setSwapPicks([]);
    setSwapVerdict(null);
    setSwapError(null);
    setSwapChecking(false);
  };

  const isPicked = (lineNumber: number, dayIndex: number) =>
    swapPicks.some((p) => p.line_number === lineNumber && p.day_index === dayIndex);

  const toggleSwapPick = (pick: SwapPick) => {
    setSwapVerdict(null);
    setSwapError(null);
    setSwapPicks((prev) => {
      const without = prev.filter(
        (p) => !(p.line_number === pick.line_number && p.day_index === pick.day_index)
      );
      if (without.length !== prev.length) return without;
      // Two shifts make a trade; a third replaces the older of the two.
      return [...without, pick].slice(-2);
    });
  };

  const employeeIdForLine = (lineNumber: number): string | null =>
    solution.roster_lines.find((l) => l.line_number === lineNumber)?.assigned_employee_id ?? null;

  const swapBlockedReason = (): string | null => {
    if (swapPicks.length !== 2) return 'Pick two assigned shifts to trade.';
    const [a, b] = swapPicks;
    if (a.shift_code === 'OFF' || b.shift_code === 'OFF') {
      return 'Both shifts have to be ones somebody is actually working. To put somebody on a day they are off, change that one cell instead.';
    }
    if (a.line_number === b.line_number) {
      return 'A trade is between two people. Both of these shifts are on the same line.';
    }
    if (!employeeIdForLine(a.line_number) || !employeeIdForLine(b.line_number)) {
      return 'A trade needs a named person on both lines. One of these lines has nobody assigned to it.';
    }
    return null;
  };

  const checkSwap = async () => {
    if (swapPicks.length !== 2) return;
    const [a, b] = swapPicks;
    const idA = employeeIdForLine(a.line_number);
    const idB = employeeIdForLine(b.line_number);
    if (!idA || !idB) return;

    setSwapChecking(true);
    setSwapError(null);
    setSwapVerdict(null);
    try {
      const verdict = await validateShiftSwapApi({
        associate_a_id: idA,
        associate_b_id: idB,
        day_a_index: a.day_index,
        day_b_index: b.day_index,
        roster_lines: buildSwapLines(solution, overrides),
      });
      setSwapVerdict(verdict);
    } catch (err) {
      setSwapError(err instanceof Error ? err.message : 'The swap could not be checked.');
    } finally {
      setSwapChecking(false);
    }
  };

  const applySwap = () => {
    if (swapPicks.length !== 2 || !swapVerdict?.is_approved) return;
    const [a, b] = swapPicks;
    const next = swapAsOverrides(solution, overrides, a, b);
    if (next === null) {
      setSwapError('Those shifts are no longer on this roster, so nothing was changed.');
      return;
    }
    setOverrides(next);
    setSwapMode(false);
    resetSwap();
  };



  // New Employee Form State
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Frontline Associate');
  const [newWage, setNewWage] = useState('');
  const [wageDrafts, setWageDrafts] = useState<Record<string, string>>({});
  const newWageValue = parseWage(newWage);
  const [newAvailDays, setNewAvailDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Inline separation form state (one employee's form open at a time)
  const [sepEmpId, setSepEmpId] = useState<string | null>(null);
  const [sepCategory, setSepCategory] = useState<SeparationCategory>('voluntary_resignation');
  const [sepReason, setSepReason] = useState('');
  const [sepRecordedBy, setSepRecordedBy] = useState('');

  const openSeparationForm = (empId: string) => {
    setSepEmpId(empId);
    setSepCategory('voluntary_resignation');
    setSepReason('');
    setSepRecordedBy('');
  };

  const submitSeparation = (e: React.FormEvent, empId: string) => {
    e.preventDefault();
    const reason = sepReason.trim();
    const recordedBy = sepRecordedBy.trim();
    if (!reason || !recordedBy) return;
    onToggleEmployeeStatus(empId, { category: sepCategory, reason, recorded_by: recordedBy });
    setSepEmpId(null);
  };

  const activeEmployees = employees.filter((e) => e.is_active);
  const inactiveEmployees = employees.filter((e) => !e.is_active);

  const handleToggleDay = (d: number) => {
    if (newAvailDays.includes(d)) {
      if (newAvailDays.length > 1) {
        setNewAvailDays(newAvailDays.filter((x) => x !== d));
      }
    } else {
      setNewAvailDays([...newAvailDays, d].sort());
    }
  };

  const submitNewEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newWageValue === null) return;
    onAddEmployee({
      name: newName.trim(),
      role: newRole,
      wage: newWageValue,
      days: newAvailDays,
    });
    setNewName('');
    setNewWage('');
    setNewAvailDays([0, 1, 2, 3, 4, 5, 6]);
    setShowAddModal(false);
  };

  const activeCycleWeek = (rotationWeekOffset % solution.employee_count) + 1;

  // Under-staffed hours per day, summed from the solution's hourly coverage cells.
  const underByDay = DAYS_OF_WEEK.map((_, idx) =>
    solution.interval_coverage
      .filter((c) => c.day_index === idx)
      .reduce((a, c) => a + c.understaffing, 0)
  );
  const totalUnderHours = underByDay.reduce((a, h) => a + h, 0);

  // A payroll total only prices the lines that have a wage behind them, and day
  // availability can only be checked on a line that has somebody on it. Both figures
  // below say which part of the roster they actually measured.
  const lineCount = solution.roster_lines.length;
  const pricedLineCount = solution.roster_lines.filter((l) => l.estimated_weekly_payroll !== null).length;
  const unstaffedLineCount = solution.roster_lines.filter((l) => l.assigned_person === null).length;
  const availConflicts = solution.roster_lines.reduce((a, l) => a + l.availability_conflicts_count, 0);

  return (
    <div className="space-y-5">
      {activeEmployees.length < solution.employee_count && (
        <div className="rounded-md border border-warning bg-[#FDF8F0] px-4 py-3 text-xs text-[#6B4B1C]">
          <strong className="font-bold">
            {activeEmployees.length} active staff for {solution.employee_count} shift patterns.
          </strong>{' '}
          Every figure on this page that depends on a person — payroll, wages, day availability — is
          measured over the {pricedLineCount} pattern{pricedLineCount === 1 ? '' : 's'} that have
          somebody assigned, not over the whole schedule. Staffing the remaining{' '}
          {solution.employee_count - pricedLineCount} would cost more than the total shown.
        </div>
      )}
      {/* Top Executive KPI Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 no-print">
        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Shift Patterns
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {solution.employee_count}
            </span>
            <span className="text-xs font-medium text-muted">
              {solution.employee_count}-Wk Cycle
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            {activeEmployees.length} Active Staff • {inactiveEmployees.length} Inactive
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Estimated Weekly Payroll
          </span>
          {/* The priced-fraction chip pushed this row 3px past the viewport at
              375px, scrolling the whole document. It wraps instead of
              truncating: half a payroll figure is a wrong payroll figure. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 min-w-0 mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink min-w-0">
              {formatCurrency(solution.labor_analysis.total_payroll_cost)}
            </span>
            <span className="text-xs font-mono-tabular text-muted min-w-0">
              {pricedLineCount} of {lineCount} lines priced
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            OT: {formatCurrency(solution.labor_analysis.overtime_payroll_cost)}
            {solution.labor_analysis.avg_hourly_wage === null
              ? ''
              : ` • ${formatHourlyRate(solution.labor_analysis.avg_hourly_wage)} avg`}
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Ergonomics Health Index
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {solution.ergonomics_audit.health_index_score}/100
            </span>
            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {solution.ergonomics_audit.clopening_violations} Clopenings
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Higher is better, 55–99.5 range • Min rest:{' '}
            {solution.ergonomics_audit.min_rest_hours_observed}h observed
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Full Weekends Off (Sat+Sun)
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {solution.ergonomics_audit.full_weekends_off_pct}%
            </span>
            <span className="text-xs font-mono-tabular text-ink-soft">
              {solution.ergonomics_audit.full_weekends_off_count}/{solution.employee_count} Shift Patterns
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Both Saturday & Sunday OFF together
          </p>
        </div>

        <div className="card p-4 col-span-2 lg:col-span-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted block">
            Availability Adherence
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-ink">
              {unstaffedLineCount > 0
                ? 'Not assessable'
                : availConflicts === 0
                ? '100%'
                : `${availConflicts} Conflicts`}
            </span>
            <span className="text-xs font-mono-tabular text-muted">
              {solution.solve_time_ms} ms
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            {unstaffedLineCount > 0
              ? `Not assessable — ${unstaffedLineCount} of ${lineCount} lines unstaffed, so nobody's days could be checked against them`
              : 'Staff day availability checked on all lines'}
          </p>
        </div>
      </div>

      {/* Weekly Schedule Card */}
      <div className="card overflow-hidden">
        {/* Print-only header: visible on paper, hidden on screen */}
        <div className="hidden print:block px-6 pt-4 pb-3 border-b border-border">
          <h2 className="type-section-title text-ink">{solution.instance_name}</h2>
          <p className="type-prose text-ink-soft font-mono-tabular">
            Week {activeCycleWeek} of {solution.employee_count}
          </p>
        </div>

        {/* Roster Action Toolbar */}
        <div className="p-4 sm:px-6 border-b border-border-subtle flex flex-wrap items-center justify-between gap-4 bg-white">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="type-section-title text-ink">
                Weekly Schedule (Patterns 1 to {solution.employee_count})
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono-tabular font-semibold bg-surface text-ink border border-border">
                Showing Week {activeCycleWeek} of {solution.employee_count}
              </span>
            </div>
            <p className="type-prose text-muted mt-0.5">
              {solution.employee_count} shift patterns are repeating schedule slots built from your
              hours — they exist before you assign any real staff. Every Monday morning, each one
              advances down one row. Manage employee availability, hourly wages, and active/fired
              status in the Staff & Directory drawer (key D).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="inline-flex items-center rounded-md border border-border-control bg-surface-subtle p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAdvanceWeek(-1)}
                title="Step backward 1 rotation week"
              >
                ← Prev Wk
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onResetWeek}
                className="font-mono-tabular"
              >
                Wk {activeCycleWeek}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onAdvanceWeek(1)}
                title="Advance all shift patterns by 1 week"
              >
                Advance +1 Wk →
              </Button>
            </div>

            <Button
              variant={showDirectoryDrawer ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setShowDirectoryDrawer(!showDirectoryDrawer)}
            >
              <span>Staff & Directory</span><kbd className="px-1.5 py-0.5 rounded bg-surface-sunken text-ink text-xs font-mono-tabular font-bold ml-1">D</kbd>
              <span className="px-1.5 py-0.5 rounded bg-surface-sunken text-ink text-xs">
                {activeEmployees.length}
              </span>
            </Button>

            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              + Add Employee <kbd className="px-1.5 py-0.5 rounded bg-ink-strong text-card text-xs font-mono-tabular font-bold">A</kbd>
            </Button>

            <Button
              variant={swapMode ? 'primary' : 'secondary'}
              size="sm"
              aria-pressed={swapMode}
              onClick={() => {
                setSwapMode(!swapMode);
                setEditingCell(null);
                resetSwap();
              }}
            >
              {swapMode ? 'Done swapping' : 'Swap two shifts'}
            </Button>

            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print Roster <kbd className="px-1.5 py-0.5 rounded bg-surface-sunken text-ink-soft text-xs font-mono-tabular font-bold">P</kbd>
            </Button>

            <Button variant="accent" onClick={onExportCsv}>
              Export CSV
            </Button>
          </div>
        </div>

        {/* Staff & Availability Directory Management Drawer */}
        {showDirectoryDrawer && (
          <div className="p-4 sm:px-6 bg-surface-subtle border-b border-border-subtle space-y-4 no-print">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="type-subsection-title text-ink">
                  Staff Directory & Availability Controls (Add / Fire / Adjust Wages)
                </h3>
                <p className="type-prose text-muted">
                  Manage active staff, fire or deactivate employees, adjust individual hourly wages,
                  and set allowed working days. Inactive/fired staff are instantly unmapped from lines.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
                + New Employee Form
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
              {employees.map((emp) => (
                <div
                  key={emp.employee_id}
                  className={`p-3 rounded-lg border flex flex-col justify-between ${
                    emp.is_active
                      ? 'bg-white border-border-control'
                      : 'bg-slate-100/80 border-border-control opacity-60'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-bold text-xs text-ink block">
                          {emp.name}
                        </span>
                        <span className="text-xs text-muted">
                          {emp.role} {emp.assigned_line_id ? `• Line ${emp.assigned_line_id}` : '• Unassigned'}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          emp.is_active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                      >
                        {emp.is_active ? 'Active' : 'Fired / Inactive'}
                      </span>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-border-subtle grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label htmlFor={`roster-wage-${emp.employee_id}`} className="text-xs text-muted block">Wage ($/hr)</label>
                        <input id={`roster-wage-${emp.employee_id}`}
                          type="number"
                          step="0.5"
                          min={WAGE_MIN}
                          max={WAGE_MAX}
                          disabled={!emp.is_active}
                          aria-invalid={wageDrafts[emp.employee_id] !== undefined && parseWage(wageDrafts[emp.employee_id]) === null}
                          aria-describedby={
                            wageDrafts[emp.employee_id] !== undefined && parseWage(wageDrafts[emp.employee_id]) === null
                              ? `roster-wage-${emp.employee_id}-error`
                              : undefined
                          }
                          value={wageDrafts[emp.employee_id] ?? String(emp.hourly_wage)}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setWageDrafts((d) => ({ ...d, [emp.employee_id]: raw }));
                          }}
                          onBlur={() => {
                            const draft = wageDrafts[emp.employee_id];
                            if (draft === undefined) return;
                            const wage = parseWage(draft);
                            if (wage === null) return;
                            if (wage !== emp.hourly_wage) onUpdateEmployee({ ...emp, hourly_wage: wage });
                            setWageDrafts((d) => { const next = { ...d }; delete next[emp.employee_id]; return next; });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          className="w-full px-2 py-1 border border-border-control rounded-md font-mono-tabular text-xs"
                        />
                        {wageDrafts[emp.employee_id] !== undefined && parseWage(wageDrafts[emp.employee_id]) === null && (
                          <p id={`roster-wage-${emp.employee_id}-error`} className="mt-1 text-xs font-semibold text-danger">
                            {WAGE_ERROR}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`roster-line-${emp.employee_id}`} className="text-xs text-muted block">Assigned Line</label>
                        <select id={`roster-line-${emp.employee_id}`}
                          disabled={!emp.is_active}
                          value={emp.assigned_line_id || ''}
                          onChange={(e) =>
                            onUpdateEmployee({
                              ...emp,
                              assigned_line_id: e.target.value ? parseInt(e.target.value, 10) : null,
                            })
                          }
                          className="w-full px-2 py-1 border border-border-control rounded-md text-xs bg-surface-subtle"
                        >
                          <option value="">Auto-Assign</option>
                          {Array.from({ length: solution.employee_count }, (_, i) => i + 1).map((l) => (
                            <option key={l} value={l}>
                              Line {l}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-2">
                      <label className="text-xs text-muted block mb-1">
                        Available Days ({emp.available_days.length}/7):
                      </label>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map((dName, dIdx) => {
                          const isAvail = emp.available_days.includes(dIdx);
                          return (
                            <button
                              key={dName}
                              type="button"
                              aria-pressed={isAvail}
                              aria-label={DAY_FULL_NAMES[dIdx]}
                              disabled={!emp.is_active}
                              onClick={() => {
                                const nextDays = isAvail
                                  ? emp.available_days.filter((x) => x !== dIdx)
                                  : [...emp.available_days, dIdx].sort();
                                onUpdateEmployee({ ...emp, available_days: nextDays });
                              }}
                              className={`w-6 h-6 rounded-md text-xs font-mono-tabular font-bold flex items-center justify-center ${
                                isAvail
                                  ? 'bg-ink text-card'
                                  : 'bg-surface-sunken text-ink-soft'
                              }`}
                              title={`${dName}: ${isAvail ? 'Available' : 'Unavailable'}`}
                            >
                              {dName[0]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-border-subtle flex items-center justify-between">
                    <span className="text-xs text-muted font-mono-tabular">
                      ID: {emp.employee_id}
                    </span>
                    {!(emp.is_active && sepEmpId === emp.employee_id) && (
                      <Button
                        variant={emp.is_active ? 'danger' : 'secondary'}
                        size="sm"
                        onClick={() =>
                          emp.is_active
                            ? openSeparationForm(emp.employee_id)
                            : onToggleEmployeeStatus(emp.employee_id)
                        }
                      >
                        {emp.is_active ? 'Deactivate / Fire' : 'Reactivate'}
                      </Button>
                    )}
                  </div>

                  {emp.is_active && sepEmpId === emp.employee_id && (
                    <form
                      onSubmit={(e) => submitSeparation(e, emp.employee_id)}
                      className="mt-3 pt-3 border-t border-border-subtle space-y-2"
                    >
                      <div>
                        <label htmlFor={`sep-category-${emp.employee_id}`} className="text-xs text-muted block">
                          Separation category
                        </label>
                        <select
                          id={`sep-category-${emp.employee_id}`}
                          value={sepCategory}
                          onChange={(e) => setSepCategory(e.target.value as SeparationCategory)}
                          className="w-full px-2 py-1 border border-border-control rounded-md text-xs bg-white"
                        >
                          {SEPARATION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`sep-reason-${emp.employee_id}`} className="text-xs text-muted block">
                          Reason (required)
                        </label>
                        <input
                          id={`sep-reason-${emp.employee_id}`}
                          type="text"
                          required
                          value={sepReason}
                          onChange={(e) => setSepReason(e.target.value)}
                          className="w-full px-2 py-1 border border-border-control rounded-md text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor={`sep-recorded-by-${emp.employee_id}`} className="text-xs text-muted block">
                          Recorded by (required)
                        </label>
                        <input
                          id={`sep-recorded-by-${emp.employee_id}`}
                          type="text"
                          required
                          value={sepRecordedBy}
                          onChange={(e) => setSepRecordedBy(e.target.value)}
                          className="w-full px-2 py-1 border border-border-control rounded-md text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button variant="secondary" size="sm" onClick={() => setSepEmpId(null)}>
                          Cancel
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          type="submit"
                          disabled={!sepReason.trim() || !sepRecordedBy.trim()}
                        >
                          Confirm Deactivate
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trading two assigned shifts between two people. */}
        {swapMode && (
          <div className="p-4 sm:px-6 border-b border-border-subtle bg-surface-subtle no-print">
            <h3 className="type-subsection-title text-ink">Swap two shifts</h3>
            <p className="type-prose text-muted">
              Choose one shift from each person's week. Both resulting weeks are checked
              against the 16-hour rest rule, the zero-clopening guardrail and the{' '}
              {OVERTIME_THRESHOLD_HOURS}-hour overtime boundary before anything changes. A
              trade that would break one of those is refused and nothing is applied.
            </p>

            <p className="mt-2 type-prose text-ink font-semibold" aria-live="polite">
              {swapPicks.length === 0
                ? 'No shifts chosen yet.'
                : swapPicks
                    .map(
                      (p) =>
                        `Line ${p.line_number}, ${DAY_FULL_NAMES[p.day_index]} (${p.shift_code})`
                    )
                    .join(' ↔ ')}
            </p>

            {swapPicks.length === 2 && swapBlockedReason() !== null && (
              <p id="roster-swap-blocked" className="mt-1 text-xs font-semibold text-status-risk-ink">
                {swapBlockedReason()}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2.5">
              <Button
                variant="primary"
                size="sm"
                loading={swapChecking}
                disabled={swapBlockedReason() !== null}
                aria-describedby={
                  swapPicks.length === 2 && swapBlockedReason() !== null
                    ? 'roster-swap-blocked'
                    : undefined
                }
                onClick={checkSwap}
              >
                Check this swap
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!swapVerdict?.is_approved}
                onClick={applySwap}
              >
                Apply swap
              </Button>
              <Button variant="secondary" size="sm" onClick={resetSwap}>
                Clear choices
              </Button>
            </div>

            {swapError !== null && (
              <p className="mt-2.5 text-xs font-semibold text-status-risk-ink" role="alert">
                {swapError}
              </p>
            )}

            {swapVerdict !== null && (
              <div
                className={`mt-2.5 rounded-md border px-3 py-2.5 ${
                  swapVerdict.is_approved
                    ? 'border-status-ok bg-status-ok-soft'
                    : 'border-status-risk bg-status-risk-soft'
                }`}
                role="status"
              >
                <p className="text-xs font-bold text-ink">
                  {swapVerdict.is_approved ? 'Swap allowed' : 'Swap refused'} —{' '}
                  {swapVerdict.swap_summary}
                </p>
                <ul className="mt-1 space-y-1">
                  {swapVerdict.validation_messages.map((message, idx) => (
                    <li key={`${idx}-${message.slice(0, 24)}`} className="text-xs text-ink">
                      {message}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-muted font-mono-tabular">
                  {swapVerdict.associate_a_name}: {swapVerdict.overtime_hours_a}h OT •{' '}
                  {swapVerdict.associate_b_name}: {swapVerdict.overtime_hours_b}h OT • payroll{' '}
                  {swapVerdict.payroll_cost_delta >= 0 ? '+' : ''}
                  {formatCurrency(swapVerdict.payroll_cost_delta)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {swapVerdict.next_monday_rotation_impact}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Edits to the generated roster, and what on this page they do and do not move. */}
        {overrides.length > 0 && (
          <div className="p-4 sm:px-6 border-b border-border-subtle bg-surface-subtle">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="type-subsection-title text-ink">
                  {overrides.length} cell{overrides.length === 1 ? '' : 's'} modified from generated
                </h3>
                <p className="type-prose text-muted">
                  Each edit was checked against the {OVERTIME_THRESHOLD_HOURS}-hour overtime
                  boundary, the 16-hour rest rule and the zero-clopening guardrail on its own
                  line only — nothing else in the rotation was re-solved or moved. The hours and
                  weekly payroll on an edited row below are recalculated. The KPI cards above,
                  the ergonomics score and the under-staffed totals still describe the generated
                  roster, because they come from the solve and no edit has been fed back into it.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="no-print"
                onClick={() => {
                  setOverrides([]);
                  setEditingCell(null);
                }}
              >
                Undo all edits
              </Button>
            </div>
          </div>
        )}

        {/* Weekly Schedule Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-subtle border-b border-border-subtle text-xs font-bold uppercase tracking-wider text-muted">
                <th scope="col" className="py-3 px-4 min-w-[200px]">Shift Pattern / Staff Member</th>
                <th scope="col" className="py-3 px-2 text-center">Pattern Wk</th>
                {DAYS_OF_WEEK.map((day, idx) => (
                  <th
                    key={day}
                    scope="col"
                    className={`py-3 px-2.5 text-center ${
                      idx >= 5 ? 'bg-slate-100/80 text-ink' : ''
                    }`}
                  >
                    {day}
                  </th>
                ))}
                <th scope="col" className="py-3 px-3 text-right">Hours</th>
                <th scope="col" className="py-3 px-4 text-right">Weekly Payroll</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle text-xs">
              {solution.roster_lines.map((line: RosterLine) => {
                const isEdited = editedCycleWeeks.has(line.current_cycle_week);
                const editedHours = resolvedLineHours(line, overridesByKey, shiftClocks);
                // An edit changes the hours on the line, so the money on it follows:
                // regular up to the overtime boundary, then time and a half. An
                // unassigned line still has no wage and so still costs nothing.
                const editedPayroll =
                  line.hourly_wage === null
                    ? null
                    : Math.round(
                        (editedHours.regular_hours * line.hourly_wage +
                          editedHours.overtime_hours * line.hourly_wage * 1.5) *
                          100
                      ) / 100;
                const findings = lineFindings.get(line.line_number) ?? [];

                return (
                <tr
                  key={line.cohort_id}
                  className="transition-colors"
                >
                  <th scope="row" className="py-3 px-4 text-left font-normal">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-ink text-card font-mono-tabular font-bold text-xs">
                        {line.cohort_id}
                      </span>
                      <span className="font-semibold text-ink">
                        {line.assigned_person
                          ? line.assigned_person
                          : `Shift Pattern ${line.line_number}`}
                      </span>
                      {isEdited && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-accent-soft text-accent-strong border border-accent">
                          Modified from generated
                        </span>
                      )}
                      {line.availability_conflicts_count > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-surface-sunken text-ink border border-border-control before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-warning before:mr-1.5 before:align-middle">
                          {line.availability_conflicts_count} Avail Alert
                        </span>
                      )}
                      {/* No "Title VII / ADA Sabbath Alert" badge: the engine never read the
                          accommodation record, so the badge was a relabelled availability
                          conflict and the Avail Alert above already reports that honestly. */}
                      {/* No "Predictability Pay Risk" badge: nothing here measures the
                          advance notice that predictability pay turns on, and the flag
                          behind it appeared and disappeared purely from stepping the
                          viewed week. The Compliance tab says it is not assessed. */}
                    </div>
                    <div className="text-xs text-muted mt-0.5 flex items-center gap-2">
                      <Term explanation="The pay and skill band this shift pattern is costed at, and what appears as the Role in the payroll file you export. &quot;Union Line Standard&quot; is the ordinary rate for the job, with nothing added for extra skills or seniority.">
                        {line.qualification_tier}
                      </Term>
                      <span>•</span>
                      <span className="font-mono-tabular">{formatHourlyRate(line.hourly_wage)}</span>
                      <span>•</span>
                      <span>Next Mon → Line {line.next_week_line_number}</span>
                    </div>
                    {findings.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {findings.map((finding) => (
                          <li
                            key={`${finding.rule}-${finding.day_index}`}
                            className="text-xs font-semibold text-status-risk-ink"
                          >
                            {finding.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </th>

                  <td className="py-3 px-2 text-center">
                    <span className="px-2 py-0.5 rounded bg-surface text-ink-soft font-mono-tabular font-semibold text-xs">
                      Wk {line.current_cycle_week}
                    </span>
                  </td>

                  {line.days.map((cell) => {
                    const resolved = resolveCell(
                      cell,
                      line.current_cycle_week,
                      overridesByKey,
                      shiftClocks
                    );
                    const isEditing =
                      !swapMode &&
                      editingCell !== null &&
                      editingCell.cycleWeek === line.current_cycle_week &&
                      editingCell.dayIndex === cell.day_index;
                    const picked = isPicked(line.line_number, cell.day_index);
                    const cellDomId = `roster-cell-${line.current_cycle_week}-${cell.day_index}`;
                    const rowName = line.assigned_person ?? `Shift Pattern ${line.line_number}`;
                    const dayName = DAY_FULL_NAMES[cell.day_index];
                    const draftPreview = isEditing
                      ? previewOverride(solution, overrides, {
                          cycle_week: line.current_cycle_week,
                          day_index: cell.day_index,
                          shift_code: draftCode,
                          original_shift_code: resolved.original_shift_code,
                        })
                      : null;
                    const draftFindings = draftPreview ? draftPreview.findings : [];

                    return (
                      <td
                        key={cell.day_index}
                        className={`p-2 text-center ${cell.is_weekend ? 'bg-surface-subtle' : ''}`}
                      >
                        {isEditing ? (
                          <div className="min-w-[9rem] text-left no-print">
                            <label
                              htmlFor={`${cellDomId}-shift`}
                              className="block text-xs font-semibold text-ink-soft mb-1"
                            >
                              {rowName} — {dayName} shift
                            </label>
                            <select
                              id={`${cellDomId}-shift`}
                              value={draftCode}
                              onChange={(e) => setDraftCode(e.target.value as ShiftOrOffCode)}
                              aria-describedby={
                                draftFindings.length > 0 ? `${cellDomId}-findings` : undefined
                              }
                              className="w-full px-2 py-1 border border-border-control rounded-md text-xs bg-card text-ink"
                            >
                              {shiftCodeChoices.map((code) => (
                                <option key={code} value={code}>
                                  {code} — {SHIFT_CODE_LABELS[code]}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-muted">
                              Generated: {resolved.original_shift_code}
                              {draftPreview
                                ? ` • this line would work ${draftPreview.weekly_hours}h`
                                : ''}
                            </p>
                            {draftFindings.length > 0 && (
                              <ul id={`${cellDomId}-findings`} className="mt-1 space-y-1">
                                {draftFindings.map((finding) => (
                                  <li
                                    key={`${finding.rule}-${finding.line_number}-${finding.day_index}`}
                                    className="text-xs font-semibold text-status-risk-ink"
                                  >
                                    {finding.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() =>
                                  commitEdit(
                                    line.current_cycle_week,
                                    cell.day_index,
                                    resolved.original_shift_code
                                  )
                                }
                              >
                                Save
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setEditingCell(null)}
                              >
                                Cancel
                              </Button>
                              {resolved.is_modified && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    revertEdit(line.current_cycle_week, cell.day_index)
                                  }
                                >
                                  Undo edit
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            aria-pressed={swapMode ? picked : undefined}
                            onClick={() =>
                              swapMode
                                ? toggleSwapPick({
                                    line_number: line.line_number,
                                    day_index: cell.day_index,
                                    shift_code: resolved.shift_code,
                                  })
                                : startEditingCell(
                                    line.current_cycle_week,
                                    cell.day_index,
                                    resolved.shift_code
                                  )
                            }
                            aria-label={
                              (swapMode
                                ? `${picked ? 'Remove from the swap' : 'Choose for the swap'}: ` +
                                  `${rowName}'s ${dayName} shift. Currently `
                                : `Change ${rowName}'s ${dayName} shift. Currently `) +
                              `${resolved.shift_code}, ${resolved.time_window}` +
                              (resolved.is_modified
                                ? `, modified from the generated ${resolved.original_shift_code}.`
                                : ' as generated.')
                            }
                            className="w-full rounded-lg text-left"
                          >
                            <div
                              className={`shift-pill-${resolved.shift_code} rounded-lg py-1.5 px-2 flex flex-col items-center justify-center relative ${
                                cell.availability_conflict ? 'ring-2 ring-status-watch' : ''
                              } ${resolved.is_modified ? 'border-2 border-accent-strong' : ''} ${
                                picked ? 'ring-2 ring-accent-strong' : ''
                              }`}
                            >
                              {picked && (
                                <span className="text-[9px] font-bold uppercase tracking-wide text-accent-strong">
                                  Chosen for swap
                                </span>
                              )}
                              <span className="font-mono-tabular font-bold text-xs">
                                {resolved.shift_code}
                              </span>
                              <span className="text-xs font-mono-tabular mt-0.5">
                                {resolved.shift_code === 'OFF' ? 'Rest' : resolved.time_window}
                              </span>
                              {resolved.is_modified && (
                                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-strong">
                                  Modified from {resolved.original_shift_code}
                                </span>
                              )}
                              {cell.availability_conflict && (
                                <span className="text-[9px] font-bold uppercase tracking-wide text-status-watch-ink mt-0.5">
                                  ! Conflict
                                </span>
                              )}
                              {cell.availability_conflict && (
                                <span
                                  className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-status-watch"
                                  title="Worker marked this day as unavailable!"
                                />
                              )}
                            </div>
                          </button>
                        )}
                      </td>
                    );
                  })}

                  <td className="py-3 px-3 text-right font-mono-tabular">
                    <span className="font-bold text-ink">{editedHours.weekly_hours}h</span>
                    {editedHours.overtime_hours > 0 && (
                      <span className="block text-xs text-status-watch-ink font-semibold">
                        +{editedHours.overtime_hours}h OT
                      </span>
                    )}
                    {isEdited && editedHours.weekly_hours !== line.weekly_hours && (
                      <span className="block text-xs text-muted">
                        was {line.weekly_hours}h
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right font-mono-tabular font-bold text-ink">
                    {formatCurrency(editedPayroll)}
                  </td>
                </tr>
                );
              })}
            </tbody>
            {/* Understaffing is a per-day total, not a header: it belongs in the
                foot as data, so no body cell inherits it as a column header. */}
            <tfoot className="text-xs">
              <tr className="bg-amber-50/70 border-t border-border-subtle font-semibold text-amber-900">
                <th scope="row" className="py-2 px-4 text-left">Under-staffed hours per day</th>
                <td className="py-2 px-2" />
                {underByDay.map((h, idx) => (
                  <td
                    key={DAYS_OF_WEEK[idx]}
                    className={`py-2 px-2.5 text-center font-mono-tabular ${
                      idx >= 5 ? 'bg-amber-100/60' : ''
                    }`}
                  >
                    {h}h
                  </td>
                ))}
                <td colSpan={2} className="py-2 px-4 text-right font-mono-tabular">
                  Week total: {totalUnderHours}h
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Add New Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={addDialogRef} role="dialog" aria-modal="true" aria-labelledby="roster-add-staff-title" className="bg-white border border-border-control rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border-subtle">
              <h3 id="roster-add-staff-title" className="text-base font-bold text-ink">Add Staff Member</h3>
              <button aria-label="Close"
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-muted hover:text-ink font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitNewEmployee} className="space-y-3.5">
              <div>
                <label htmlFor="roster-new-name" className="block text-xs font-semibold text-ink-soft mb-1">
                  Full Name
                </label>
                <input id="roster-new-name"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Alex Morgan"
                  className="w-full px-3 py-2 border border-border-control rounded-md text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="roster-new-role" className="block text-xs font-semibold text-ink-soft mb-1">
                    Role / Position
                  </label>
                  <input id="roster-new-role"
                    type="text"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2 border border-border-control rounded-md text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="roster-new-wage" className="block text-xs font-semibold text-ink-soft mb-1">
                    Hourly Wage ($/hr)
                  </label>
                  <input id="roster-new-wage"
                    type="number"
                    step="0.25"
                    min={WAGE_MIN}
                    max={WAGE_MAX}
                    aria-invalid={newWage.trim() !== '' && newWageValue === null}
                    aria-describedby={newWage.trim() !== '' && newWageValue === null ? 'roster-new-wage-error' : undefined}
                    value={newWage}
                    onChange={(e) => setNewWage(e.target.value)}
                    className="w-full px-3 py-2 border border-border-control rounded-md text-xs font-mono-tabular"
                  />
                  {newWage.trim() !== '' && newWageValue === null && (
                    <p id="roster-new-wage-error" className="mt-1 text-xs font-semibold text-danger">
                      {WAGE_ERROR}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  Available Days for Shift Assignment:
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {DAYS_OF_WEEK.map((dName, dIdx) => {
                    const isSel = newAvailDays.includes(dIdx);
                    return (
                      <button
                        key={dName}
                        type="button"
                        aria-pressed={isSel}
                        aria-label={DAY_FULL_NAMES[dIdx]}
                        onClick={() => handleToggleDay(dIdx)}
                        className={`py-1.5 rounded text-xs font-mono-tabular font-bold border ${
                          isSel
                            ? 'bg-ink text-card border-ink'
                            : 'bg-surface text-ink-soft border-border-subtle'
                        }`}
                      >
                        {dName}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs text-muted mt-1 block">
                  Tap to toggle available working days.
                </span>
              </div>

              <div className="pt-3 border-t border-border-subtle flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={newWageValue === null}>
                  Save & Map to Schedule
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
