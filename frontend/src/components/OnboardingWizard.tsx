import React, { useState } from 'react';
import {
  ArchetypePreset,
  ErgonomicGuardrails,
  ShiftTemplate,
} from '../types';
import { DAYS_OF_WEEK, interpolateBeckerTable7 } from '../services/api';
import { Button } from './ui/Button';
import { BardPanel } from './onboarding/BardPanel';
import { PRESET_LABELS, presetLabelFor } from './onboarding/presetLabels';

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
}

const STEP_LABELS = [
  { step: 1, title: 'Business type', subtitle: 'Start from a close match' },
  { step: 2, title: 'Staffing needs', subtitle: 'How many people, each hour' },
  { step: 3, title: 'Shift times', subtitle: 'When shifts start and end' },
  { step: 4, title: 'Scheduling rules', subtitle: 'Rest and fairness for staff' },
  { step: 5, title: 'Cost vs. fairness', subtitle: 'Choose your balance' },
];

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
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedDayTab, setSelectedDayTab] = useState<number>(0);

  if (!isOpen) return null;

  const updateDemandCell = (dayIdx: number, hourIdx: number, val: number) => {
    const clamped = Math.max(0, Math.min(40, val));
    const next = demandMatrix.map((row, r) =>
      r === dayIdx ? row.map((c, h) => (h === hourIdx ? clamped : c)) : [...row]
    );
    onChangeDemandMatrix(next);
  };

  const adjustDayWindowDemand = (startHr: number, endHr: number, delta: number) => {
    const next = demandMatrix.map((row) =>
      row.map((c, hr) =>
        hr >= startHr && hr < endHr ? Math.max(0, Math.min(40, c + delta)) : c
      )
    );
    onChangeDemandMatrix(next);
  };

  const updateTemplateField = <K extends keyof ShiftTemplate>(
    code: ShiftTemplate['code'],
    field: K,
    value: ShiftTemplate[K]
  ) => {
    const next = templates.map((t) => (t.code === code ? { ...t, [field]: value } : t));
    onChangeTemplates(next);
  };

  const updateGuardrailField = <K extends keyof ErgonomicGuardrails>(
    field: K,
    value: ErgonomicGuardrails[K]
  ) => {
    onChangeGuardrails({ ...guardrails, [field]: value });
  };

  const expectedErgoGain = interpolateBeckerTable7(leewayPct);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-5xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Wizard Top Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono-tabular font-semibold uppercase tracking-wider bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
                5 quick steps
              </span>
              <span className="text-xs text-slate-400">
                Tell us how your store runs. We'll build the schedule.
              </span>
            </div>
            <h2 className="text-lg font-bold tracking-tight mt-1">
              Set up your schedule
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
          >
            Skip setup ✕
          </button>
        </div>

        {/* 5-Step Progress Stepper */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-5 gap-2">
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
                    className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : isDone
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isDone ? '✓' : item.step}
                  </span>
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    {item.title}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 truncate mt-0.5 pl-6">
                  {item.subtitle}
                </p>
              </button>
            );
          })}
        </div>

        {/* Wizard Body Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* STEP 1: INDUSTRY ARCHETYPE SELECTION */}
          {currentStep === 1 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="space-y-4 flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Pick the closest match
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    We'll fill in typical hours, shift times and rules. You can change any of them in the next steps.
                  </p>
                </div>
                <div className="w-full sm:w-72">
                  <label
                    htmlFor="onboarding-facility-name"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1"
                  >
                    Store or unit name
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {archetypes.map((arch) => {
                  const isSelected = arch.id === selectedArchetypeId;
                  return (
                    <div
                      key={arch.id}
                      onClick={() => onSelectArchetype(arch)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-indigo-50/50 border-indigo-600 ring-2 ring-indigo-600/15'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">
                            {arch.sector}
                          </h4>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {presetLabelFor(arch.id, arch.sector)}
                          </p>
                        </div>
                        <span
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'border border-slate-300 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                        {PRESET_LABELS[arch.id]?.description ?? ''}
                      </p>
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                        <span>Hours: {arch.operating_hours_label}</span>
                        <span className="font-mono-tabular text-slate-700">
                          {arch.typical_crew_size}
                        </span>
                      </div>
                    </div>
                  );
                })}
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
                    Enter how many people you need working each hour, for each day of the week.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustDayWindowDemand(6, 14, 1)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    +1 person, 6am–2pm
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustDayWindowDemand(14, 22, 1)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    +1 person, 2pm–10pm
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustDayWindowDemand(0, 24, -1)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    −1 person, all hours
                  </button>
                </div>
              </div>

              {/* Day Filter Pills for Mobile/Compact Inspection + Full 7x24 Matrix */}
              <div className="flex items-center gap-1.5">
                {DAYS_OF_WEEK.map((day, dIdx) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDayTab(dIdx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      selectedDayTab === dIdx
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {day} ({demandMatrix[dIdx].reduce((a, b) => a + b, 0)} staff-hrs)
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
                        className="text-[10px] font-mono-tabular text-slate-500"
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
                        className="w-12 text-center font-mono-tabular font-bold text-xs text-slate-900 border border-slate-200 rounded py-1 my-1 focus:border-indigo-600 focus:outline-none"
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
                          className="block text-[11px] text-slate-500 font-medium mb-1"
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
                          className="block text-[11px] text-slate-500 font-medium mb-1"
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
                          className="block text-[11px] text-slate-500 font-medium mb-1"
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
                          className="block text-[11px] text-slate-500 font-medium mb-1"
                        >
                          Longest allowed (hours)
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
                      label: 'At least 16 hours between shifts',
                      desc: 'No closing shift followed directly by an opening shift.',
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
                        <span className="text-[11px] text-slate-500">
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
            <div className="space-y-4">
              <div className="pb-3 border-b border-slate-200">
                <h3 className="text-base font-bold text-slate-900">
                  Cost vs. fairness
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Allowing a little more cost can make schedules noticeably fairer for staff. Pick the balance that suits you.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Extra cost allowed
                    </span>
                    <div className="text-xl font-bold font-mono-tabular text-slate-900 mt-0.5">
                      +{leewayPct}% cost →{' '}
                      <span className="text-emerald-700">
                        +{expectedErgoGain}% staff comfort
                      </span>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
                    {leewayPct === 5
                      ? '★ Recommended'
                      : leewayPct === 10
                      ? 'No extra payroll'
                      : 'Custom balance'}
                  </span>
                </div>

                <input
                  type="range"
                  min={0}
                  max={75}
                  step={0.5}
                  value={leewayPct}
                  onChange={(e) => onChangeLeewayPct(parseFloat(e.target.value))}
                  className="w-full accent-indigo-600 cursor-pointer"
                />

                {/* Quick Preset Anchors from Becker (2026) Table 7 */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-2">
                  {[
                    { lw: 0, gain: '1.80%', tag: 'No extra cost' },
                    { lw: 1, gain: '8.37%', tag: '+1% cost' },
                    { lw: 5, gain: '27.34%', tag: '★ Recommended' },
                    { lw: 10, gain: '39.46%', tag: '+10% cost' },
                    { lw: 20, gain: '54.64%', tag: '+20% cost' },
                    { lw: 50, gain: '79.06%', tag: '+50% cost' },
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
                      <div className="text-[11px] font-bold">{pt.tag}</div>
                      <div
                        className={`text-xs font-mono-tabular mt-0.5 ${
                          Math.abs(leewayPct - pt.lw) < 0.1
                            ? 'text-indigo-100'
                            : 'text-emerald-700 font-semibold'
                        }`}
                      >
                        +{pt.gain} staff comfort
                      </div>
                    </button>
                  ))}
                </div>
              </div>
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
            {currentStep < 5 ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => setCurrentStep((s) => Math.min(5, s + 1))}
              >
                Next ({currentStep} of 5) →
              </Button>
            ) : (
              <Button
                variant="accent"
                onClick={onCompleteWizard}
              >
                <span>Create my schedule</span>
                <span>→</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
