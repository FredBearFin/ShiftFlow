import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CoverageHeatmapView } from '../CoverageHeatmapView';
import { LoginView } from '../LoginView';
import { StaffDirectoryView } from '../StaffDirectoryView';
import { OnboardingWizard } from '../OnboardingWizard';
import { KeyboardShortcutsModal } from '../KeyboardShortcutsModal';
import { DEFAULT_GUARDRAILS, DEFAULT_TEMPLATES } from '../../services/api';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

describe('toggles carry their pressed state', () => {
  it('reports which heatmap display mode is on', () => {
    render(<CoverageHeatmapView solution={solutionFixture} />);
    const scheduled = screen.getByRole('button', { name: 'Scheduled / Required staff' });
    const deviation = screen.getByRole('button', { name: 'Net Difference (over minus under)' });

    expect(scheduled.getAttribute('aria-pressed')).toBe('true');
    expect(deviation.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(deviation);
    expect(scheduled.getAttribute('aria-pressed')).toBe('false');
    expect(deviation.getAttribute('aria-pressed')).toBe('true');
  });

  it('reports which side of the sign-in / create-account switch is on', () => {
    render(<LoginView onLogin={vi.fn()} onSignup={vi.fn()} />);
    const signIn = screen.getAllByRole('button', { name: 'Sign In' })[0];
    const create = screen.getByRole('button', { name: 'Create Account' });

    expect(signIn.getAttribute('aria-pressed')).toBe('true');
    expect(create.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(create);
    expect(signIn.getAttribute('aria-pressed')).toBe('false');
    expect(create.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the setup stepper says which step you are on', () => {
  it('marks exactly one step button with aria-current="step"', () => {
    const noop = vi.fn();
    const { container } = render(
      <OnboardingWizard
        isOpen
        archetypes={[]}
        selectedArchetypeId="custom"
        facilityName="Test Facility"
        demandMatrix={Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))}
        templates={DEFAULT_TEMPLATES}
        guardrails={DEFAULT_GUARDRAILS}
        leewayPct={10}
        onSelectArchetype={noop}
        onChangeFacilityName={noop}
        onChangeDemandMatrix={noop}
        onChangeTemplates={noop}
        onChangeGuardrails={noop}
        onChangeLeewayPct={noop}
        onCompleteWizard={noop}
        onClose={noop}
        employees={[]}
        onAddEmployee={noop}
      />
    );

    const current = container.querySelectorAll('button[aria-current="step"]');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toContain('Your business');
  });
});

describe('visible button text is part of the accessible name (2.5.3)', () => {
  it('finds the directory dialog Cancel button by the word on it', () => {
    render(
      <StaffDirectoryView
        employees={[]}
        rosterLines={[]}
        onAddEmployee={vi.fn()}
        onToggleActive={vi.fn()}
        onUpdateAvailability={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add Employee' }));

    // Was aria-label="Close" over visible text "Cancel": saying "click Cancel"
    // matched nothing.
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('keeps every visible word on a labelled button inside its accessible name', () => {
    render(
      <>
        <KeyboardShortcutsModal
          isOpen
          onClose={vi.fn()}
          singleKeyEnabled
          onToggleSingleKey={vi.fn()}
        />
        <StaffDirectoryView
          employees={[]}
          rosterLines={[]}
          onAddEmployee={vi.fn()}
          onToggleActive={vi.fn()}
          onUpdateAvailability={vi.fn()}
        />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add Employee' }));

    for (const button of screen.getAllByRole('button')) {
      const ariaLabel = button.getAttribute('aria-label');
      if (!ariaLabel) continue;
      // Glyphs and whitespace carry no words to match against.
      const visibleWords = (button.textContent || '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .trim();
      if (!visibleWords) continue;
      expect(
        ariaLabel.toLowerCase().includes(visibleWords.toLowerCase()),
        `"${ariaLabel}" must contain the visible text "${visibleWords}"`
      ).toBe(true);
    }
  });
});
