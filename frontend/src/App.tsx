import { useState, useEffect, useCallback } from 'react';
import {
  ActiveTabId,
  ArchetypePreset,
  EmployeeRecord,
  ErgonomicGuardrails,
  NewEmployeeInput,
  SeparationCategory,
  ShiftTemplate,
  SolveResponse,
  StaffMemberAssignment,
} from './types';
import {
  deactivateEmployee,
  fetchArchetypes,
  fetchEmployeesApi,
  createEmployeeApi,
  updateEmployeeApi,
  EmployeeApiRecord,
  EmployeeApiWrite,
  solveScheduleApi,
  exportRosterToCsvString,
  DEFAULT_TEMPLATES,
  DEFAULT_GUARDRAILS,
  authStatusApi,
  loginApi,
  signupApi,
  logoutApi,
} from './services/api';

import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
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
import { CompletionNote } from './components/onboarding/CompletionNote';

type SolveStatus = 'loading' | 'error' | 'ready';

const FLAT_DEMAND_MATRIX: number[][] = Array.from({ length: 7 }, () => Array(24).fill(2));

const STAFF_FACILITY_ID = 'FAC-OMAHA-01';

/** Maps a backend staff record to the shape the views use. */
function mapApiEmployee(rec: EmployeeApiRecord): EmployeeRecord {
  return {
    employee_id: rec.id,
    name: rec.name,
    role: rec.role,
    hourly_wage: rec.wage,
    max_weekly_hours: 40,
    is_active: rec.active,
    available_days: rec.available_days,
    preferred_shifts: ['M', 'D', 'E'],
    assigned_line_id: rec.assigned_line,
    accommodation_type: rec.accommodation_type as EmployeeRecord['accommodation_type'],
    statutory_notes: rec.statutory_notes,
    separation_category: rec.separation_category,
    separation_reason: rec.separation_reason,
    separation_timestamp: rec.separation_timestamp,
    recorded_by: rec.recorded_by,
  };
}

