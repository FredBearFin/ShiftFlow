import React, { useRef, useState } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { EmployeeRecord, RosterLine, SeparationCategory } from '../types';
import { DAYS_OF_WEEK } from '../services/api';

const DAY_FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const WAGE_MIN = 7.25;
const WAGE_MAX = 100;

// A blank or out-of-bounds wage is not a number: no substitute value is ever used.
const parseWage = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= WAGE_MIN && n <= WAGE_MAX ? n : null;
};

interface StaffDirectoryViewProps {
  employees: EmployeeRecord[];
  rosterLines: RosterLine[];
  onAddEmployee: (emp: {
    name: string;
    role: string;
    wage: number;
    days: number[];
  }) => void;
  onToggleActive: (
    id: string,
    separationData?: {
      category: SeparationCategory;
      reason: string;
      recorded_by: string;
    }
  ) => void;
  onUpdateAvailability: (id: string, days: number[]) => void;
}

export const StaffDirectoryView: React.FC<StaffDirectoryViewProps> = ({
  employees,
  rosterLines,
  onAddEmployee,
  onToggleActive,
  onUpdateAvailability,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterActiveOnly, setFilterActiveOnly] = useState(false);

  // Add Employee Form State
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('Frontline Clerk');
  const [newWage, setNewWage] = useState('');
  const [newDays, setNewDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Structured Separation Modal State
  const [separatingEmp, setSeparatingEmp] = useState<EmployeeRecord | null>(null);
  const addDialogRef = useRef<HTMLDivElement>(null);
  const separationDialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(addDialogRef, showAddModal, () => setShowAddModal(false));
  useDialogFocus(separationDialogRef, separatingEmp !== null, () => setSeparatingEmp(null));
  const [sepCategory, setSepCategory] = useState<SeparationCategory>('voluntary_resignation');
  const [sepReason, setSepReason] = useState('');
  const [recordedBy, setRecordedBy] = useState('');
  const sepFormValid = sepReason.trim() !== '' && recordedBy.trim() !== '';
  const newWageValue = parseWage(newWage);

  const displayedEmployees = filterActiveOnly
    ? employees.filter((e) => e.is_active)
    : employees;

  const handleToggleDay = (dayIdx: number) => {
    if (newDays.includes(dayIdx)) {
      if (newDays.length > 1) {
        setNewDays(newDays.filter((d) => d !== dayIdx));
      }
    } else {
      setNewDays([...newDays, dayIdx].sort((a, b) => a - b));
    }
  };

  const handleSubmitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newWageValue === null) return;
    onAddEmployee({
      name: newName.trim(),
      role: newRole.trim(),
      wage: newWageValue,
      days: newDays,
    });
    setNewName('');
    setShowAddModal(false);
  };

  const handleConfirmSeparation = () => {
    if (!separatingEmp || !sepFormValid) return;
    onToggleActive(separatingEmp.employee_id, {
      category: sepCategory,
      reason: sepReason,
      recorded_by: recordedBy,
    });
    setSeparatingEmp(null);
  };

  return (
    <div className="space-y-5 no-print">
      {/* Directory Action Header */}
      <div className="card p-5 bg-white flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
              Workforce Management
            </span>
          </div>
          <h2 className="text-base font-bold text-slate-900 mt-0.5">
            Staff Directory & Availability Matrix
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Manage which days each associate can work, and record separations with their
            documentation. Days marked unavailable are reported as conflicts on the schedule, not
            enforced as a hard constraint — review any conflict flagged on the Weekly Schedule tab.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => setFilterActiveOnly(!filterActiveOnly)}
            className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
              filterActiveOnly
                ? 'bg-[#2B3A42] text-[#FFFFFF] border-[#2B3A42]'
                : 'bg-[#FFFFFF] text-[#2B3A42] border-[#7F8A92] hover:bg-[#F4F1EA]'
            }`}
          >
            {filterActiveOnly ? 'Showing Active Only' : 'Showing All Staff'}
          </button>
          <button type="button"
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-[#2B3A42] hover:bg-[#1E2A31] text-[#FFFFFF] rounded-md text-xs font-bold shadow-[0_1px_2px_rgba(43,58,66,0.08)] flex items-center gap-1.5"
          >
            <span>+ Add Employee</span>
          </button>
        </div>
      </div>

      {/* Staff Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedEmployees.map((emp) => {
          const assignedLine = rosterLines.find(
            (l) => l.assigned_employee_id === emp.employee_id || l.line_number === emp.assigned_line_id
          );

          return (
            <div
              key={emp.employee_id}
              className={`card p-4 flex flex-col justify-between transition-all ${
                emp.is_active
                  ? 'bg-white border-[#7F8A92]'
                  : 'bg-slate-50 border-[#7F8A92] opacity-60'
              }`}
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">{emp.name}</h3>
                    <span className="text-xs text-slate-500">{emp.role}</span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        emp.is_active
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-red-50 text-[#9F3A32] border border-red-200'
                      }`}
                    >
                      {emp.is_active ? 'Active' : 'Separated'}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs font-mono-tabular">
                  <span className="text-slate-500">Hourly Wage:</span>
                  <span className="font-bold text-slate-900">${emp.hourly_wage.toFixed(2)}/hr</span>
                </div>

                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Current Assignment:</span>
                  <span className="font-semibold text-slate-800">
                    {assignedLine ? (
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white text-xs font-mono-tabular">
                        {assignedLine.cohort_id}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">Unassigned Pool</span>
                    )}
                  </span>
                </div>

                {/* Availability Days */}
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-700">
                      Available Days (Mon – Sun):
                    </span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {DAYS_OF_WEEK.map((d, dIdx) => {
                      const isAvail = emp.available_days.includes(dIdx);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={isAvail}
                          aria-label={DAY_FULL_NAMES[dIdx]}
                          onClick={() => {
                            if (!emp.is_active) return;
                            const nextDays = isAvail
                              ? emp.available_days.filter((x) => x !== dIdx)
                              : [...emp.available_days, dIdx].sort((a, b) => a - b);
                            if (nextDays.length > 0) {
                              onUpdateAvailability(emp.employee_id, nextDays);
                            }
                          }}
                          className={`py-1 text-xs font-mono-tabular font-bold rounded border ${
                            isAvail
                              ? 'bg-[#2B3A42] text-[#FFFFFF] border-[#2B3A42]'
                              : 'bg-slate-100 text-slate-600 border-slate-200 line-through'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-mono-tabular text-slate-400">{emp.employee_id}</span>
                {emp.is_active ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSeparatingEmp(emp);
                      setSepCategory('voluntary_resignation');
                      setSepReason('');
                      setRecordedBy('');
                    }}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-[#9F3A32] text-[#FFFFFF] hover:bg-[#862F28] border border-[#9F3A32] transition-colors"
                  >
                    Separate / Deactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onToggleActive(emp.employee_id)}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-[#FFFFFF] text-[#2B3A42] hover:bg-[#F4F1EA] border border-[#7F8A92] transition-colors"
                  >
                    Rehire Associate
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={addDialogRef} role="dialog" aria-modal="true" aria-labelledby="add-staff-title" className="bg-white border border-[#7F8A92] rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 id="add-staff-title" className="text-base font-bold text-slate-900">Add Staff Member</h3>
              <button type="button" aria-label="Close" onClick={() => setShowAddModal(false)} className="text-slate-400 font-bold">
                Cancel
              </button>
            </div>
            <form onSubmit={handleSubmitAdd} className="space-y-3.5">
              <div>
                <label htmlFor="staff-new-name" className="block text-xs font-semibold text-slate-700 mb-1">Full Name <span className="text-[#9F3A32]">Required</span></label>
                <input id="staff-new-name"
                  type="text"
                  required
                  placeholder="e.g., Alex Morgan"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="staff-new-role" className="block text-xs font-semibold text-slate-700 mb-1">Role / Position</label>
                  <input id="staff-new-role"
                    type="text"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="staff-new-wage" className="block text-xs font-semibold text-slate-700 mb-1">Wage ($/hr) <span className="text-[#9F3A32]">Required</span></label>
                  <input id="staff-new-wage"
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

              {/* No statutory-accommodation selector: the field it wrote to was never read by
                  the scheduling engine, so recording a Title VII or ADA accommodation here
                  changed nothing about the schedule while the compliance tab stayed green.
                  Record a protected day by marking it unavailable below. */}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Available Days (Mon – Sun)
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {DAYS_OF_WEEK.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={newDays.includes(i)}
                      aria-label={DAY_FULL_NAMES[i]}
                      onClick={() => handleToggleDay(i)}
                      className={`py-1.5 rounded text-xs font-mono-tabular font-bold border ${
                        newDays.includes(i)
                          ? 'bg-[#2B3A42] text-[#FFFFFF] border-[#2B3A42]'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-[#7F8A92] rounded-md text-xs font-semibold text-[#2B3A42] bg-[#FFFFFF] hover:bg-[#F4F1EA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newWageValue === null}
                  className="px-4 py-2 bg-[#4A6B5D] hover:bg-[#3E5C50] text-[#FFFFFF] rounded-md text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  Add staff member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Structured Legal Separation Modal (Retaliation Defense) */}
      {separatingEmp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div ref={separationDialogRef} role="dialog" aria-modal="true" aria-labelledby="separation-title" className="bg-white border border-[#7F8A92] rounded-lg max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
                  Contemporaneous HR Separation Audit
                </span>
                <h3 id="separation-title" className="text-base font-bold text-slate-900">
                  Deactivate / Separate: {separatingEmp.name}
                </h3>
              </div>
              <button type="button" aria-label="Close" onClick={() => setSeparatingEmp(null)} className="text-slate-400 font-bold">
                ✕
              </button>
            </div>

            {/* Legal Warning Notice */}
            <div className="p-3 bg-white border border-[#7F8A92] border-l-4 border-l-[#C28B47] rounded-lg text-xs text-[#2B3A42] space-y-1">
              <span className="font-bold flex items-center gap-1.5 text-[#2B3A42]">
                ⚠ Legal Compliance Notice (FLSA § 15(a)(3) & Title VII § 704(a))
              </span>
              <p className="text-xs leading-relaxed">
                Separating an employee in retaliation for wage complaints, injury reports, or statutory accommodation requests is strictly unlawful. This entry will be permanently logged in the SQLite audit ledger with a timestamp to establish contemporaneous evidence.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="staff-sep-category" className="block text-xs font-semibold text-slate-700 mb-1">
                  Separation Classification
                </label>
                <select id="staff-sep-category"
                  value={sepCategory}
                  onChange={(e) => setSepCategory(e.target.value as SeparationCategory)}
                  className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs bg-white"
                >
                  <option value="voluntary_resignation">Voluntary Resignation (Employee notice/departure)</option>
                  <option value="mutual_agreement">Mutual Separation (Agreed end of contract)</option>
                  <option value="involuntary_for_cause">Involuntary for Documented Cause (Policy violations)</option>
                  <option value="layoff_reduction">Workforce Reduction / Staff Downsizing</option>
                </select>
              </div>

              <div>
                <label htmlFor="staff-sep-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                  Contemporaneous Business Justification & Notes
                </label>
                <textarea id="staff-sep-reason"
                  rows={3}
                  value={sepReason}
                  onChange={(e) => setSepReason(e.target.value)}
                  placeholder="Document specific business rationale, prior warnings, or resignation details..."
                  className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
                />
              </div>

              <div>
                <label htmlFor="staff-sep-recorded-by" className="block text-xs font-semibold text-slate-700 mb-1">
                  Certifying Manager / Administrator
                </label>
                <input id="staff-sep-recorded-by"
                  type="text"
                  value={recordedBy}
                  onChange={(e) => setRecordedBy(e.target.value)}
                  className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSeparatingEmp(null)}
                className="px-4 py-2 border border-[#7F8A92] rounded-md text-xs font-semibold text-[#2B3A42] bg-[#FFFFFF] hover:bg-[#F4F1EA]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSeparation}
                disabled={!sepFormValid}
                className="px-4 py-2 bg-[#9F3A32] hover:bg-[#862F28] text-[#FFFFFF] rounded-md text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                Log Separation & Unbind Line
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
