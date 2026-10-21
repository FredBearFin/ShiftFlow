import { useState, useEffect, useCallback } from 'react';
import {
  ActiveTabId,
  ArchetypePreset,
  BillingSignupInput,
  BillingSignupResult,
  EmployeeRecord,
  ErgonomicGuardrails,
  NewEmployeeInput,
  PersistedSolveConfig,
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
  billingSignupApi,
  listMyOwnerLinksApi,
  OwnerLink,
  loadSolveConfig,
  saveSolveConfig,
  clearSolveConfig,
  SolveConfigRestore,
  fetchFacilityConfigApi,
  saveFacilityConfigApi,
} from './services/api';

import { Header } from './components/Header';
import { LoginView } from './components/LoginView';
import { PricingView } from './components/PricingView';
import { OwnerAcceptView } from './components/OwnerAcceptView';
import { OwnerSummaryView } from './components/OwnerSummaryView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { MasterRosterView } from './components/MasterRosterView';
import { StaffDirectoryView } from './components/StaffDirectoryView';
import { LaborAnalysisView } from './components/LaborAnalysisView';
import { CoverageHeatmapView } from './components/CoverageHeatmapView';
import { ParetoExplorerView } from './components/ParetoExplorerView';
import { ErgonomicsAuditView } from './components/ErgonomicsAuditView';
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

  // Whether this facility's server-side configuration (see backend/app/api/
  // facility_config_routes.py) has been checked at least once since the last time
  // facilityId changed. Saving to the server is held back until this is true, so a
  // browser with nothing in localStorage (e.g. a linked owner's own device - see
  // OwnerSummaryView.tsx) can never race its own blank/default state to the server
  // ahead of the real, already-saved configuration it is about to fetch.
  const [serverConfigChecked, setServerConfigChecked] = useState<boolean>(false);

  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string>(restored?.archetype_id ?? 'custom');
  const [facilityName, setFacilityName] = useState<string>(restored?.facility_name ?? '');
  const [demandMatrix, setDemandMatrix] = useState<number[][]>(restored?.demand_matrix ?? FLAT_DEMAND_MATRIX);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(restored?.templates ?? DEFAULT_TEMPLATES);
  const [guardrails, setGuardrails] = useState<ErgonomicGuardrails>(restored?.guardrails ?? DEFAULT_GUARDRAILS);
  const [leewayPct, setLeewayPct] = useState<number>(restored?.pareto_leeway_pct ?? 10.0);
  const [rotationWeekOffset, setRotationWeekOffset] = useState<number>(restored?.rotation_week_offset ?? 0);

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
  // A brand-new visitor lands on the pricing page first (the self-serve funnel); 'login'
  // is reached either by clicking "Sign in instead" there, or directly if sign-up is closed.
  const [preAuthView, setPreAuthView] = useState<'pricing' | 'login'>('pricing');

  // An invite link for a second, independent "owner" login (see OwnerAccessPanel.tsx /
  // owner_routes.py) carries its token in the URL rather than through a router, since this
  // app has none. It works regardless of whether anyone is currently signed in.
  const [ownerInviteToken, setOwnerInviteToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('owner_invite');
    } catch {
      return null;
    }
  });
  const handleOwnerInviteAccepted = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('owner_invite');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Not essential - the invite still worked even if the URL could not be cleaned up.
    }
    // Without this, ownerInviteToken (read via useState's initializer, only ever set once
    // from the URL at first mount) would stay set forever - the app would keep rendering
    // OwnerAcceptView below no matter what authState became, even though the invite was
    // accepted and the session cookie is already set. Clearing it here is what actually
    // lets the app move on to OwnerSummaryView.
    setOwnerInviteToken(null);
    setAuthState('ready');
  };

  // Facilities the signed-in account has accepted owner access to. null means "not checked
  // yet"; an ordinary manager's own account resolves to an empty array.
  const [ownerLinks, setOwnerLinks] = useState<OwnerLink[] | null>(null);

  // Set only once an accepted owner clicks "View full schedule" on a facility from
  // OwnerSummaryView - null means they're on the quick-glance summary (or this is an
  // ordinary manager account, which never sets this). See backend/app/deps.py's get_repo:
  // the same facility id now resolves to the manager's real data for this session too.
  const [ownerActiveFacility, setOwnerActiveFacility] = useState<{ id: string; name: string } | null>(null);

  // The facility this whole app instance is driving: the owner's chosen facility once
  // they've opened full access to it, otherwise the manager's own (fixed, single-facility)
  // id. Every employee read/write below goes through this instead of the bare constant.
  const facilityId = ownerActiveFacility ? ownerActiveFacility.id : STAFF_FACILITY_ID;

  useEffect(() => {
    authStatusApi().then(({ login_required, logged_in, signup_allowed }) => {
      setSignupAllowed(signup_allowed);
      setAuthState(login_required && !logged_in ? 'needs-login' : 'ready');
    });
  }, []);

  useEffect(() => {
    if (authState !== 'ready') return;
    let isMounted = true;
    listMyOwnerLinksApi().then((links) => {
      if (isMounted) setOwnerLinks(links);
    });
    return () => {
      isMounted = false;
    };
  }, [authState]);

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

  /** The pricing page's "Start my plan" action. See billingSignupApi / billing_routes.py:
   *  this both creates the account and signs it in, same as handleSignup above. */
  const handleBillingSignup = async (
    input: BillingSignupInput
  ): Promise<{ result: BillingSignupResult | null; error: string | null }> => {
    const outcome = await billingSignupApi(input);
    if (!outcome.error) setAuthState('ready');
    return outcome;
  };

  const handleLogout = async () => {
    await logoutApi();
    // The saved setup is per-browser, not per-account, so it must not be left behind
    // for whoever signs in next on this machine.
    clearSolveConfig();
    setOwnerLinks(null);
    setOwnerActiveFacility(null);
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

  // Gated on authState: a brand-new signup (pricing -> billing signup, or the plain
  // sign-up form) flips authState from 'checking'/'needs-login' to 'ready' without this
  // component ever unmounting, so a mount-only effect here would have already fired - and
  // failed with 401 "Not logged in" - before the session cookie existed. That left every
  // fresh signup stuck behind a permanent "Staff records could not be loaded" banner even
  // though the account was perfectly fine. Waiting for authState === 'ready' fetches once
  // there is actually a session to fetch with, instead of once at first paint.
  useEffect(() => {
    if (authState !== 'ready') return;
    // Owner accounts with no facility of their own render OwnerSummaryView instead of this
    // effect's result until they open one (see ownerActiveFacility below), but the fetch
    // below still runs on every render regardless - skip it until there is somewhere to
    // open to, so it isn't spent on the default STAFF_FACILITY_ID no owner account owns.
    if (ownerLinks && ownerLinks.length > 0 && !ownerActiveFacility) return;
    let isMounted = true;
    setEmployeesLoaded(false);
    fetchEmployeesApi(facilityId)
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
  }, [authState, facilityId, ownerLinks, ownerActiveFacility]);

  useEffect(() => {
    if (authState !== 'ready') return;
    fetchArchetypes().then((list) => {
      if (list && list.length > 0) setArchetypes(list);
    });
  }, [authState]);

  // The facility's saved setup now lives on the server (see backend/app/api/
  // facility_config_routes.py), keyed the same owner-aware way the real employee/
  // schedule data already is - so a manager and any linked owner (OwnerSummaryView.tsx)
  // see the same demand matrix, shift templates and guardrails regardless of whose
  // browser configured them. Try the server first; fall back to this browser's own
  // localStorage copy (which survived from before this existed) when the server has
  // nothing yet for this facility or the request fails outright.
  useEffect(() => {
    if (authState !== 'ready') return;
    let isMounted = true;
    setServerConfigChecked(false);
    fetchFacilityConfigApi(facilityId).then((result) => {
      if (!isMounted) return;
      if (result.status === 'ok') {
        const cfg = result.config;
        setSelectedArchetypeId(cfg.archetype_id);
        setFacilityName(cfg.facility_name);
        setDemandMatrix(cfg.demand_matrix);
        setTemplates(cfg.templates);
        setGuardrails(cfg.guardrails);
        setLeewayPct(cfg.pareto_leeway_pct);
        setRotationWeekOffset(cfg.rotation_week_offset);
      }
      setServerConfigChecked(true);
    });
    return () => {
      isMounted = false;
    };
  }, [authState, facilityId]);

  // Save the manager's setup on every change, so the next load re-solves the same
  // schedule instead of a default one. A refused localStorage write is surfaced below,
  // not swallowed. The server write happens the same way other API writes in this file
  // do (fire and forget, e.g. the archetype fetch above) - it is the fast localStorage
  // write that this browser depends on right away, so a server hiccup only delays other
  // sessions seeing the change rather than losing it here. It's held back until
  // serverConfigChecked so it never overwrites a real saved configuration with this
  // browser's blank/default starting state before that configuration has been fetched.
  useEffect(() => {
    const config: PersistedSolveConfig = {
      archetype_id: selectedArchetypeId,
      facility_name: facilityName,
      demand_matrix: demandMatrix,
      templates,
      guardrails,
      pareto_leeway_pct: leewayPct,
      rotation_week_offset: rotationWeekOffset,
    };
    setConfigSaveFailed(!saveSolveConfig(config));
    if (serverConfigChecked) {
      void saveFacilityConfigApi(facilityId, config);
    }
  }, [
    facilityId,
    serverConfigChecked,
    selectedArchetypeId,
    facilityName,
    demandMatrix,
    templates,
    guardrails,
    leewayPct,
    rotationWeekOffset,
  ]);

  useEffect(() => {
    if (authState !== 'ready') return;
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
  }, [authState,
    solveAttempt,
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
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(activeTag) || activeEl?.isContentEditable) {
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
  };

  const handleAddEmployee = async (newEmpData: NewEmployeeInput) => {
    setStaffError(null);
    try {
      const created = await createEmployeeApi(facilityId, {
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

  // An owner invite link works whether or not anyone is currently signed in, and takes
  // over the whole page until it's been accepted - it is not part of the normal app.
  if (ownerInviteToken) {
    return <OwnerAcceptView token={ownerInviteToken} onAccepted={handleOwnerInviteAccepted} />;
  }

  if (authState === 'checking' || (authState === 'ready' && ownerLinks === null)) {
    return <div className="min-h-screen bg-[#F4F1EA]" />;
  }
  if (authState === 'needs-login') {
    if (signupAllowed && preAuthView === 'pricing') {
      return <PricingView onStartPlan={handleBillingSignup} onSignInInstead={() => setPreAuthView('login')} />;
    }
    return (
      <LoginView
        onLogin={handleLogin}
        onSignup={handleSignup}
        signupAllowed={signupAllowed}
        onViewPricing={signupAllowed ? () => setPreAuthView('pricing') : undefined}
      />
    );
  }
  // An account that is only an invited owner (no facility of its own) lands on the
  // quick-glance summary first - see OwnerSummaryView.tsx. Picking "View full schedule"
  // there sets ownerActiveFacility and falls through to the same app the manager uses.
  if (ownerLinks && ownerLinks.length > 0 && !ownerActiveFacility) {
    return (
      <OwnerSummaryView
        links={ownerLinks}
        onLogout={handleLogout}
        onViewFullSchedule={(id, name) => setOwnerActiveFacility({ id, name })}
      />
    );
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
        ownerViewFacilityName={ownerActiveFacility?.name}
        onBackToOwnerSummary={ownerActiveFacility ? () => setOwnerActiveFacility(null) : undefined}
      />

      <main className="flex-1 max-w-[1920px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {planningOnly && employees.length === 0 && !planningBannerDismissed && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <span>
              Planning mode: this schedule has no real staff on it yet, so lines show as
              unassigned. Add your team when you're ready to run it for real.
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('roster');
                  setIsAddEmpOpen(true);
                }}
                className="rounded-md border border-indigo-300 bg-white px-3 py-1 font-semibold text-indigo-800 hover:bg-indigo-100 whitespace-nowrap"
              >
                Add your team
              </button>
              <button
                type="button"
                onClick={() => setPlanningBannerDismissed(true)}
                aria-label="Dismiss"
                className="rounded-md px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {configRestore.status === 'failed' && (
          <div role="alert" className="mb-4 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            Your saved setup could not be restored because {configRestore.reason}. This
            schedule was built from the default staffing table, not yours — open "Set up
            your schedule" and check it before you rely on it.
          </div>
        )}
        {configRestore.status === 'partial' && (
          <div role="alert" className="mb-4 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            Part of your saved setup could not be restored: {configRestore.missing.join(', ')}.
            Those parts fell back to defaults, so this schedule is not entirely yours — check
            them in "Set up your schedule".
          </div>
        )}
        {configSaveFailed && (
          <div role="alert" className="mb-4 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32]">
            This browser is refusing to save your setup, so the staffing table and shift
            times will be lost when you reload. Export the roster before you close the tab.
          </div>
        )}
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
        {solveStatus === 'error' && !errorBannerDismissed && (
          // While the setup wizard is open its fixed inset-0 z-50 overlay sits on top of
          // <main>, so an in-flow banner here is invisible. Lift it above the overlay.
          <div
            role="alert"
            className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#9F3A32] bg-white px-4 py-3 text-sm text-[#9F3A32] ${
              isWizardOpen
                ? 'fixed inset-x-3 top-3 z-[60] mx-auto max-w-3xl sm:inset-x-6'
                : 'mb-4'
            }`}
          >
            <span>{solveError}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSolveAttempt((n) => n + 1)}
                className="rounded-md border border-[#9F3A32] bg-white px-3 py-1 font-semibold text-[#9F3A32] hover:bg-[#F4F1EA]"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setErrorBannerDismissed(true)}
                aria-label="Dismiss"
                className="rounded-md px-2 py-1 font-semibold text-[#9F3A32] hover:bg-[#F4F1EA]"
              >
                ✕
              </button>
            </div>
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
                facilityId={facilityId}
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
                facilityId={facilityId}
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
