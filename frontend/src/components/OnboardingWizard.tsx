import React, { useRef, useState } from 'react';
import {
  ArchetypePreset,
  EmployeeRecord,
  ErgonomicGuardrails,
  NewEmployeeInput,
  ShiftTemplate,
} from '../types';
import { DAYS_OF_WEEK } from '../services/api';
import { Button } from './ui/Button';
import { useDialogFocus } from './ui/useDialogFocus';
import { BardPanel } from './onboarding/BardPanel';
import { ExplainThis } from './onboarding/ExplainThis';
import { PRESET_LABELS, presetLabelFor, presetSolveBlocker } from './onboarding/presetLabels';
import { BusinessAnswers, BusyPeriod, WeekendPattern, buildDemandMatrix, buildShiftTemplates } from './onboarding/deriveSchedule';
import {
  FirstRunTour,
  clearTourDone,
  markTourDone,
  readTourDone,
} from './onboarding/FirstRunTour';

interface OnboardingWizardProps {
  isOpen: boolean;
  archetypes: ArchetypePreset[];
  selectedArchetypeId: string;
  facilityName: string;
  demandMatrix: number[][];
  templates: ShiftTemplate[];
  guardrails: ErgonomicGuardrails;
  leewayPct: number;
  onSelectArchetype: (preset: ArchetypePreset) => void;
  onChangeFacilityName: (name: string) => void;
  onChangeDemandMatrix: (matrix: number[][]) => void;
  onChangeTemplates: (templates: ShiftTemplate[]) => void;
  onChangeGuardrails: (guardrails: ErgonomicGuardrails) => void;
  onChangeLeewayPct: (leeway: number) => void;
  onCompleteWizard: () => void;
  onClose: () => void;
  employees: EmployeeRecord[];
  onAddEmployee: (emp: NewEmployeeInput) => void;
  /** False while there is no real staff yet: setup cannot be skipped or dismissed. */
  canSkip?: boolean;
  /** Explicitly finishes setup without any staff - planning a schedule's shape, not running one. */
  onPlanWithoutStaff?: () => void;
}

const STEP_LABELS = [
  { step: 1, title: 'Your business', subtitle: 'Hours, busy times, staffing' },
  { step: 2, title: 'Staffing needs', subtitle: 'How many people, each hour' },
  { step: 3, title: 'Shift times', subtitle: 'When shifts start and end' },
  { step: 4, title: 'Scheduling rules', subtitle: 'Rest and fairness for staff' },
  { step: 5, title: 'Cost vs. rest', subtitle: 'Pay more, strain less' },
  { step: 6, title: 'Add your staff', subtitle: 'Who actually works here' },
];

const WAGE_MIN = 7.25;
const WAGE_MAX = 100;
const parseWage = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= WAGE_MIN && n <= WAGE_MAX ? n : null;
};

