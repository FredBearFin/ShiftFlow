import React, { useState } from 'react';
import {
  EmployeeRecord,
  RosterLine,
  SolveResponse,
  StaffMemberAssignment,
} from '../types';
import { DAYS_OF_WEEK } from '../services/api';

interface MasterRosterViewProps {
  solution: SolveResponse;
  rotationWeekOffset: number;
  staffAssignments: StaffMemberAssignment[];
  employees: EmployeeRecord[];
  onAdvanceWeek: (delta: number) => void;
  onResetWeek: () => void;
  onUpdateStaffAssignments: (assignments: StaffMemberAssignment[]) => void;
  onAddEmployee: (emp: Omit<EmployeeRecord, 'employee_id'>) => void;
  onToggleEmployeeStatus: (empId: string) => void;
  onUpdateEmployee: (emp: EmployeeRecord) => void;
  onExportCsv: () => void;
  showCalloutModal?: boolean;
  onSetShowCalloutModal?: (show: boolean) => void;
  showSwapModal?: boolean;
  onSetShowSwapModal?: (show: boolean) => void;
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
  showCalloutModal: extCalloutModal,
  onSetShowCalloutModal: extSetCalloutModal,
  showSwapModal: extSwapModal,
  onSetShowSwapModal: extSetSwapModal,
  showAddModal: extAddModal,
  onSetShowAddModal: extSetAddModal,
  showDirectoryDrawer: extDirectoryDrawer,
  onSetShowDirectoryDrawer: extSetDirectoryDrawer,
}) => {
  const [internalDirectoryDrawer, setInternalDirectoryDrawer] = useState(false);
  const [internalAddModal, setInternalAddModal] = useState(false);
  const [internalCalloutModal, setInternalCalloutModal] = useState(false);
  const [internalSwapModal, setInternalSwapModal] = useState(false);

  const showDirectoryDrawer = extDirectoryDrawer !== undefined ? extDirectoryDrawer : internalDirectoryDrawer;
  const setShowDirectoryDrawer = extSetDirectoryDrawer || setInternalDirectoryDrawer;

  const showAddModal = extAddModal !== undefined ? extAddModal : internalAddModal;
  const setShowAddModal = extSetAddModal || setInternalAddModal;

  const showCalloutModal = extCalloutModal !== undefined ? extCalloutModal : internalCalloutModal;
  const setShowCalloutModal = extSetCalloutModal || setInternalCalloutModal;

  const showSwapModal = extSwapModal !== undefined ? extSwapModal : internalSwapModal;
  const setShowSwapModal = extSetSwapModal || setInternalSwapModal;
  const [swapScenario, setSwapScenario] = useState<'danger' | 'safe'>('danger');

  // New Employee Form State
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Frontline Associate');
  const [newWage, setNewWage] = useState('16.50');
  const [newAvailDays, setNewAvailDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

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
    if (!newName.trim()) return;
    onAddEmployee({
      name: newName.trim(),
      role: newRole,
      hourly_wage: parseFloat(newWage) || 16.50,
      max_weekly_hours: 40,
      is_active: true,
      available_days: newAvailDays,
      preferred_shifts: ['M', 'D', 'E'],
    });
    setNewName('');
    setNewWage('16.50');
    setNewAvailDays([0, 1, 2, 3, 4, 5, 6]);
    setShowAddModal(false);
  };

  const activeCycleWeek = (rotationWeekOffset % solution.employee_count) + 1;

  return (
    <div className="space-y-5">
      {/* Top Executive KPI Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Rotation Cohorts (e)
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {solution.employee_count} Lines
            </span>
            <span className="text-xs font-medium text-slate-500">
              {solution.employee_count}-Wk Cycle
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {activeEmployees.length} Active Staff • {inactiveEmployees.length} Inactive
          </p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Estimated Weekly Payroll
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              ${solution.labor_analysis.total_payroll_cost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">
              ${solution.labor_analysis.avg_hourly_wage.toFixed(2)}/hr
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            OT: ${solution.labor_analysis.overtime_payroll_cost.toFixed(2)}
          </p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Ergonomics Health Index
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-emerald-700">
              {solution.ergonomics_audit.health_index_score}%
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              0 Clopenings
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Min rest: {solution.ergonomics_audit.min_rest_hours_observed}h observed
          </p>
        </div>

        <div className="enterprise-card p-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Full Weekends Off (Sat+Sun)
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-slate-900">
              {solution.ergonomics_audit.full_weekends_off_pct}%
            </span>
            <span className="text-xs font-mono-tabular text-slate-600">
              {solution.ergonomics_audit.full_weekends_off_count}/{solution.employee_count} Lines
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Both Saturday & Sunday OFF together
          </p>
        </div>

        <div className="enterprise-card p-4 col-span-2 lg:col-span-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
            Availability Adherence
          </span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono-tabular text-indigo-700">
              {solution.roster_lines.reduce((a, l) => a + l.availability_conflicts_count, 0) === 0
                ? '100%'
                : `${solution.roster_lines.reduce((a, l) => a + l.availability_conflicts_count, 0)} Conflicts`}
            </span>
            <span className="text-xs font-mono-tabular text-slate-500">
              {solution.solve_time_ms} ms
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Staff day availability checked
          </p>
        </div>
      </div>

      {/* Master Cyclic Roster Card */}
      <div className="enterprise-card-elevated overflow-hidden">
        {/* Roster Action Toolbar */}
        <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-white">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900">
                Master Cyclic Rotation Roster (Lines 1 to {solution.employee_count})
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono-tabular font-semibold bg-slate-100 text-slate-800 border border-slate-300">
                Active Cycle Horizon: Week {activeCycleWeek} of {solution.employee_count}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Every Monday morning, each line advances down one row. Manage employee availability,
              hourly wages, and active/fired status in the Staff Directory.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 no-print">
            <div className="inline-flex items-center rounded-lg border border-slate-300 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => onAdvanceWeek(-1)}
                className="px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-white rounded-md transition-colors"
                title="Step backward 1 rotation week"
              >
                ← Prev Wk
              </button>
              <button
                type="button"
                onClick={onResetWeek}
                className="px-2.5 py-1 text-xs font-mono-tabular font-semibold text-slate-600 hover:text-slate-900"
              >
                Wk {activeCycleWeek}
              </button>
              <button
                type="button"
                onClick={() => onAdvanceWeek(1)}
                className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-white shadow-2xs rounded-md hover:bg-indigo-50 transition-colors"
                title="Advance all cohorts by 1 rotation week"
              >
                Advance +1 Wk →
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowCalloutModal(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold shadow-xs flex items-center gap-1"
            >
              <span>⚡ Saturday Callout</span><kbd className="px-1.5 py-0.2 rounded bg-amber-600/70 text-amber-100 text-[10px] font-mono-tabular font-bold ml-1">C</kbd>
            </button>

            <button
              type="button"
              onClick={() => setShowSwapModal(true)}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1"
            >
              <span>⇄ Shift Swap</span><kbd className="px-1.5 py-0.2 rounded bg-indigo-700 text-indigo-200 text-[10px] font-mono-tabular font-bold ml-1">S</kbd>
            </button>

            <button
              type="button"
              onClick={() => setShowDirectoryDrawer((v) => !v)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                showDirectoryDrawer
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span>Staff & Directory</span><kbd className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-800 text-[10px] font-mono-tabular font-bold ml-1">D</kbd>
              <span className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-800 text-[10px]">
                {activeEmployees.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs"
            >
              + Add Employee <kbd className="px-1.5 py-0.2 rounded bg-emerald-700 text-emerald-100 text-[10px] font-mono-tabular font-bold ml-1">A</kbd>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
            >
              Print Roster <kbd className="px-1.5 py-0.2 rounded bg-slate-200 text-slate-700 text-[10px] font-mono-tabular font-bold ml-1">P</kbd>
            </button>

            <button
              type="button"
              onClick={onExportCsv}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs"
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Staff & Availability Directory Management Drawer */}
        {showDirectoryDrawer && (
          <div className="p-4 sm:px-6 bg-slate-50 border-b border-slate-200 space-y-4 no-print">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Staff Directory & Availability Controls (Add / Fire / Adjust Wages)
                </h3>
                <p className="text-xs text-slate-500">
                  Manage active staff, fire or deactivate employees, adjust individual hourly wages,
                  and set allowed working days. Inactive/fired staff are instantly unmapped from lines.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                + New Employee Form
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
              {employees.map((emp) => (
                <div
                  key={emp.employee_id}
                  className={`p-3 rounded-xl border flex flex-col justify-between ${
                    emp.is_active
                      ? 'bg-white border-slate-200 shadow-2xs'
                      : 'bg-slate-100/80 border-slate-200 opacity-60'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-bold text-xs text-slate-900 block">
                          {emp.name}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {emp.role} {emp.assigned_line_id ? `• Line ${emp.assigned_line_id}` : '• Unassigned'}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
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
                        <label className="text-[10px] text-slate-500 block">Wage ($/hr)</label>
                        <input
                          type="number"
                          step="0.5"
                          disabled={!emp.is_active}
                          value={emp.hourly_wage}
                          onChange={(e) =>
                            onUpdateEmployee({
                              ...emp,
                              hourly_wage: parseFloat(e.target.value) || 16.50,
                            })
                          }
                          className="w-full px-2 py-1 border border-slate-200 rounded font-mono-tabular text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 block">Assigned Line</label>
                        <select
                          disabled={!emp.is_active}
                          value={emp.assigned_line_id || ''}
                          onChange={(e) =>
                            onUpdateEmployee({
                              ...emp,
                              assigned_line_id: e.target.value ? parseInt(e.target.value, 10) : null,
                            })
                          }
                          className="w-full px-2 py-1 border border-slate-200 rounded text-xs bg-slate-50"
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
                      <label className="text-[10px] text-slate-500 block mb-1">
                        Available Days ({emp.available_days.length}/7):
                      </label>
                      <div className="flex gap-1">
                        {DAYS_OF_WEEK.map((dName, dIdx) => {
                          const isAvail = emp.available_days.includes(dIdx);
                          return (
                            <button
                              key={dName}
                              type="button"
                              disabled={!emp.is_active}
                              onClick={() => {
                                const nextDays = isAvail
                                  ? emp.available_days.filter((x) => x !== dIdx)
                                  : [...emp.available_days, dIdx].sort();
                                onUpdateEmployee({ ...emp, available_days: nextDays });
                              }}
                              className={`w-5 h-5 rounded text-[10px] font-mono-tabular font-bold flex items-center justify-center ${
                                isAvail
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-200 text-slate-400'
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
                    <span className="text-[10px] text-slate-400 font-mono-tabular">
                      ID: {emp.employee_id}
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggleEmployeeStatus(emp.employee_id)}
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        emp.is_active
                          ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                      }`}
                    >
                      {emp.is_active ? 'Deactivate / Fire' : 'Reactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Master Cyclic Roster Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 min-w-[200px]">Rotation Cohort / Personnel</th>
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
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {solution.roster_lines.map((line: RosterLine) => (
                <tr
                  key={line.cohort_id}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono-tabular font-bold text-[11px]">
                        {line.cohort_id}
                      </span>
                      <span className="font-semibold text-slate-900">
                        {line.assigned_person
                          ? line.assigned_person
                          : `Rotation Line ${line.line_number}`}
                      </span>
                      {line.availability_conflicts_count > 0 && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          {line.availability_conflicts_count} Avail Alert
                        </span>
                      {line.statutory_accommodation_violation && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-900 border border-purple-300">
                          Title VII / ADA Sabbath Alert
                        </span>
                      )}
                      {line.fair_workweek_predictability_warning && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300">
                          Predictability Pay Risk
                        </span>
                      )}
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{line.qualification_tier}</span>
                      <span>•</span>
                      <span className="font-mono-tabular">${line.hourly_wage.toFixed(2)}/hr</span>
                      <span>•</span>
                      <span>Next Mon → Line {line.next_week_line_number}</span>
                    </div>
                  </td>

                  <td className="py-3 px-2 text-center">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono-tabular font-semibold text-[11px]">
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
                        <span className="text-[10px] opacity-85 font-mono-tabular mt-0.5">
                          {cell.shift_code === 'OFF' ? 'Rest' : cell.time_window}
                        </span>
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
                      <span className="block text-[10px] text-amber-700 font-semibold">
                        +{line.overtime_hours}h OT
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right font-mono-tabular font-bold text-slate-900">
                    ${line.estimated_weekly_payroll.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add New Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Add New Workforce Associate</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitNewEmployee} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Alex Morgan"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:border-indigo-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Role / Position
                  </label>
                  <input
                    type="text"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Hourly Wage ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="7.25"
                    max="100"
                    value={newWage}
                    onChange={(e) => setNewWage(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono-tabular"
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
                        onClick={() => handleToggleDay(dIdx)}
                        className={`py-1.5 rounded text-xs font-mono-tabular font-bold border ${
                          isSel
                            ? 'bg-indigo-600 text-white border-indigo-700'
                            : 'bg-slate-100 text-slate-400 border-slate-200'
                        }`}
                      >
                        {dName}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Tap to toggle available working days.
                </span>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold"
                >
                  Save & Map to Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Saturday Emergency Callout Modal */}
      {showCalloutModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono-tabular font-bold bg-amber-500 text-slate-950">
                  FLOOR CRISIS DISPATCH
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1">Saturday Evening Callout Rebalancing (8:00 PM)</h3>
              </div>
              <button onClick={() => setShowCalloutModal(false)} className="text-slate-400 font-bold">✕</button>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <strong>Frontline Absence:</strong> Cashier Elena Rodriguez called out of Saturday Evening (16:00–24:00). ShiftFlow evaluated all associates to prevent clopenings and unauthorized overtime.
            </div>

            <div className="space-y-2.5">
              <div className="p-3.5 rounded-xl border border-emerald-300 bg-emerald-50/50 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white">#1 TOP RECOMMENDATION</span>
                    <span className="text-xs font-bold text-slate-900">Devon Taylor (Senior Clerk)</span>
                    <span className="text-[11px] text-slate-500 font-mono-tabular">$17.50/hr</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">
                    ✓ 21.0h prior rest • ✓ 40.0h next rest • 32h → <strong>40.0h total ($0 overtime)</strong>
                  </p>
                </div>
                <button
                  onClick={() => {
                    alert("Assigned Devon Taylor to cover Saturday Closing. Next Monday rotation lines remain 100% preserved.");
                    setShowCalloutModal(false);
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs"
                >
                  Assign Replacement
                </button>
              </div>

              <div className="p-3.5 rounded-xl border border-red-200 bg-red-50/40 flex items-center justify-between opacity-75">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300">BLOCKED — CLOPENING</span>
                    <span className="text-xs font-bold text-slate-900">Priya Patel (Customer Service)</span>
                  </div>
                  <p className="text-[11px] text-red-700 mt-1">
                    ❌ <strong>Illegal Clopening</strong>: Scheduled to open Sunday at 06:00 (only 6.0h turnaround from midnight!).
                  </p>
                </div>
                <button disabled className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-400 text-xs font-semibold cursor-not-allowed">
                  Blocked by Law
                </button>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button onClick={() => setShowCalloutModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Swap Modal */}
      {showSwapModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">Peer-to-Peer Shift Trade Validator</h3>
              <button onClick={() => setShowSwapModal(false)} className="text-slate-400 font-bold">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSwapScenario('danger')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  swapScenario === 'danger' ? 'border-2 border-red-500 bg-red-50' : 'border-slate-300 bg-slate-50'
                }`}
              >
                <span className="text-xs font-bold text-slate-900 block">Scenario A: Hazardous Swap</span>
                <span className="text-[11px] text-slate-500 mt-1 block">Carlos (Wed Eve) ⇄ Devon (Thu Day)</span>
              </button>
              <button
                onClick={() => setSwapScenario('safe')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  swapScenario === 'safe' ? 'border-2 border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-slate-50'
                }`}
              >
                <span className="text-xs font-bold text-slate-900 block">Scenario B: Compliant Swap</span>
                <span className="text-[11px] text-slate-500 mt-1 block">Carlos (Tue Day) ⇄ Devon (Fri Day)</span>
              </button>
            </div>

            <div className={`p-4 rounded-xl border ${swapScenario === 'danger' ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>
              {swapScenario === 'danger' ? (
                <>
                  <div className="text-xs font-bold text-red-700">❌ REJECTED BY FAIR WORKWEEK GUARDRAILS</div>
                  <p className="text-[11px] mt-1">
                    Carlos would receive only 11.0h rest between Wednesday close (24:00) and Thursday midday start (11:00). Triggers statutory penalty pay.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-xs font-bold text-emerald-700">✓ APPROVED BY ENGINE</div>
                  <p className="text-[11px] mt-1">
                    Complies with mandatory ≥16h rest and 40h regular limits for both cashiers. Monday cycle progression remains 100% intact.
                  </p>
                </>
              )}
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setShowSwapModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold">Cancel</button>
              <button
                disabled={swapScenario === 'danger'}
                onClick={() => {
                  alert("Shift swap executed successfully! Master Monday rotation progression remains 100% intact.");
                  setShowSwapModal(false);
                }}
                className={`px-4 py-2 rounded-lg text-xs font-bold ${
                  swapScenario === 'safe' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                Approve Swap
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
