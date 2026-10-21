import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Header } from './Header';

// This repo's vitest config has no globals, so Testing Library does not unmount between tests on its own.
afterEach(cleanup);

const baseProps = {
  activeTab: 'roster' as const,
  onSelectTab: () => {},
  onOpenWizard: () => {},
  solution: null,
  leewayPct: 10,
};

const tab = (name: RegExp) => screen.getByRole('button', { name });

describe('Header navigation', () => {
  it('reserves the badge width before a solve returns, so the row does not reflow', () => {
    render(<Header {...baseProps} />);

    // The roster tab's badge only exists once a solution arrives. Its
    // placeholder must still be in the DOM, occupying width.
    const reserve = tab(/Weekly Schedule/).querySelector('[aria-hidden="true"]');
    expect(reserve).toBeTruthy();
    expect(reserve!.className).toContain('invisible');
    expect(reserve!.textContent).toBe('00 Shift Patterns');
  });

  it('does not announce the reserved placeholder to assistive tech', () => {
    render(<Header {...baseProps} />);
    // The accessible name is the label plus the hotkey digit only.
    expect(screen.queryByRole('button', { name: /00 Shift Patterns/ })).toBeNull();
  });

  it('marks the active tab with the accent bottom border, not a luminance shift', () => {
    render(<Header {...baseProps} />);

    expect(tab(/Weekly Schedule/).className).toContain('border-accent');
    expect(tab(/DOL Compliance/).className).toContain('border-transparent');
  });

  it('keeps one font weight across active and inactive tabs so widths are stable', () => {
    render(<Header {...baseProps} />);

    const active = tab(/Weekly Schedule/).className;
    const inactive = tab(/DOL Compliance/).className;
    expect(active).toContain('font-semibold');
    expect(inactive).toContain('font-semibold');
    expect(active).not.toContain('font-bold');
    expect(inactive).not.toContain('font-bold');
  });

  it('carries no box-shadow on the tab: buttons own the only shadow, via ui/Button', () => {
    render(<Header {...baseProps} />);
    expect(tab(/Weekly Schedule/).className).not.toContain('shadow-');
  });
});