export function App() {
  const [archetypes, setArchetypes] = useState<ArchetypePreset[]>([]);
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string>('custom');
  const [facilityName, setFacilityName] = useState<string>('');
  const [demandMatrix, setDemandMatrix] = useState<number[][]>(FLAT_DEMAND_MATRIX);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(DEFAULT_TEMPLATES);
  const [guardrails, setGuardrails] = useState<ErgonomicGuardrails>(DEFAULT_GUARDRAILS);
  const [leewayPct, setLeewayPct] = useState<number>(10.0);
  const [rotationWeekOffset, setRotationWeekOffset] = useState<number>(0);

  const [staffAssignments, setStaffAssignments] = useState<StaffMemberAssignment[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [staffError, setStaffError] = useState<string | null>(null);

  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState<boolean>(false);
  const [singleKeyEnabled, setSingleKeyEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('shiftflow.singleKeyShortcuts') !== 'off';
    } catch {
      return true;
    }
  });
  const [isAddEmpOpen, setIsAddEmpOpen] = useState<boolean>(false);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState<boolean>(false);

  const [authState, setAuthState] = useState<'checking' | 'needs-login' | 'ready'>('checking');

  useEffect(() => {
    authStatusApi().then(({ login_required, logged_in }) => {
      setAuthState(login_required && !logged_in ? 'needs-login' : 'ready');
    });
  }, []);

  const handleLogin = async (email: string, password: string): Promise<string | null> => {
    const err = await loginApi(email, password);
    if (!err) setAuthState('ready');
    return err;
  };

  const handleSignup = async (email: string, password: string): Promise<string | null> => {
    const err = await signupApi(email, password);
    if (!err) setAuthState('ready');
    return err;
  };

  const handleLogout = async () => {
    await logoutApi();
    setAuthState('needs-login');
  };

  const [activeTab, setActiveTab] = useState<ActiveTabId>('roster');
  const [solution, setSolution] = useState<SolveResponse | null>(null);
  const [solveStatus, setSolveStatus] = useState<SolveStatus>('loading');
  const [solveError, setSolveError] = useState<string | null>(null);
  const [solveAttempt, setSolveAttempt] = useState(0);
  const [separationError, setSeparationError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchEmployeesApi(STAFF_FACILITY_ID)
      .then((records) => {
        if (isMounted) setEmployees(records.map(mapApiEmployee));
      })
      .catch((err: unknown) => {
        if (isMounted) setStaffError(err instanceof Error ? err.message : 'Staff records could not be loaded.');
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    fetchArchetypes().then((list) => {
      if (list && list.length > 0) setArchetypes(list);
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    setSolveStatus('loading');
    const timer = window.setTimeout(() => {
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
        if (isMounted) {
          setSolution(res);
          setSolveError(null);
          setSolveStatus('ready');
        }
      }).catch((err: unknown) => {
        // Keep the last schedule that was computed; only the status and error change.
        if (isMounted) {
          setSolveError(err instanceof Error ? err.message : 'The scheduling service is unavailable.');
          setSolveStatus('error');
        }
      });
    }, 300);
    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [solveAttempt, 
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

  // Close the wizard when a solve fails so the failed-solve alert is visible.
  useEffect(() => {
    if (solveStatus === 'error') setIsWizardOpen(false);
  }, [solveStatus]);

  const advanceWeek = useCallback((delta: number) => {
    if (!solution || solution.employee_count === 0) return;
    setRotationWeekOffset(
      (prev) => (((prev + delta) % solution.employee_count) + solution.employee_count) % solution.employee_count
    );
  }, [solution]);

  // Global Keyboard Navigation Engine (Hands-on-keyboard retail backroom drivability)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const activeTag = activeEl ? activeEl.tagName : '';
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(activeTag) || activeEl?.isContentEditable) {
        if (e.key === 'Escape') {
          setIsShortcutsOpen(false);
          setIsAddEmpOpen(false);
          setIsWizardOpen(false);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const dialogOpen = isShortcutsOpen || isAddEmpOpen || isWizardOpen;
      if (e.key === 'Escape') {
        setIsShortcutsOpen(false);
        setIsAddEmpOpen(false);
        setIsWizardOpen(false);
        return;
      }
      if (!singleKeyEnabled && e.key !== '?') return;
      if (dialogOpen && e.key !== '?') return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
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
  }, [advanceWeek, singleKeyEnabled, isShortcutsOpen, isAddEmpOpen, isWizardOpen]);

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

  const handleAddEmployee = async (newEmpData: NewEmployeeInput) => {
    setStaffError(null);
    try {
      const created = await createEmployeeApi(STAFF_FACILITY_ID, {
        name: newEmpData.name,
        role: newEmpData.role,
        wage: newEmpData.wage,
        available_days: newEmpData.days,
        accommodation_type: newEmpData.accommodation_type ?? 'none',
        statutory_notes: newEmpData.statutory_notes ?? null,
      });
      setEmployees((prev) => [...prev, mapApiEmployee(created)]);
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'The staff member could not be saved.');
    }
  };

  const saveEmployeeChange = async (empId: string, change: EmployeeApiWrite) => {
    setStaffError(null);
    try {
      const saved = await updateEmployeeApi(empId, change);
      setEmployees((prev) => prev.map((e) => (e.employee_id === empId ? mapApiEmployee(saved) : e)));
    } catch (err) {
      setStaffError(err instanceof Error ? err.message : 'The staff change could not be saved.');
    }
  };

  const handleToggleEmployeeStatus = (empId: string) => {
    const current = employees.find((e) => e.employee_id === empId);
    if (!current) return;
    void saveEmployeeChange(empId, { active: !current.is_active });
  };

  const handleSeparateEmployee = async (
    empId: string,
    sep: { category: SeparationCategory; reason: string; recorded_by: string }
  ) => {
    setSeparationError(null);
    try {
      const { employee } = await deactivateEmployee(empId, sep);
      setEmployees((prev) =>
        prev.map((e) =>
          e.employee_id === empId
            ? {
                ...e,
                is_active: employee.active,
                assigned_line_id: employee.assigned_line,
                separation_category: employee.separation_category,
                separation_reason: employee.separation_reason,
                separation_timestamp: employee.separation_timestamp,
                recorded_by: employee.recorded_by,
              }
            : e
        )
      );
    } catch (err) {
      setSeparationError(err instanceof Error ? err.message : 'Separation could not be recorded.');
    }
  };

  const handleUpdateEmployee = (updated: EmployeeRecord) => {
    void saveEmployeeChange(updated.employee_id, {
      name: updated.name,
      role: updated.role,
      wage: updated.hourly_wage,
      available_days: updated.available_days,
      assigned_line: updated.assigned_line_id ?? null,
      accommodation_type: updated.accommodation_type ?? 'none',
      statutory_notes: updated.statutory_notes ?? null,
    });
  };

  const handleUpdateAvailability = (empId: string, days: number[]) => {
    void saveEmployeeChange(empId, { available_days: days });
  };

  const handleExportCsv = () => {
    if (!solution) return;
    const csvData = exportRosterToCsvString(solution);
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

  if (authState === 'checking') {
    return <div className="min-h-screen bg-[#F4F1EA]" />;
  }
  if (authState === 'needs-login') {
    return <LoginView onLogin={handleLogin} onSignup={handleSignup} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F4F1EA] text-[#2B3A42]">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenWizard={() => setIsWizardOpen(true)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        solution={solution}
        leewayPct={leewayPct}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {staffError && (
          <div role="alert" className="mb-4 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            {staffError}
          </div>
        )}
        {separationError && (
          <div role="alert" className="mb-4 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            {separationError}
          </div>
        )}
        {solveStatus === 'error' && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            <span>{solveError}</span>
            <button
              type="button"
              onClick={() => setSolveAttempt((n) => n + 1)}
              className="rounded-md border border-[#9F3A32] bg-white px-3 py-1 font-semibold text-[#9F3A32] hover:bg-[#F4F1EA]"
            >
              Retry
            </button>
          </div>
        )}
        {solution ? (
          <>
            {activeTab === 'roster' && solution !== null && <CompletionNote solution={solution} />}
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
                onToggleEmployeeStatus={(empId, sep) =>
                  sep ? handleSeparateEmployee(empId, sep) : handleToggleEmployeeStatus(empId)
                }
                onUpdateEmployee={handleUpdateEmployee}
                onExportCsv={handleExportCsv}
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
                onToggleActive={(empId, sep) =>
                  sep ? handleSeparateEmployee(empId, sep) : handleToggleEmployeeStatus(empId)
                }
                onUpdateAvailability={handleUpdateAvailability}
              />
            )}
            {activeTab === 'labor' && <LaborAnalysisView solution={solution} />}
            {activeTab === 'cfo' && <CFODashboardView solution={solution} />}
            {activeTab === 'pos' && (
              <POSIntegrationView
                facilityId={STAFF_FACILITY_ID}
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
        ) : solveStatus === 'loading' ? (
          <div className="enterprise-card p-12 text-center text-sm text-slate-500">
            <span
              aria-hidden="true"
              className="mx-auto mb-4 block h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
            />
            Calculating Optimized Schedule, Coverage & Labor Economics...
          </div>
        ) : null}
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
        singleKeyEnabled={singleKeyEnabled}
        onToggleSingleKey={(enabled) => {
          setSingleKeyEnabled(enabled);
          try {
            window.localStorage.setItem('shiftflow.singleKeyShortcuts', enabled ? 'on' : 'off');
          } catch {
            // Storage can be blocked; the choice then lasts for this visit only.
          }
        }}
      />
    </div>
  );
}

export default App;
