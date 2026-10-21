import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LoginView } from './LoginView';

const noop = async () => null;

// This repo's vitest config has no globals, so Testing Library does not unmount between tests on its own.
afterEach(cleanup);

describe('LoginView', () => {
  it('offers both Sign In and Create Account by default', () => {
    render(<LoginView onLogin={noop} onSignup={noop} />);
    expect(screen.getAllByRole('button', { name: 'Sign In' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy();
  });

  it('hides Create Account when the server has closed sign-up', () => {
    render(<LoginView onLogin={noop} onSignup={noop} signupAllowed={false} />);
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull();
  });

  it('signs in, never signs up, when sign-up is closed', async () => {
    const onLogin = vi.fn().mockResolvedValue(null);
    const onSignup = vi.fn().mockResolvedValue(null);
    render(<LoginView onLogin={onLogin} onSignup={onSignup} signupAllowed={false} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correcthorse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('a@b.co', 'correcthorse'));
    expect(onSignup).not.toHaveBeenCalled();
  });

  it('hides "Forgot password?" when no handler is given', () => {
    render(<LoginView onLogin={noop} onSignup={noop} />);
    expect(screen.queryByRole('button', { name: /forgot password/i })).toBeNull();
  });

  it('calls onForgotPassword from the Sign In form when given one', () => {
    const onForgotPassword = vi.fn();
    render(<LoginView onLogin={noop} onSignup={noop} onForgotPassword={onForgotPassword} />);
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(onForgotPassword).toHaveBeenCalled();
  });

  it('hides "Forgot password?" in Create Account mode', () => {
    render(<LoginView onLogin={noop} onSignup={noop} onForgotPassword={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.queryByRole('button', { name: /forgot password/i })).toBeNull();
  });

  it('shows the server message when sign-in is throttled', async () => {
    const onLogin = vi.fn().mockResolvedValue('Too many failed sign-in attempts. Try again in 15 minutes.');
    render(<LoginView onLogin={onLogin} onSignup={noop} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    const signInButtons = screen.getAllByRole('button', { name: 'Sign In' });
    fireEvent.click(signInButtons[signInButtons.length - 1]);
    expect((await screen.findByRole('alert')).textContent).toContain('Too many failed sign-in attempts');
  });
});
