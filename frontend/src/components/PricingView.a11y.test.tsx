import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PricingView } from './PricingView';

afterEach(cleanup);

describe('PricingView accessibility', () => {
  it('uses a sensible, non-skipping heading structure on the plans step', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    const headings = screen.getAllByRole('heading');
    // h1 brand, h2 page title, h3 x2 plan names - never jumping from h1 straight to h3.
    expect(headings.map((h) => h.tagName)).toEqual(['H1', 'H2', 'H3', 'H3']);
  });

  it('every plan is chosen through a real, keyboard-operable <button>, not a clickable div', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    const cta = screen.getByRole('button', { name: 'Start my Personal plan' });
    expect(cta.tagName).toBe('BUTTON');
    expect(cta.getAttribute('tabindex')).not.toBe('-1');
    expect((cta as HTMLButtonElement).disabled).toBe(false);
  });

  it('moves focus to the checkout heading when a plan is chosen, instead of losing it when the clicked button unmounts', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my Business plan' }));
    const heading = screen.getByRole('heading', { name: 'Business plan' });
    expect(document.activeElement).toBe(heading);
  });

  it('moves focus back to the plans heading after going back from checkout', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my Personal plan' }));
    fireEvent.click(screen.getByRole('button', { name: /Back to plans/ }));
    const heading = screen.getByRole('heading', { name: 'Simple pricing, no sales calls' });
    expect(document.activeElement).toBe(heading);
  });

  it('does not steal focus on first render, before the person has done anything', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Simple pricing, no sales calls' }));
  });

  it('associates every checkout field with a real label, not just a placeholder', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my Business plan' }));
    expect(screen.getByLabelText('Business name')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('announces a checkout failure with role=alert', async () => {
    const onStartPlan = vi.fn().mockResolvedValue({ result: null, error: 'An account with this email already exists.' });
    render(<PricingView onStartPlan={onStartPlan} onSignInInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my Personal plan' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dupe@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correcthorse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start my plan' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });
});
