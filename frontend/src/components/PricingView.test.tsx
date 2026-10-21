import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PricingView } from './PricingView';

afterEach(cleanup);

describe('PricingView', () => {
  it('shows both tiers with the pricing from gtm/commercial_pricing.md', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Personal' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeTruthy();
    expect(screen.getByText('$9–15')).toBeTruthy();
    expect(screen.getByText('$20–50')).toBeTruthy();
  });

  it('never renders a payment/card field', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my Personal plan' }));
    expect(screen.queryByLabelText(/card/i)).toBeNull();
    expect(screen.queryByText(/payment successful/i)).toBeNull();
  });

  it('goes to checkout for the Personal plan without asking for a business name', async () => {
    const onStartPlan = vi.fn().mockResolvedValue({ result: null, error: null });
    render(<PricingView onStartPlan={onStartPlan} onSignInInstead={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start my Personal plan' }));
    expect(screen.queryByLabelText('Business name')).toBeNull();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'manager@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correcthorse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start my plan' }));

    await waitFor(() =>
      expect(onStartPlan).toHaveBeenCalledWith({
        email: 'manager@example.com',
        password: 'correcthorse',
        plan: 'personal',
        businessName: undefined,
      })
    );
  });

  it('collects a business name for the Business plan and passes the chosen plan through', async () => {
    const onStartPlan = vi.fn().mockResolvedValue({ result: null, error: null });
    render(<PricingView onStartPlan={onStartPlan} onSignInInstead={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start my Business plan' }));
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Omaha Foodmart' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correcthorse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start my plan' }));

    await waitFor(() =>
      expect(onStartPlan).toHaveBeenCalledWith({
        email: 'owner@example.com',
        password: 'correcthorse',
        plan: 'business',
        businessName: 'Omaha Foodmart',
      })
    );
  });

  it('shows the server error message when checkout fails', async () => {
    const onStartPlan = vi.fn().mockResolvedValue({ result: null, error: 'An account with this email already exists.' });
    render(<PricingView onStartPlan={onStartPlan} onSignInInstead={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start my Personal plan' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dupe@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correcthorse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start my plan' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });

  it('lets a returning visitor switch to sign-in instead of picking a plan', () => {
    const onSignInInstead = vi.fn();
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={onSignInInstead} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));
    expect(onSignInInstead).toHaveBeenCalled();
  });

  it('can go back from checkout to the plan list', () => {
    render(<PricingView onStartPlan={vi.fn()} onSignInInstead={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start my Business plan' }));
    fireEvent.click(screen.getByRole('button', { name: /Back to plans/ }));
    expect(screen.getByRole('heading', { name: 'Personal' })).toBeTruthy();
  });
});
