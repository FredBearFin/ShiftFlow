import { useState, useEffect, useCallback } from 'react';
import {
  ActiveTabId,
  ArchetypePreset,
  EmployeeRecord,
  ErgonomicGuardrails,
  NewEmployeeInput,
  RosterCellOverride,
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
  loadSolveConfig,
  loadRosterOverrides,
  saveSolveConfig,
  clearSolveConfig,
  SolveConfigRestore,
} from './services/api';
import { pruneOverrides } from './services/rosterOverrides';

import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { MasterRosterView } from './components/MasterRosterView';
import { StaffDirectoryView } from './components/StaffDirectoryView';
import { LaborAnalysisView } from './components/LaborAnalysisView';
import { CoverageHeatmapView } from './components/CoverageHeatmapView';
import { ParetoExplorerView } from './components/ParetoExplorerView';
import { ErgonomicsAuditView } from './components/ErgonomicsAuditView';
import { DOLComplianceView } from './components/DOLComplianceView';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { Button } from './components/ui/Button';
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

  // Read the last session's setup once, before the fields below take their initial
  // values. Staff records come back from the server, so until this existed a reload
  // left the staff in place and quietly reset everything else to defaults - a
  // different schedule, with no wizard and no notice.
  const [configRestore] = useState<SolveConfigRestore>(() => loadSolveConfig());
  const restored =
    configRestore.status === 'ok' || configRestore.status === 'partial'
      ? configRestore.config
      : undefined;
  const [configSaveFailed, setConfigSaveFailed] = useState<boolean>(false);

  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string>(restored?.archetype_id ?? 'custom');
  const [facilityName, setFacilityName] = useState<string>(restored?.facility_name ?? '');
  const [demandMatrix, setDemandMatrix] = useState<number[][]>(restored?.demand_matrix ?? FLAT_DEMAND_MATRIX);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(restored?.templates ?? DEFAULT_TEMPLATES);
  const [guardrails, setGuardrails] = useState<ErgonomicGuardrails>(restored?.guardrails ?? DEFAULT_GUARDRAILS);
  const [leewayPct, setLeewayPct] = useState<number>(restored?.pareto_leeway_pct ?? 10.0);
  const [rotationWeekOffset, setRotationWeekOffset] = useState<number>(restored?.rotation_week_offset ?? 0);

  // The manager's hand edits to the generated roster. Restored before the first solve
  // comes back, then pruned against it, so an edit survives a reload the same way the
  // rest of the setup does.
  const [rosterOverrides, setRosterOverrides] = useState<RosterCellOverride[]>(() =>
    loadRosterOverrides()
  );

  const [staffAssignments, setStaffAssignments] = useState<StaffMemberAssignment[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [employeesLoaded, setEmployeesLoaded] = useState<boolean>(false);
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
  // An explicit choice to plan a schedule's shape without adding real staff yet
  // (e.g. a hypothetical business, a job site being planned before anyone is hired).
  // Deliberately opt-in, not a default fallback, so the empty-staff bug this was
  // built to fix can't silently reappear.
  const [planningOnly, setPlanningOnly] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('shiftflow.planningOnly') === '1';
    } catch {
      return false;
    }
  });

  const [authState, setAuthState] = useState<'checking' | 'needs-login' | 'ready'>('checking');
  const [signupAllowed, setSignupAllowed] = useState(true);

  useEffect(() => {
    authStatusApi().then(({ login_required, logged_in, signup_allowed }) => {
      setSignupAllowed(signup_allowed);
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
    // The saved setup is per-browser, not per-account, so it must not be left behind
    // for whoever signs in next on this machine.
    clearSolveConfig();
    setRosterOverrides([]);
    setAuthState('needs-login');
  };

  const [activeTab, setActiveTab] = useState<ActiveTabId>('roster');
  const [solution, setSolution] = useState<SolveResponse | null>(null);
  const [solveStatus, setSolveStatus] = useState<SolveStatus>('loading');
  const [solveError, setSolveError] = useState<string | null>(null);
  const [solveAttempt, setSolveAttempt] = useState(0);
  const [separationError, setSeparationError] = useState<string | null>(null);
  const [planningBannerDismissed, setPlanningBannerDismissed] = useState<boolean>(false);
  const [errorBannerDismissed, setErrorBannerDismissed] = useState<boolean>(false);

  // Dismissing the solve-error banner only hides *that* error - a new or changed
  // error message should surface again rather than staying silently dismissed.
  useEffect(() => {
    setErrorBannerDismissed(false);
  }, [solveError]);

  useEffect(() => {
    let isMounted = true;
    fetchEmployeesApi(STAFF_FACILITY_ID)
      .then((records) => {
        if (isMounted) setEmployees(records.map(mapApiEmployee));
      })
      .catch((err: unknown) => {
        if (isMounted) setStaffError(err instanceof Error ? err.message : 'Staff records could not be loaded.');
      })
      .finally(() => {
        if (isMounted) setEmployeesLoaded(true);
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

  // Save the manager's setup on every change, so the next load re-solves the same
  // schedule instead of a default one. A refused write is surfaced below, not swallowed.
  useEffect(() => {
    setConfigSaveFailed(
      !saveSolveConfig(
        {
          archetype_id: selectedArchetypeId,
          facility_name: facilityName,
          demand_matrix: demandMatrix,
          templates,
          guardrails,
          pareto_leeway_pct: leewayPct,
          rotation_week_offset: rotationWeekOffset,
        },
        rosterOverrides
      )
    );
  }, [
    selectedArchetypeId,
    facilityName,
    demandMatrix,
    templates,
    guardrails,
    leewayPct,
    rotationWeekOffset,
    rosterOverrides,
  ]);

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
          // An edit names a shift pattern in the roster it was made against. A new
          // solve can have fewer patterns, so one that no longer names a real cell is
          // dropped rather than silently applied to whatever now sits in that slot.
          setRosterOverrides((prev) => {
            const kept = pruneOverrides(prev, res);
            return kept.length === prev.length ? prev : kept;
          });
          setSolveError(null);
          setSolveStatus('ready');
        }
      }).catch((err: unknown) => {
        // The previous schedule answered a different configuration. Leaving it on screen
        // would present its roster, KPI cards, payroll total and CSV/print exports as the
        // result for the settings now showing, so it is cleared rather than kept.
        if (isMounted) {
          setSolution(null);
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

  // There is no such thing as a real schedule with no staff on it: until at least one
  // employee exists, setup cannot be skipped or dismissed.
  const needsOnboarding = employeesLoaded && employees.length === 0 && !planningOnly;

  const handlePlanWithoutStaff = () => {
    setPlanningOnly(true);
    try {
      window.localStorage.setItem('shiftflow.planningOnly', '1');
    } catch {
      // Storage can be blocked; the choice then lasts for this visit only.
    }
    setIsWizardOpen(false);
  };

  useEffect(() => {
    if (needsOnboarding) setIsWizardOpen(true);
  }, [needsOnboarding]);

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
      // Anything focusable that handles its own keys - including the frontier
      // rows, which are div[role=button][tabindex=0] rather than <button> -
      // gets the keypress to itself, so one press can't fire two actions.
      const isFocusableWidget =
        !!activeEl && (activeEl.getAttribute('role') === 'button' || activeEl.hasAttribute('tabindex'));
      if (
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(activeTag) ||
        activeEl?.isContentEditable ||
        isFocusableWidget
      ) {
        if (e.key === 'Escape') {
          setIsShortcutsOpen(false);
          setIsAddEmpOpen(false);
          if (!needsOnboarding) setIsWizardOpen(false);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const dialogOpen = isShortcutsOpen || isAddEmpOpen || isWizardOpen;
      if (e.key === 'Escape') {
        setIsShortcutsOpen(false);
        setIsAddEmpOpen(false);
        if (!needsOnboarding) setIsWizardOpen(false);
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
        setActiveTab('coverage');
      } else if (e.key === '4') {
        setActiveTab('pareto');
      } else if (e.key === '5') {
        setActiveTab('ergonomics');
      } else if (e.key === '6') {
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
  }, [advanceWeek, singleKeyEnabled, isShortcutsOpen, isAddEmpOpen, isWizardOpen, needsOnboarding]);

  const handleSelectArchetype = (preset: ArchetypePreset) => {
    setSelectedArchetypeId(preset.id);
    setFacilityName(preset.name);
    setDemandMatrix(preset.demand_matrix.map((r) => [...r]));
    setTemplates(preset.templates.map((t) => ({ ...t })));
    setGuardrails({ ...preset.guardrails });
    setLeewayPct(preset.default_leeway_pct);
    setRotationWeekOffset(0);
    setStaffAssignments([]);
    // A different preset is a different generated roster, so edits against the old one
    // no longer describe any cell that exists.
    setRosterOverrides([]);
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
    return <div className="min-h-screen bg-canvas" />;
  }
  if (authState === 'needs-login') {
    return <LoginView onLogin={handleLogin} onSignup={handleSignup} signupAllowed={signupAllowed} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenWizard={() => setIsWizardOpen(true)}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
        solution={solution}
        leewayPct={leewayPct}
        onLogout={handleLogout}
      />

      <main className="flex-1 max-w-[1920px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {planningOnly && employees.length === 0 && !planningBannerDismissed && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent bg-accent-soft px-4 py-3 text-sm text-ink">
            <span>
              Planning mode: this schedule has no real staff on it yet, so lines show as
              unassigned. Add your team when you're ready to run it for real.
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActiveTab('roster');
                  setIsAddEmpOpen(true);
                }}
                className="whitespace-nowrap"
              >
                Add your team
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPlanningBannerDismissed(true)}
                aria-label="Dismiss"
              >
                ✕
              </Button>
            </div>
          </div>
        )}
        {configRestore.status === 'failed' && (
          <div role="alert" className="mb-4 rounded-md border border-danger bg-white px-4 py-3 text-sm text-danger">
            Your saved setup could not be restored because {configRestore.reason}. This
            schedule was built from the default staffing table, not yours — open "Set up
            your schedule" and check it before you rely on it.
          </div>
        )}
        {configRestore.status === 'partial' && (
          <div role="alert" className="mb-4 rounded-md border border-danger bg-white px-4 py-3 text-sm text-danger">
            Part of your saved setup could not be restored: {configRestore.missing.join(', ')}.
            Those parts fell back to defaults, so this schedule is not entirely yours — check
            them in "Set up your schedule".
          </div>
        )}
        {configSaveFailed && (
          <div role="alert" className="mb-4 rounded-md border border-danger bg-white px-4 py-3 text-sm text-danger">
            This browser is refusing to save your setup, so the staffing table and shift
            times will be lost when you reload. Export the roster before you close the tab.
          </div>
        )}
        {staffError && (
          <div role="alert" className="mb-4 rounded-md border border-danger bg-white px-4 py-3 text-sm text-danger">
            {staffError}
          </div>
        )}
        {separationError && (
          <div role="alert" className="mb-4 rounded-md border border-danger bg-white px-4 py-3 text-sm text-danger">
            {separationError}
          </div>
        )}
        {solveStatus === 'error' && !errorBannerDismissed && (
          // While the setup wizard is open its fixed inset-0 z-50 overlay sits on top of
          // <main>, so an in-flow banner here is invisible. Lift it above the overlay.
          <div
            role="alert"
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-white px-4 py-3 text-sm text-danger ${
              isWizardOpen
                ? 'fixed inset-x-3 top-3 z-[60] mx-auto max-w-3xl sm:inset-x-6'
                : 'mb-4'
            }`}
          >
            <span>
              {solveError} No schedule is shown for these settings — the last one that worked
              answered different settings, so it is not displayed, printed or exported here.
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSolveAttempt((n) => n + 1)}>
                Retry
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setErrorBannerDismissed(true)}
                aria-label="Dismiss"
              >
                ✕
              </Button>
            </div>
          </div>
        )}
        {/* Solve progress is announced on every re-solve, not just the first one. */}
        <div role="status" aria-live="polite" className={solveStatus === 'loading' && solution ? 'mb-4' : undefined}>
          {solveStatus === 'loading' ? (
            solution ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-border-control bg-white px-3 py-1.5 text-xs font-semibold text-ink">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-slate-600"
                />
                Working out the updated schedule…
              </span>
            ) : (
              <span className="sr-only">Working out your schedule…</span>
            )
          ) : solveStatus === 'ready' ? (
            <span className="sr-only">Your schedule is ready.</span>
          ) : null}
        </div>
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
                rosterOverrides={rosterOverrides}
                onUpdateRosterOverrides={setRosterOverrides}
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
            {activeTab === 'labor' && (
              <LaborAnalysisView
                solution={solution}
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
          <div className="enterprise-card p-12 text-center text-sm text-muted">
            <span
              aria-hidden="true"
              className="mx-auto mb-4 block h-6 w-6 animate-spin rounded-full border-2 border-border border-t-slate-600"
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
        employees={employees}
        onAddEmployee={handleAddEmployee}
        canSkip={!needsOnboarding}
        onPlanWithoutStaff={handlePlanWithoutStaff}
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
