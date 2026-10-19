import React, { useState, useEffect, useCallback } from 'react';
import {
  ActiveTabId,
  ArchetypePreset,
  EmployeeRecord,
  ErgonomicGuardrails,
  ShiftTemplate,
  SolveResponse,
  StaffMemberAssignment,
} from './types';
import {
  fetchArchetypes,
  solveScheduleApi,
  exportRosterToCsvString,
  DEFAULT_TEMPLATES,
  DEFAULT_GUARDRAILS,
  DEFAULT_DEMAND_MATRIX,
  INITIAL_STORE_EMPLOYEES,
} from './services/api';

import { Header } from './components/Header';
import { OnboardingWizard } from './components/OnboardingWizard';
import { MasterRosterView } from './components/MasterRosterView';
import { StaffDirectoryView } from './components/StaffDirectoryView';
import { LaborAnalysisView } from './components/LaborAnalysisView';
import { POSIntegrationView } from './components/POSIntegrationView';
import { CoverageHeatmapView } from './components/CoverageHeatmapView';
import { ParetoExplorerView } from './components/ParetoExplorerView';
import { ErgonomicsAuditView } from './components/ErgonomicsAuditView';
import { CFODashboardView } from './components/CFODashboardView';
import { DOLComplianceView } from './components/DOLComplianceView';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';