const SHIFT_PLAIN_NAMES: Record<string, string> = {
  M: 'Morning',
  D: 'Midday',
  E: 'Evening',
  N: 'Night',
};

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  isOpen,
  archetypes,
  selectedArchetypeId,
  facilityName,
  demandMatrix,
  templates,
  guardrails,
  leewayPct,
  onSelectArchetype,
  onChangeFacilityName,
  onChangeDemandMatrix,
  onChangeTemplates,
  onChangeGuardrails,
  onChangeLeewayPct,
  onCompleteWizard,
  onClose,
  employees,
  onAddEmployee,
  canSkip = true,
  onPlanWithoutStaff,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedDayTab, setSelectedDayTab] = useState<number>(0);
  const [tourOpen, setTourOpen] = useState<boolean>(() => !readTourDone());
  const showTourAgainRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Same focus handling as every other dialog in the app: focus moves in on open,
  // Tab stays inside, and focus returns to the trigger on close. Two departures,
  // both deliberate:
  //  - Escape only closes while setup is skippable, matching App's own Escape guard,
  //    because setup with no staff yet cannot be dismissed.
  //  - The trap is suspended while the first-run tour is open, so the tour's own trap
  //    is the only one running and only one aria-modal element exists at a time.
  useDialogFocus(dialogRef, isOpen && !tourOpen, () => {
    if (canSkip) onClose();
  });

  const [showExamples, setShowExamples] = useState(false);
  // Set when the example just loaded is one the engine cannot schedule. Shown inside
  // the wizard, on the click, instead of surfacing six steps later as a page banner
  // the wizard's own overlay covers up.
  const [blockedPreset, setBlockedPreset] = useState<{
    id: string;
    label: string;
    message: string;
  } | null>(null);
  const [answers, setAnswers] = useState<BusinessAnswers>({
    openDays: [0, 1, 2, 3, 4, 5, 6],
    runs24Hours: false,
    openHour: 8,
    closeHour: 20,
    busyPeriod: 'midday',
    peakStaff: 4,
    minStaff: 1,
    weekendPattern: 'same',
  });

  const toggleOpenDay = (d: number) => {
    setAnswers((prev) => {
      if (prev.openDays.includes(d)) {
        if (prev.openDays.length <= 1) return prev;
        return { ...prev, openDays: prev.openDays.filter((x) => x !== d) };
      }
      return { ...prev, openDays: [...prev.openDays, d].sort() };
    });
  };

  const [rebuildArmed, setRebuildArmed] = useState(false);
  const [rebuildNotice, setRebuildNotice] = useState<string | null>(null);
  const seededRef = useRef(false);

  // Rebuilding throws away every hand-entered figure on steps 2 and 3, so it happens
  // only when asked for. This used to run on every change to any step-1 answer - and
  // once on mount, before the user had touched anything - which silently replaced a
  // hand-built staffing table, custom shift times, or a POS-derived matrix.
  const rebuildFromAnswers = () => {
    onChangeDemandMatrix(buildDemandMatrix(answers));
    onChangeTemplates(buildShiftTemplates(answers));
    setRebuildArmed(false);
    setRebuildNotice('Steps 2 and 3 were rebuilt from these answers.');
  };

  // Seed once, on first entry, and only while there is nothing to lose: an all-zero
  // staffing table. Anything already in it - a preset, a restored session, a POS
  // import, typed-in figures - is left alone.
  React.useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (demandMatrix.some((row) => row.some((cell) => cell !== 0))) return;
    onChangeDemandMatrix(buildDemandMatrix(answers));
    onChangeTemplates(buildShiftTemplates(answers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pending confirmation, and the note about the last rebuild, belong to the answers
  // they were made against. This effect only touches local UI state - unlike the one it
  // replaced, it can never discard the user's work.
  React.useEffect(() => {
    setRebuildArmed(false);
    setRebuildNotice(null);
  }, [answers]);

  const [staffName, setStaffName] = useState('');
  const [staffRole, setStaffRole] = useState('Frontline Associate');
  const [staffWage, setStaffWage] = useState('');
  const [staffDays, setStaffDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const staffWageValue = parseWage(staffWage);

  const toggleStaffDay = (d: number) => {
    if (staffDays.includes(d)) {
      if (staffDays.length > 1) setStaffDays(staffDays.filter((x) => x !== d));
    } else {
      setStaffDays([...staffDays, d].sort());
    }
  };

  const submitStaffMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffName.trim() || staffWageValue === null) return;
    onAddEmployee({ name: staffName.trim(), role: staffRole, wage: staffWageValue, days: staffDays });
    setStaffName('');
    setStaffWage('');
    setStaffDays([0, 1, 2, 3, 4, 5, 6]);
  };

  if (!isOpen) return null;

  const handleTourDone = () => {
    markTourDone();
    setTourOpen(false);
  };

  const handleShowTourAgain = () => {
    clearTourDone();
    setTourOpen(true);
  };

  const updateDemandCell = (dayIdx: number, hourIdx: number, val: number) => {
    const clamped = Math.max(0, Math.min(40, val));
    const next = demandMatrix.map((row, r) =>
      r === dayIdx ? row.map((c, h) => (h === hourIdx ? clamped : c)) : [...row]
    );
    onChangeDemandMatrix(next);
  };

  /** Adjusts only the currently selected day, matching the day tabs above it. */
  const adjustDayWindowDemand = (startHr: number, endHr: number, delta: number) => {
    const next = demandMatrix.map((row, dayIdx) =>
      dayIdx === selectedDayTab
        ? row.map((c, hr) => (hr >= startHr && hr < endHr ? Math.max(0, Math.min(40, c + delta)) : c))
        : row
    );
    onChangeDemandMatrix(next);
  };

  // Keeps min_duration <= preferred_duration <= max_duration true after every edit, so a
  // user's chosen shift length is never silently clamped by the solver without them knowing.
  const updateTemplateField = <K extends keyof ShiftTemplate>(
    code: ShiftTemplate['code'],
    field: K,
    value: ShiftTemplate[K]
  ) => {
    const next = templates.map((t) => {
      if (t.code !== code) return t;
      const updated = { ...t, [field]: value };
      if (field === 'preferred_duration') {
        const preferred = value as number;
        if (preferred > updated.max_duration) updated.max_duration = preferred;
        if (preferred < updated.min_duration) updated.min_duration = preferred;
      } else if (field === 'max_duration' && (value as number) < updated.preferred_duration) {
        updated.preferred_duration = value as number;
      } else if (field === 'min_duration' && (value as number) > updated.preferred_duration) {
        updated.preferred_duration = value as number;
      }
      return updated;
    });
    onChangeTemplates(next);
  };

  const updateGuardrailField = <K extends keyof ErgonomicGuardrails>(
    field: K,
    value: ErgonomicGuardrails[K]
  ) => {
    onChangeGuardrails({ ...guardrails, [field]: value });
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={tourOpen ? undefined : true}
      aria-labelledby="onboarding-wizard-title"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-[min(96vw,1600px)] w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Wizard Top Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-mono-tabular font-semibold uppercase tracking-wider bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                6 quick steps
              </span>
              <span className="text-xs text-slate-400">
                Tell us how your store runs. We'll build the schedule.
              </span>
            </div>
            <h2 id="onboarding-wizard-title" className="text-lg font-bold tracking-tight mt-1">
              Set up your schedule
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              ref={showTourAgainRef}
              onClick={handleShowTourAgain}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
            >
              Show the tour again
            </button>
            {canSkip && (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
              >
                Skip setup for now
              </button>
            )}
          </div>
        </div>

        {/* 5-Step Progress Stepper */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-3">
          {STEP_LABELS.map((item) => {
            const isCurrent = currentStep === item.step;
            const isDone = currentStep > item.step;
            return (
              <button
                key={item.step}
                type="button"
                onClick={() => setCurrentStep(item.step)}
                className={`text-left p-2 rounded-lg border transition-all ${
                  isCurrent
                    ? 'bg-white border-indigo-600 shadow-xs'
                    : isDone
                    ? 'bg-slate-100/80 border-slate-200 hover:bg-white'
                    : 'bg-transparent border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-5 h-5 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : isDone
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isDone ? '✓' : item.step}
                  </span>
                  <span className="text-xs font-semibold text-slate-900">
                    {item.title}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 pl-6">
                  {item.subtitle}
                </p>
              </button>
            );
          })}
        </div>

        {/* Wizard Body Content */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0 space-y-5">
          <ExplainThis stepId={currentStep} />
          {/* STEP 1: PLAIN QUESTIONS ABOUT THE BUSINESS, NOT A STEREOTYPE PICKER */}
          {currentStep === 1 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Tell us about your business
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Every business is different, so answer for yours — the schedule is built from your
                    answers, not from a label like "retail" or "healthcare."
                  </p>
                </div>
                <div className="w-full sm:w-72">
                  <label
                    htmlFor="onboarding-facility-name"
                    className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1"
                  >
                    Business or location name
                  </label>
                  <input
                    id="onboarding-facility-name"
                    type="text"
                    value={facilityName}
                    onChange={(e) => onChangeFacilityName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:border-indigo-600 focus:outline-none font-medium text-slate-900"
                    placeholder="e.g., Main Street Store"
                  />
                </div>
              </div>

              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Which days are you open?
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_OF_WEEK.map((d, idx) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={answers.openDays.includes(idx)}
                        onClick={() => toggleOpenDay(idx)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          answers.openDays.includes(idx)
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    <input
                      type="checkbox"
                      checked={answers.runs24Hours}
                      onChange={(e) => setAnswers((p) => ({ ...p, runs24Hours: e.target.checked }))}
                      className="rounded"
                    />
                    Open around the clock (24 hours)
                  </label>
                  {!answers.runs24Hours && (
                    <div className="flex items-center gap-3 mt-1">
                      <div>
                        <label htmlFor="onboarding-opens-at" className="block text-xs text-slate-500 mb-1">Opens at</label>
                        <input
                          id="onboarding-opens-at"
                          type="number"
                          min={0}
                          max={23}
                          value={answers.openHour}
                          onChange={(e) => setAnswers((p) => ({ ...p, openHour: Math.max(0, Math.min(23, parseInt(e.target.value || '0', 10))) }))}
                          className="w-20 text-center font-mono-tabular text-sm border border-slate-300 rounded py-1"
                        />
                        <span className="text-xs text-slate-400 ml-1">:00</span>
                      </div>
                      <div>
                        <label htmlFor="onboarding-closes-at" className="block text-xs text-slate-500 mb-1">Closes at</label>
                        <input
                          id="onboarding-closes-at"
                          type="number"
                          min={1}
                          max={24}
                          value={answers.closeHour}
                          onChange={(e) => setAnswers((p) => ({ ...p, closeHour: Math.max(1, Math.min(24, parseInt(e.target.value || '0', 10))) }))}
                          className="w-20 text-center font-mono-tabular text-sm border border-slate-300 rounded py-1"
                        />
                        <span className="text-xs text-slate-400 ml-1">:00 (24 = midnight)</span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="busy-period" className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    When are you busiest?
                  </label>
                  <select
                    id="busy-period"
                    value={answers.busyPeriod}
                    onChange={(e) => setAnswers((p) => ({ ...p, busyPeriod: e.target.value as BusyPeriod }))}
                    className="w-full sm:w-64 text-sm border border-slate-300 rounded-lg py-1.5 px-2"
                  >
                    <option value="morning">Morning</option>
                    <option value="midday">Midday</option>
                    <option value="evening">Evening</option>
                    <option value="night">Late night</option>
                    <option value="steady">About the same all day</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4 max-w-md">
                  <div>
                    <label htmlFor="onboarding-peak-staff" className="block text-xs text-slate-500 mb-1">
                      People needed at your busiest
                    </label>
                    <input
                      id="onboarding-peak-staff"
                      type="number"
                      min={1}
                      max={100}
                      value={answers.peakStaff}
                      onChange={(e) => setAnswers((p) => ({ ...p, peakStaff: Math.max(1, parseInt(e.target.value || '1', 10)) }))}
                      className="w-full text-center font-mono-tabular text-sm border border-slate-300 rounded py-1.5"
                    />
                  </div>
                  <div>
                    <label htmlFor="onboarding-min-staff" className="block text-xs text-slate-500 mb-1">
                      People needed at your quietest (while open)
                    </label>
                    <input
                      id="onboarding-min-staff"
                      type="number"
                      min={0}
                      max={100}
                      value={answers.minStaff}
                      onChange={(e) => setAnswers((p) => ({ ...p, minStaff: Math.max(0, parseInt(e.target.value || '0', 10)) }))}
                      className="w-full text-center font-mono-tabular text-sm border border-slate-300 rounded py-1.5"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="weekend-pattern" className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                    Weekends, compared to weekdays
                  </label>
                  <select
                    id="weekend-pattern"
                    value={answers.weekendPattern}
                    onChange={(e) => setAnswers((p) => ({ ...p, weekendPattern: e.target.value as WeekendPattern }))}
                    className="w-full sm:w-64 text-sm border border-slate-300 rounded-lg py-1.5 px-2"
                  >
                    <option value="busier">Busier</option>
                    <option value="same">About the same</option>
                    <option value="quieter">Quieter</option>
                  </select>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                  Build steps 2 and 3 from these answers
                </h4>
                <p className="text-xs text-amber-900">
                  These answers are a starting point, not the schedule. Use this when you
                  want them turned into the staffing table on step 2 and the shift times on
                  step 3. Anything you have already entered on those two steps by hand will
                  be replaced.
                </p>
                {rebuildArmed ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-amber-900">
                      Replace everything on steps 2 and 3?
                    </span>
                    <Button variant="secondary" onClick={rebuildFromAnswers}>
                      Yes, replace it
                    </Button>
                    <Button variant="secondary" onClick={() => setRebuildArmed(false)}>
                      Keep what I have
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setRebuildArmed(true)}>
                    Rebuild my staffing table from these answers
                  </Button>
                )}
                {rebuildNotice && (
                  <p role="status" className="text-xs font-semibold text-amber-900">
                    {rebuildNotice}
                  </p>
                )}
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowExamples((v) => !v)}
                  className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
                >
                  {showExamples ? 'Hide examples' : "Not sure where to start? Load an example you can edit"}
                </button>
                {blockedPreset && (
                  <div
                    id="onboarding-preset-solve-warning"
                    role="alert"
                    className="mt-3 rounded-xl border border-[#9F3A32] bg-white p-3 text-xs text-[#9F3A32]"
                  >
                    <p className="font-bold">
                      {blockedPreset.label} does not build a schedule on its own yet.
                    </p>
                    <p className="mt-1 text-slate-700">{blockedPreset.message}</p>
                    <p className="mt-1 text-slate-700">
                      Its hours and staffing numbers are loaded, so you can keep going — but add a
                      shift or ease a rest rule before you finish, or the schedule will come back
                      empty.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setBlockedPreset(null);
                          setCurrentStep(3);
                        }}
                      >
                        Add a shift (step 3)
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setBlockedPreset(null);
                          setCurrentStep(4);
                        }}
                      >
                        Ease a rest rule (step 4)
                      </Button>
                      <button
                        type="button"
                        onClick={() => setBlockedPreset(null)}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-[#9F3A32] hover:bg-[#F4F1EA]"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                {showExamples && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    {archetypes.map((arch) => {
                      const isSelected = arch.id === selectedArchetypeId;
                      const blocker = presetSolveBlocker(arch.id);
                      return (
                        <button
                          key={arch.id}
                          type="button"
                          aria-pressed={isSelected}
                          aria-describedby={
                            blockedPreset?.id === arch.id
                              ? 'onboarding-preset-solve-warning'
                              : undefined
                          }
                          onClick={() => {
                            onSelectArchetype(arch);
                            setBlockedPreset(
                              blocker
                                ? {
                                    id: arch.id,
                                    label: presetLabelFor(arch.id, arch.sector),
                                    message: blocker.message,
                                  }
                                : null
                            );
                          }}
                          className={`w-full text-left p-3 rounded-xl border cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-indigo-50/50 border-indigo-600 ring-2 ring-indigo-600/15'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <span className="block text-sm font-bold text-slate-900">{arch.sector}</span>
                          <span className="block text-xs text-slate-500 mt-0.5">
                            {presetLabelFor(arch.id, arch.sector)}
                          </span>
                          {blocker && (
                            <span className="mt-1 inline-block rounded border border-[#9F3A32] px-1.5 py-0.5 text-xs font-bold text-[#9F3A32]">
                              {blocker.badge}
                            </span>
                          )}
                          <span className="block text-xs text-slate-600 mt-2 leading-relaxed">
                            {PRESET_LABELS[arch.id]?.description ?? ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <BardPanel stepId={1} className="w-full lg:w-72 shrink-0" />
            </div>
          )}

          {/* STEP 2: OPERATING SCHEDULE & 24-HOUR DAILY DEMAND MATRIX */}
          {currentStep === 2 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    How many people you need
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Fill in the number of people needed for each hour of each day, using the boxes below.
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Enter how many people you need working each hour, for each day of the week.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustDayWindowDemand(6, 14, 1)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    +1 person, 6am–2pm, {DAYS_OF_WEEK[selectedDayTab]} only
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustDayWindowDemand(14, 22, 1)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    +1 person, 2pm–10pm, {DAYS_OF_WEEK[selectedDayTab]} only
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustDayWindowDemand(0, 24, -1)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    −1 person, all hours, {DAYS_OF_WEEK[selectedDayTab]} only
                  </button>
                </div>
              </div>

              {/* Day Filter Pills for Mobile/Compact Inspection + Full 7x24 Matrix */}
              <div className="flex flex-wrap items-center gap-1.5">
                {DAYS_OF_WEEK.map((day, dIdx) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selectedDayTab === dIdx}
                    onClick={() => setSelectedDayTab(dIdx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedDayTab === dIdx
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {day} ({demandMatrix[dIdx].reduce((a, b) => a + b, 0)} staff-hrs)
                    {selectedDayTab === dIdx && <span className="ml-1">Selected</span>}
                  </button>
                ))}
              </div>

              {/* Selected Day 24-Hour Interactive Editor */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    {DAYS_OF_WEEK[selectedDayTab]} — people needed each hour
                  </span>
                  <span className="text-xs text-slate-500 font-mono-tabular">
                    Total for the week:{' '}
                    <strong className="text-slate-900">
                      {demandMatrix.reduce(
                        (acc, r) => acc + r.reduce((a, b) => a + b, 0),
                        0
                      )}{' '}
                      person-hours
                    </strong>
                  </span>
                </div>
                <p className="text-xs text-slate-600 mb-3">
                  Tab moves between hours. Type the number of people needed.
                </p>
                <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-2">
                  {demandMatrix[selectedDayTab].map((val, hr) => (
                    <div
                      key={hr}
                      className="p-2 rounded-lg bg-white border border-slate-200 flex flex-col items-center"
                    >
                      <label
                        htmlFor={`demand-hour-${selectedDayTab}-${hr}`}
                        className="text-xs font-mono-tabular text-slate-500"
                      >
                        Hour {String(hr).padStart(2, '0')}:00
                      </label>
                      <input
                        id={`demand-hour-${selectedDayTab}-${hr}`}
                        type="number"
                        min={0}
                        max={40}
                        value={val}
                        onChange={(e) =>
                          updateDemandCell(
                            selectedDayTab,
                            hr,
                            parseInt(e.target.value || '0', 10)
                          )
                        }
                        className="w-full sm:w-12 text-center font-mono-tabular font-bold text-xs text-slate-900 border border-slate-200 rounded py-1 my-1 focus:border-indigo-600 focus:outline-none"
                      />
                      <span className="text-[9px] text-slate-400">
                        {hr < 6 ? 'Night' : hr < 14 ? 'Morn' : hr < 22 ? 'Eve' : 'Night'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <BardPanel stepId={2} className="w-full lg:w-72 shrink-0" />
            </div>
          )}

          {/* STEP 3: SHIFT DESIGN TEMPLATES */}
          {currentStep === 3 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="pb-3 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">
                  Shift times
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Fill in the start hour and length for each shift your store runs, and untick any shift it does not use.
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Set when each shift starts and how long it runs. Morning (M), Midday (D), Evening (E) and Night (N).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {templates.map((tpl) => (
                  <div
                    key={tpl.code}
                    className={`p-4 rounded-xl border ${
                      tpl.enabled
                        ? 'bg-white border-slate-200 shadow-xs'
                        : 'bg-slate-50 border-slate-200 opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {SHIFT_PLAIN_NAMES[tpl.code] ? `${SHIFT_PLAIN_NAMES[tpl.code]} shift` : 'Shift'}
                        </span>
                        <span
                          className={`shift-pill-${tpl.code} px-2.5 py-0.5 rounded-md text-xs font-bold font-mono-tabular`}
                        >
                          {tpl.code}
                        </span>
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tpl.enabled}
                          onChange={(e) =>
                            updateTemplateField(tpl.code, 'enabled', e.target.checked)
                          }
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Active</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <label
                          htmlFor={`shift-${tpl.code}-preferred-start`}
                          className="block text-xs text-slate-500 font-medium mb-1"
                        >
                          Usual start (hour, 0–23)
                        </label>
                        <input
                          id={`shift-${tpl.code}-preferred-start`}
                          type="number"
                          min={0}
                          max={23}
                          disabled={!tpl.enabled}
                          value={tpl.preferred_start}
                          onChange={(e) =>
                            updateTemplateField(
                              tpl.code,
                              'preferred_start',
                              Math.max(0, Math.min(23, parseInt(e.target.value || '0', 10)))
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono-tabular text-slate-900"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`shift-${tpl.code}-preferred-duration`}
                          className="block text-xs text-slate-500 font-medium mb-1"
                        >
                          Usual length (hours)
                        </label>
                        <input
                          id={`shift-${tpl.code}-preferred-duration`}
                          type="number"
                          min={6}
                          max={12}
                          disabled={!tpl.enabled}
                          value={tpl.preferred_duration}
                          onChange={(e) =>
                            updateTemplateField(
                              tpl.code,
                              'preferred_duration',
                              Math.max(6, Math.min(12, parseInt(e.target.value || '8', 10)))
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono-tabular text-slate-900"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`shift-${tpl.code}-earliest-start`}
                          className="block text-xs text-slate-500 font-medium mb-1"
                        >
                          Earliest allowed start
                        </label>
                        <input
                          id={`shift-${tpl.code}-earliest-start`}
                          type="number"
                          min={0}
                          max={23}
                          disabled={!tpl.enabled}
                          value={tpl.earliest_start}
                          onChange={(e) =>
                            updateTemplateField(
                              tpl.code,
                              'earliest_start',
                              Math.max(0, Math.min(23, parseInt(e.target.value || '0', 10)))
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-mono-tabular text-slate-700"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`shift-${tpl.code}-max-duration`}
                          className="block text-xs text-slate-500 font-medium mb-1"
                        >
                          Longest shift the solver may use (hours)
                        </label>
                        <input
                          id={`shift-${tpl.code}-max-duration`}
                          type="number"
                          min={7}
                          max={12}
                          disabled={!tpl.enabled}
                          value={tpl.max_duration}
                          onChange={(e) =>
                            updateTemplateField(
                              tpl.code,
                              'max_duration',
                              Math.max(7, Math.min(12, parseInt(e.target.value || '9', 10)))
                            )
                          }
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 font-mono-tabular text-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <BardPanel stepId={3} className="w-full lg:w-72 shrink-0" />
            </div>
          )}

          {/* STEP 4: ERGONOMIC GUARDRAIL POLICIES */}
          {currentStep === 4 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="pb-3 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">
                  Scheduling rules
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Fill in the limits for work stretches and nights or evenings in a row, and check the rest rules you want.
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Set limits that protect staff health and give everyone fair rest. Defaults are a good starting point.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    How long stretches can run
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label htmlFor="rule-min-work-days" className="block text-slate-600 mb-1 font-medium">
                        Min Work Stretch (days)
                      </label>
                      <input
                        id="rule-min-work-days"
                        type="number"
                        min={2}
                        max={5}
                        value={guardrails.min_consecutive_work_days}
                        onChange={(e) =>
                          updateGuardrailField(
                            'min_consecutive_work_days',
                            parseInt(e.target.value || '3', 10)
                          )
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label htmlFor="rule-max-work-days" className="block text-slate-600 mb-1 font-medium">
                        Max Work Stretch (days)
                      </label>
                      <input
                        id="rule-max-work-days"
                        type="number"
                        min={3}
                        max={7}
                        value={guardrails.max_consecutive_work_days}
                        onChange={(e) =>
                          updateGuardrailField(
                            'max_consecutive_work_days',
                            parseInt(e.target.value || '5', 10)
                          )
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label htmlFor="rule-max-nights" className="block text-slate-600 mb-1 font-medium">
                        Max nights in a row
                      </label>
                      <input
                        id="rule-max-nights"
                        type="number"
                        min={1}
                        max={4}
                        value={guardrails.max_consecutive_nights}
                        onChange={(e) =>
                          updateGuardrailField(
                            'max_consecutive_nights',
                            parseInt(e.target.value || '2', 10)
                          )
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label htmlFor="rule-max-evenings" className="block text-slate-600 mb-1 font-medium">
                        Max evenings in a row
                      </label>
                      <input
                        id="rule-max-evenings"
                        type="number"
                        min={1}
                        max={5}
                        value={guardrails.max_consecutive_evenings}
                        onChange={(e) =>
                          updateGuardrailField(
                            'max_consecutive_evenings',
                            parseInt(e.target.value || '3', 10)
                          )
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-mono-tabular"
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Rest and recovery rules
                  </h4>
                  {[
                    {
                      field: 'enforce_forward_rotation' as const,
                      label: 'Shifts move forward through the day',
                      desc: 'Morning, then midday, then evening, then night. Never backwards.',
                    },
                    {
                      field: 'enforce_zero_clopening' as const,
                      label: 'No closing shift followed by an opening shift the next day',
                      desc: 'The solver checks this one rule. It does not check other rest periods.',
                    },
                    {
                      field: 'avoid_single_rest_days' as const,
                      label: 'Days off come in pairs',
                      desc: 'Avoids lone days off between work days.',
                    },
                    {
                      field: 'avoid_single_night_shifts' as const,
                      label: 'No lone night shifts',
                      desc: 'Avoids a single night shift on its own.',
                    },
                    {
                      field: 'prioritize_free_weekends' as const,
                      label: 'Full weekends off when possible',
                      desc: 'Gives staff Saturday and Sunday off together.',
                    },
                  ].map((item) => (
                    <label
                      key={item.field}
                      className="flex items-start gap-2.5 p-2 rounded-lg bg-white border border-slate-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={guardrails[item.field]}
                        onChange={(e) =>
                          updateGuardrailField(item.field, e.target.checked)
                        }
                        className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <span className="text-xs font-semibold text-slate-900 block">
                          {item.label}
                        </span>
                        <span className="text-xs text-slate-500">
                          {item.desc}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <BardPanel stepId={4} className="w-full lg:w-72 shrink-0" />
            </div>
          )}

          {/* STEP 5: PARETO FRONTIER CALIBRATION */}
          {currentStep === 5 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="pb-3 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">
                  How much staffing flexibility will you allow?
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  The leanest possible schedule packs the work into as few shifts as it can, which
                  means more back-to-back closing-then-opening shifts, longer stretches without a day
                  off, and fewer full weekends off. Allowing more flexibility lets the schedule
                  spread the same work over more shifts and avoid those.
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  More flexibility is not the same as more money, and not the same as better
                  coverage. Pick a starting point below — once setup is done, the Cost vs. Rest
                  Trade-off tab shows each option's own weekly payroll, uncovered hours and workload
                  score, and those can move either way.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label
                      htmlFor="leeway-range"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-500"
                    >
                      Staffing flexibility you'll allow
                    </label>
                    <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-0.5">
                      +{leewayPct}% flexibility
                    </div>
                  </div>
                </div>

                <input
                  id="leeway-range"
                  type="range"
                  min={0}
                  max={75}
                  step={0.5}
                  value={leewayPct}
                  onChange={(e) => onChangeLeewayPct(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2">
                  {[
                    { lw: 0, tag: 'No extra flexibility' },
                    { lw: 1, tag: '+1% flexibility' },
                    { lw: 5, tag: '+5% flexibility' },
                    { lw: 10, tag: '+10% flexibility' },
                    { lw: 20, tag: '+20% flexibility' },
                    { lw: 50, tag: '+50% flexibility' },
                  ].map((pt) => (
                    <button
                      key={pt.lw}
                      type="button"
                      onClick={() => onChangeLeewayPct(pt.lw)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        Math.abs(leewayPct - pt.lw) < 0.1
                          ? 'bg-indigo-600 text-white border-indigo-700 shadow-xs'
                          : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="text-xs font-bold">{pt.tag}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <BardPanel stepId={5} className="w-full lg:w-72 shrink-0" />
            </div>
          )}

          {/* STEP 6: ADD STAFF */}
          {currentStep === 6 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
              <div className="space-y-4 flex-1 min-w-0">
                <div className="pb-3 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900">Who actually works here?</h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    The schedule above is just a shape until real people are assigned to it. Add at
                    least one staff member to finish setup — you can add the rest anytime from the
                    Staff Directory.
                  </p>
                </div>

                <form onSubmit={submitStaffMember} className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="onboarding-staff-name" className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
                      <input
                        id="onboarding-staff-name"
                        value={staffName}
                        onChange={(e) => setStaffName(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="onboarding-staff-role" className="block text-xs font-semibold text-slate-600 mb-1">Role</label>
                      <input
                        id="onboarding-staff-role"
                        value={staffRole}
                        onChange={(e) => setStaffRole(e.target.value)}
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="onboarding-staff-wage" className="block text-xs font-semibold text-slate-600 mb-1">Hourly wage ($)</label>
                      <input
                        id="onboarding-staff-wage"
                        value={staffWage}
                        onChange={(e) => setStaffWage(e.target.value)}
                        placeholder="e.g. 17.50"
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Available days</label>
                    <div className="flex flex-wrap gap-1.5">
                      {DAYS_OF_WEEK.map((d, idx) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleStaffDay(idx)}
                          className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                            staffDays.includes(idx)
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-300'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={!staffName.trim() || staffWageValue === null}
                  >
                    + Add this person
                  </Button>
                </form>

                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Staff added so far ({employees.length})
                  </h4>
                  {employees.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Nobody yet — add at least one person above.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {employees.map((e) => (
                        <li
                          key={e.employee_id}
                          className="flex items-center justify-between px-3 py-2 rounded-md bg-white border border-slate-200 text-sm"
                        >
                          <span className="font-semibold text-slate-900">{e.name}</span>
                          <span className="text-slate-500 text-xs">
                            {e.role} · ${e.hourly_wage.toFixed(2)}/hr
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <BardPanel stepId={6} className="w-full lg:w-72 shrink-0" />
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <Button
            variant="secondary"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
          >
            ← Back
          </Button>

          <div className="flex items-center gap-2.5">
            {currentStep < 6 ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setCurrentStep((s) => Math.min(6, s + 1))}
              >
                Next: {STEP_LABELS[currentStep].title} →
              </Button>
            ) : (
              <>
                {employees.length === 0 && onPlanWithoutStaff && (
                  <Button variant="secondary" onClick={onPlanWithoutStaff}>
                    I'm just planning — no real staff yet
                  </Button>
                )}
                <Button
                  variant="accent"
                  disabled={employees.length === 0}
                  title={employees.length === 0 ? 'Add at least one staff member, or choose "just planning"' : undefined}
                  onClick={onCompleteWizard}
                >
                  <span>Finish setup</span>
                  <span>→</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* While this is up it is the one aria-modal dialog on the page: the wizard
          drops its own aria-modal above, so assistive tech is never told that two
          nested dialogs are both the only thing on screen. */}
      {tourOpen && (
        <FirstRunTour onDone={handleTourDone} returnFocusTo={showTourAgainRef} />
      )}
    </div>
  );
};
