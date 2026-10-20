import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Term } from './Term';

const EXPLANATION = 'People needed in each hour of the day.';

describe('Term', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders children as a button', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    expect(trigger.getAttribute('type')).toBe('button');
  });

  it('opens the explanation on click', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coverage' }));
    expect(screen.getByRole('dialog').textContent).toBe(EXPLANATION);
  });

  it('closes on a second click', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    fireEvent.click(screen.getByRole('button', { name: 'Coverage' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the explanation on focus', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    fireEvent.focus(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog').textContent).toBe(EXPLANATION);
  });

  it('closes on Escape pressed on the trigger', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    fireEvent.focus(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  it('closes on blur when focus does not move to another element', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    fireEvent.focus(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.blur(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(EXPLANATION)).toBeNull();
  });

  it('omits aria-controls while closed', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    expect(trigger.hasAttribute('aria-controls')).toBe(false);
  });

  it('toggles aria-expanded and points aria-controls at the popover', () => {
    render(<Term explanation={EXPLANATION}>Coverage</Term>);
    const trigger = screen.getByRole('button', { name: 'Coverage' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const popover = screen.getByRole('dialog');
    expect(trigger.getAttribute('aria-controls')).toBe(popover.id);

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
