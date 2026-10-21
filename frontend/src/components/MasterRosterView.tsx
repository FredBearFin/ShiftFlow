import React, { useRef, useState } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import {
  EmployeeRecord,
  NewEmployeeInput,
  RosterLine,
  SeparationCategory,
  SolveResponse,
  StaffMemberAssignment,
} from '../types';
import { DAYS_OF_WEEK } from '../services/api';
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

  return (
    <div className="space-y-5">
      {/* Top Executive KPI Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 no-print">
        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Shift Patterns
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {solution.employee_count}
            </span>
            <span className="text-xs font-medium text-slate-500">
              {solution.employee_count}-Wk Cycle
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {activeEmployees.length} Active Staff • {inactiveEmployees.length} Inactive
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Estimated Weekly Payroll
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {formatCurrency(solution.labor_analysis.total_payroll_cost)}
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">
              {formatHourlyRate(solution.labor_analysis.avg_hourly_wage)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            OT: {formatCurrency(solution.labor_analysis.overtime_payroll_cost)}
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Ergonomics Health Index
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-[#2B3A42]">
              {solution.ergonomics_audit.health_index_score}%
            </span>
            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {solution.ergonomics_audit.clopening_violations} Clopenings
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Min rest: {solution.ergonomics_audit.min_rest_hours_observed}h observed
          </p>
        </div>

        <div className="card p-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Full Weekends Off (Sat+Sun)
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {solution.ergonomics_audit.full_weekends_off_pct}%
            </span>
            <span className="text-xs font-mono-tabular text-slate-600">
              {solution.ergonomics_audit.full_weekends_off_count}/{solution.employee_count} Shift Patterns
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Both Saturday & Sunday OFF together
          </p>
        </div>

        <div className="card p-4 col-span-2 lg:col-span-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 block">
            Availability Adherence
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-[#2B3A42]">
              {solution.roster_lines.reduce((a, l) => a + l.availability_conflicts_count, 0) === 0
                ? '100%'
                : `${solution.roster_lines.reduce((a, l) => a + l.availability_conflicts_count, 0)} Conflicts`}
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">
              {solution.solve_time_ms} ms
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Staff day availability checked
          </p>
        </div>
      </div>

      {/* Weekly Schedule Card */}
      <div className="card overflow-hidden">
        {/* Print-only header: visible on paper, hidden on screen */}
        <div className="hidden print:block px-6 pt-4 pb-3 border-b border-slate-300">
          <h2 className="type-section-title text-slate-900">{solution.instance_name}</h2>
          <p className="type-prose text-slate-700 font-mono-tabular">
            Week {activeCycleWeek} of {solution.employee_count}
          </p>
        </div>

        {/* Roster Action Toolbar */}
        <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-white">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="type-section-title text-slate-900">
                Weekly Schedule (Patterns 1 to {solution.employee_count})
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono-tabular font-semibold bg-slate-100 text-slate-800 border border-slate-300">
                Showing Week {activeCycleWeek} of {solution.employee_count}
              </span>
            </div>
            <p className="type-prose text-slate-500 mt-0.5">
              {solution.employee_count} shift patterns are repeating schedule slots built from your
              hours — they exist before you assign any real staff. Every Monday morning, each one
              advances down one row. Manage employee availability, hourly wages, and active/fired
              status in the Staff & Directory drawer (key D).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="inline-flex items-center rounded-md border border-[#7F8A92] bg-slate-50 p-0.5">
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
              <span>Staff & Directory</span><kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 text-xs font-mono-tabular font-bold ml-1">D</kbd>
              <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 text-xs">
                {activeEmployees.length}
              </span>
            </Button>

            <Button variant="primary" size="sm" onClick={() => setShowAddModal(true)}>
              + Add Employee <kbd className="px-1.5 py-0.5 rounded bg-[#1E2A31] text-[#FFFFFF] text-xs font-mono-tabular font-bold">A</kbd>
            </Button>

            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print Roster <kbd className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-xs font-mono-tabular font-bold">P</kbd>
            </Button>

            <Button variant="accent" onClick={onExportCsv}>
              Export CSV
            </Button>
          </div>
        </div>

        {/* Staff & Availability Directory Management Drawer */}
        {showDirectoryDrawer && (
          <div className="p-4 sm:px-6 bg-slate-50 border-b border-slate-200 space-y-4 no-print">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="type-subsection-title text-slate-800">
                  Staff Directory & Availability Controls (Add / Fire / Adjust Wages)
                </h3>
                <p className="type-prose text-slate-500">
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
                      ? 'bg-white border-[#7F8A92]'
                      : 'bg-slate-100/80 border-[#7F8A92] opacity-60'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-bold text-xs text-slate-900 block">
                          {emp.name}
                        </span>
                        <span className="text-xs text-slate-500">
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

                    <div className="mt-2.5 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <label htmlFor={`roster-wage-${emp.employee_id}`} className="text-xs text-slate-500 block">Wage ($/hr)</label>
                        <input id={`roster-wage-${emp.employee_id}`}
                          type="number"
                          step="0.5"
                          min={WAGE_MIN}
                          max={WAGE_MAX}
                          disabled={!emp.is_active}
                          aria-invalid={wageDrafts[emp.employee_id] !== undefined && parseWage(wageDrafts[emp.employee_id]) === null}
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
                          className="w-full px-2 py-1 border border-[#7F8A92] rounded-md font-mono-tabular text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor={`roster-line-${emp.employee_id}`} className="text-xs text-slate-500 block">Assigned Line</label>
                        <select id={`roster-line-${emp.employee_id}`}
                          disabled={!emp.is_active}
                          value={emp.assigned_line_id || ''}
                          onChange={(e) =>
                            onUpdateEmployee({
                              ...emp,
                              assigned_line_id: e.target.value ? parseInt(e.target.value, 10) : null,
                            })
                          }
                          className="w-full px-2 py-1 border border-[#7F8A92] rounded-md text-xs bg-slate-50"
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
                      <label className="text-xs text-slate-500 block mb-1">
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
                                  ? 'bg-[#2B3A42] text-[#FFFFFF]'
                                  : 'bg-slate-200 text-slate-600'
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

                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-mono-tabular">
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
                      className="mt-3 pt-3 border-t border-slate-100 space-y-2"
                    >
                      <div>
                        <label htmlFor={`sep-category-${emp.employee_id}`} className="text-xs text-slate-500 block">
                          Separation category
                        </label>
                        <select
                          id={`sep-category-${emp.employee_id}`}
                          value={sepCategory}
                          onChange={(e) => setSepCategory(e.target.value as SeparationCategory)}
                          className="w-full px-2 py-1 border border-[#7F8A92] rounded-md text-xs bg-white"
                        >
                          {SEPARATION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`sep-reason-${emp.employee_id}`} className="text-xs text-slate-500 block">
                          Reason (required)
                        </label>
                        <input
                          id={`sep-reason-${emp.employee_id}`}
                          type="text"
                          required
                          value={sepReason}
                          onChange={(e) => setSepReason(e.target.value)}
                          className="w-full px-2 py-1 border border-[#7F8A92] rounded-md text-xs"
                        />
                      </div>
                      <div>
                        <label htmlFor={`sep-recorded-by-${emp.employee_id}`} className="text-xs text-slate-500 block">
                          Recorded by (required)
                        </label>
                        <input
                          id={`sep-recorded-by-${emp.employee_id}`}
                          type="text"
                          required
                          value={sepRecordedBy}
                          onChange={(e) => setSepRecordedBy(e.target.value)}
                          className="w-full px-2 py-1 border border-[#7F8A92] rounded-md text-xs"
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

        {/* Weekly Schedule Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 min-w-[200px]">Shift Pattern / Staff Member</th>
                <th className="py-3 px-2 text-center">Pattern Wk</th>
                {DAYS_OF_WEEK.map((day, idx) => (
                  <th
                    key={day}
                    className={`py-3 px-2.5 text-center ${
                      idx >= 5 ? 'bg-slate-100/80 text-slate-800' : ''
                    }`}
                  >
                    {day}
                  </th>
                ))}
                <th className="py-3 px-3 text-right">Hours</th>
                <th className="py-3 px-4 text-right">Weekly Payroll</th>
              </tr>
              <tr className="bg-amber-50/70 border-b border-slate-200 text-xs font-semibold normal-case tracking-normal text-amber-900">
                <th className="py-2 px-4 text-left">Under-staffed hours per day</th>
                <th className="py-2 px-2" />
                {underByDay.map((h, idx) => (
                  <th
                    key={DAYS_OF_WEEK[idx]}
                    className={`py-2 px-2.5 text-center font-mono-tabular ${
                      idx >= 5 ? 'bg-amber-100/60' : ''
                    }`}
                  >
                    {h}h
                  </th>
                ))}
                <th colSpan={2} className="py-2 px-4 text-right font-mono-tabular">
                  Week total: {totalUnderHours}h
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {solution.roster_lines.map((line: RosterLine) => (
                <tr
                  key={line.cohort_id}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono-tabular font-bold text-xs">
                        {line.cohort_id}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {line.assigned_person
                          ? line.assigned_person
                          : `Shift Pattern ${line.line_number}`}
                      </span>
                      {line.availability_conflicts_count > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-[#E4E9EC] text-[#2B3A42] border border-[#7F8A92] before:content-[''] before:inline-block before:w-2 before:h-2 before:rounded-full before:bg-[#C28B47] before:mr-1.5 before:align-middle">
                          {line.availability_conflicts_count} Avail Alert
                        </span>
                      )}
                      {line.statutory_accommodation_violation && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-white text-[#9F3A32] border border-[#9F3A32]">
                          Title VII / ADA Sabbath Alert
                        </span>
                      )}
                      {line.fair_workweek_predictability_warning && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-white text-[#9F3A32] border border-[#9F3A32]">
                          Predictability Pay Risk
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{line.qualification_tier}</span>
                      <span>•</span>
                      <span className="font-mono-tabular">{formatHourlyRate(line.hourly_wage)}</span>
                      <span>•</span>
                      <span>Next Mon → Line {line.next_week_line_number}</span>
                    </div>
                  </td>

                  <td className="py-3 px-2 text-center">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono-tabular font-semibold text-xs">
                      Wk {line.current_cycle_week}
                    </span>
                  </td>

                  {line.days.map((cell) => (
                    <td
                      key={cell.day_index}
                      className={`p-2 text-center ${
                        cell.is_weekend ? 'bg-slate-50/70' : ''
                      }`}
                    >
                      <div
                        className={`shift-pill-${cell.shift_code} rounded-lg py-1.5 px-2 flex flex-col items-center justify-center relative ${
                          cell.availability_conflict ? 'ring-2 ring-amber-500' : ''
                        }`}
                      >
                        <span className="font-mono-tabular font-bold text-xs">
                          {cell.shift_code}
                        </span>
                        <span className="text-xs opacity-85 font-mono-tabular mt-0.5">
                          {cell.shift_code === 'OFF' ? 'Rest' : cell.time_window}
                        </span>
                        {cell.availability_conflict && (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-amber-900 mt-0.5">
                            ! Conflict
                          </span>
                        )}
                        {cell.availability_conflict && (
                          <span
                            className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500"
                            title="Worker marked this day as unavailable!"
                          />
                        )}
                      </div>
                    </td>
                  ))}

                  <td className="py-3 px-3 text-right font-mono-tabular">
                    <span className="font-bold text-slate-900">{line.weekly_hours}h</span>
                    {line.overtime_hours > 0 && (
                      <span className="block text-xs text-amber-700 font-semibold">
                        +{line.overtime_hours}h OT
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right font-mono-tabular font-bold text-slate-900">
                    {formatCurrency(line.estimated_weekly_payroll)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={addDialogRef} role="dialog" aria-modal="true" aria-labelledby="roster-add-staff-title" className="bg-white border border-[#7F8A92] rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 id="roster-add-staff-title" className="text-base font-bold text-slate-900">Add Staff Member</h3>
              <button aria-label="Close"
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitNewEmployee} className="space-y-3.5">
              <div>
                <label htmlFor="roster-new-name" className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <input id="roster-new-name"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Alex Morgan"
                  className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="roster-new-role" className="block text-xs font-semibold text-slate-700 mb-1">
                    Role / Position
                  </label>
                  <input id="roster-new-role"
                    type="text"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="roster-new-wage" className="block text-xs font-semibold text-slate-700 mb-1">
                    Hourly Wage ($/hr)
                  </label>
                  <input id="roster-new-wage"
                    type="number"
                    step="0.25"
                    min={WAGE_MIN}
                    max={WAGE_MAX}
                    aria-invalid={newWage.trim() !== '' && newWageValue === null}
                    value={newWage}
                    onChange={(e) => setNewWage(e.target.value)}
                    className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs font-mono-tabular"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
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
                            ? 'bg-[#2B3A42] text-[#FFFFFF] border-[#2B3A42]'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {dName}
                      </button>
                    );
                  })}
                </div>
                <span className="text-xs text-slate-400 mt-1 block">
                  Tap to toggle available working days.
                </span>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
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