export function App() {
  const [archetypes, setArchetypes] = useState<ArchetypePreset[]>([]);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string>('downtown_foodmart_omaha');
  const [facilityName, setFacilityName] = useState<string>('Downtown Foodmart — 16th & Farnam (Omaha, NE)');
  const [demandMatrix, setDemandMatrix] = useState<number[][]>(DEFAULT_DEMAND_MATRIX);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(DEFAULT_TEMPLATES);
  const [guardrails, setGuardrails] = useState<ErgonomicGuardrails>(DEFAULT_GUARDRAILS);
  const [leewayPct, setLeewayPct] = useState<number>(10.0);
  const [rotationWeekOffset, setRotationWeekOffset] = useState<number>(0);

  const [staffAssignments, setStaffAssignments] = useState<StaffMemberAssignment[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>(INITIAL_STORE_EMPLOYEES);

  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [isCalloutOpen, setIsCalloutOpen] = useState<boolean>(false);
  const [isSwapOpen, setIsSwapOpen] = useState<boolean>(false);
  const [isAddEmpOpen, setIsAddEmpOpen] = useState<boolean>(false);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ActiveTabId>('roster');
  const [solution, setSolution] = useState<SolveResponse | null>(null);

  useEffect(() => {
    fetchArchetypes().then((list) => {
      if (list && list.length > 0) setArchetypes(list);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    solveScheduleApi({
      archetype_id: selectedArchetypeId,
      facility_name: facilityName,
      demand_matrix: demandMatrix,
      templates,
      guardrails,
      pareto_leeway_pct: leewayPct,
      rotation_week_offset: rotationWeekOffset,
      staff_assignments: staffAssignments,
      employees: employees,
    }).then((res) => {
      if (isMounted) setSolution(res);
    });
    return () => {
      isMounted = false;
    };
  }, [
    selectedArchetypeId,
    facilityName,
    demandMatrix,
    templates,
    guardrails,
    leewayPct,
    rotationWeekOffset,
    staffAssignments,
    employees,
  ]);

  const advanceWeek = useCallback((delta: number) => {
    if (!solution || solution.employee_count === 0) return;
    setRotationWeekOffset(
      (prev) => (((prev + delta) % solution.employee_count) + solution.employee_count) % solution.employee_count
    );
  }, [solution]);

  // Global Keyboard Navigation Engine (Hands-on-keyboard retail backroom drivability)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) {
        if (e.key === 'Escape') {
          setIsShortcutsOpen(false);
          setIsCalloutOpen(false);
          setIsSwapOpen(false);
          setIsAddEmpOpen(false);
          setIsWizardOpen(false);
        }
        return;
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsShortcutsOpen(false);
        setIsCalloutOpen(false);
        setIsSwapOpen(false);
        setIsAddEmpOpen(false);
        setIsWizardOpen(false);
      } else if (e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        advanceWeek(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        advanceWeek(-1);
      } else if (e.key === '1') {
        setActiveTab('roster');
      } else if (e.key === '2') {
        setActiveTab('labor');
      } else if (e.key === '3') {
        setActiveTab('cfo');
      } else if (e.key === '4') {
        setActiveTab('coverage');
      } else if (e.key === '5') {
        setActiveTab('pareto');
      } else if (e.key === '6') {
        setActiveTab('ergonomics');
      } else if (e.key === '7') {
        setActiveTab('compliance');
      } else if (e.key.toLowerCase() === 'c') {
        setActiveTab('roster');
        setIsCalloutOpen(true);
      } else if (e.key.toLowerCase() === 's') {
        setActiveTab('roster');
        setIsSwapOpen(true);
      } else if (e.key.toLowerCase() === 'd') {
        setIsDirectoryOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === 'a') {
        setActiveTab('roster');
        setIsAddEmpOpen(true);
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        window.print();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advanceWeek]);

  const handleSelectArchetype = (preset: ArchetypePreset) => {
    setSelectedArchetypeId(preset.id);
    setFacilityName(preset.name);
    setDemandMatrix(preset.demand_matrix.map((r) => [...r]));
    setTemplates(preset.templates.map((t) => ({ ...t })));
    setGuardrails({ ...preset.guardrails });
    setLeewayPct(preset.default_leeway_pct);
    setRotationWeekOffset(0);
    setStaffAssignments([]);
  };

  const handleAddEmployee = (newEmpData: {
    name: string;
    role: string;
    wage: number;
    days: number[];
  }) => {
    const newId = `EMP-${String(employees.length + 1).padStart(2, '0')}`;
    const newEmp: EmployeeRecord = {
      employee_id: newId,
      name: newEmpData.name,
      role: newEmpData.role,
      hourly_wage: newEmpData.wage,
      max_weekly_hours: 40,
      is_active: true,
      available_days: newEmpData.days,
      preferred_shifts: ['M', 'D', 'E'],
      assigned_line_id: null,
    };
    setEmployees((prev) => [...prev, newEmp]);
  };

  const handleToggleEmployeeStatus = (empId: string) => {
    setEmployees((prev) =>
      prev.map((e) => {
        if (e.employee_id === empId) {
          const updatedActive = !e.is_active;
          return {
            ...e,
            is_active: updatedActive,
            assigned_line_id: updatedActive ? e.assigned_line_id : null,
          };
        }
        return e;
      })
    );
  };

  const handleUpdateEmployee = (updated: EmployeeRecord) => {
    setEmployees((prev) =>
      prev.map((e) => (e.employee_id === updated.employee_id ? updated : e))
    );
  };

  const handleUpdateAvailability = (empId: string, days: number[]) => {
    setEmployees((prev) =>
      prev.map((e) => (e.employee_id === empId ? { ...e, available_days: days } : e))
    );
  };

  const handleExportCsv = () => {
    if (!solution) return;
    const csvData = exportRosterToCsvString(solution, rotationWeekOffset);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `shiftflow_roster_${solution.archetype_id}_offset_${rotationWeekOffset}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenWizard={() => setIsWizardOpen(true)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        solution={solution}
        leewayPct={leewayPct}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {solution ? (
          <>
            {activeTab === 'roster' && (
              <MasterRosterView
                solution={solution}
                rotationWeekOffset={rotationWeekOffset}
                staffAssignments={staffAssignments}
                employees={employees}
                onAdvanceWeek={(delta) => advanceWeek(delta)}
                onResetWeek={() => setRotationWeekOffset(0)}
                onUpdateStaffAssignments={setStaffAssignments}
                onAddEmployee={handleAddEmployee}
                onToggleEmployeeStatus={handleToggleEmployeeStatus}
                onUpdateEmployee={handleUpdateEmployee}
                onExportCsv={handleExportCsv}
                showCalloutModal={isCalloutOpen}
                onSetShowCalloutModal={setIsCalloutOpen}
                showSwapModal={isSwapOpen}
                onSetShowSwapModal={setIsSwapOpen}
                showAddModal={isAddEmpOpen}
                onSetShowAddModal={setIsAddEmpOpen}
                showDirectoryDrawer={isDirectoryOpen}
                onSetShowDirectoryDrawer={setIsDirectoryOpen}
              />
            )}
            {activeTab === 'staff' && (
              <StaffDirectoryView
                employees={employees}
                rosterLines={solution.roster_lines}
                onAddEmployee={handleAddEmployee}
                onToggleActive={handleToggleEmployeeStatus}
                onUpdateAvailability={handleUpdateAvailability}
              />
            )}
            {activeTab === 'labor' && <LaborAnalysisView solution={solution} />}
            {activeTab === 'cfo' && <CFODashboardView solution={solution} />}
            {activeTab === 'pos' && (
              <POSIntegrationView
                onDemandUpdated={(newDemand) => setDemandMatrix(newDemand)}
              />
            )}
            {activeTab === 'coverage' && <CoverageHeatmapView solution={solution} />}
            {activeTab === 'pareto' && (
              <ParetoExplorerView
                solution={solution}
                selectedLeewayPct={leewayPct}
                onSelectLeewayPct={(lw) => setLeewayPct(lw)}
              />
            )}
            {activeTab === 'ergonomics' && <ErgonomicsAuditView solution={solution} />}
            {activeTab === 'compliance' && <DOLComplianceView solution={solution} />}
          </>
        ) : (
          <div className="enterprise-card p-12 text-center text-sm text-slate-500">
            Calculating Optimized Schedule, Coverage & Labor Economics...
          </div>
        )}
      </main>

      <OnboardingWizard
        isOpen={isWizardOpen}
        archetypes={archetypes}
        selectedArchetypeId={selectedArchetypeId}
        facilityName={facilityName}
        demandMatrix={demandMatrix}
        templates={templates}
        guardrails={guardrails}
        leewayPct={leewayPct}
        onSelectArchetype={handleSelectArchetype}
        onChangeFacilityName={setFacilityName}
        onChangeDemandMatrix={setDemandMatrix}
        onChangeTemplates={setTemplates}
        onChangeGuardrails={setGuardrails}
        onChangeLeewayPct={setLeewayPct}
        onCompleteWizard={() => setIsWizardOpen(false)}
        onClose={() => setIsWizardOpen(false)}
      />

      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />
    </div>
  );
}

export default App;
