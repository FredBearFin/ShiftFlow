import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PasswordResetView } from './PasswordResetView';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  requestPasswordResetApi: vi.fn(),
  confirmPasswordResetApi: vi.fn(),
}));

// This repo's vitest config has no globals, so Testing Library does not unmount between tests on its own.
afterEach(cleanup);

describe('PasswordResetView - request step', () => {
  it('asks for an email and submits it to request a reset link', async () => {
    const requestApi = vi.mocked(api.requestPasswordResetApi).mockResolvedValue({
      result: {
        status: 'ok',
        message: 'If an account exists for that email, a password reset link has been generated.',
        reset_token: 'tok123',
        reset_path: '/?password_reset=tok123',
        note: 'No email service is configured here.',
      },
      error: null,
    });
    render(<PasswordResetView mode="request" onBackToLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'manager@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /get reset link/i }));

    await waitFor(() => expect(requestApi).toHaveBeenCalledWith('manager@example.com'));
    const linkInput = await screen.findByLabelText('Password reset link');
    expect((linkInput as HTMLInputElement).value).toContain('password_reset=tok123');
  });

  it('shows the server error when the request fails', async () => {
    vi.mocked(api.requestPasswordResetApi).mockResolvedValue({
      result: null,
      error: 'Could not reach the server.',
    });
    render(<PasswordResetView mode="request" onBackToLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'manager@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /get reset link/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server.');
  });

  it('calls onBackToLogin from the back link', () => {
    const onBackToLogin = vi.fn();
    render(<PasswordResetView mode="request" onBackToLogin={onBackToLogin} />);
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(onBackToLogin).toHaveBeenCalled();
  });
});

describe('PasswordResetView - confirm step', () => {
  it('asks for a new password and submits it with the token from the URL', async () => {
    const confirmApi = vi.mocked(api.confirmPasswordResetApi).mockResolvedValue(null);
    render(<PasswordResetView mode="confirm" token="tok123" onBackToLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brandnewpassword1' } });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(confirmApi).toHaveBeenCalledWith('tok123', 'brandnewpassword1'));
    expect((await screen.findByRole('status')).textContent).toMatch(/password has been changed/i);
  });

  it('shows the server error for an invalid or expired token', async () => {
    vi.mocked(api.confirmPasswordResetApi).mockResolvedValue('This password reset link is invalid or has expired.');
    render(<PasswordResetView mode="confirm" token="badtoken" onBackToLogin={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brandnewpassword1' } });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('invalid or has expired');
  });

  it('disables the submit button until the password is at least 8 characters', () => {
    render(<PasswordResetView mode="confirm" token="tok123" onBackToLogin={vi.fn()} />);
    const button = screen.getByRole('button', { name: /set new password/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longenough1' } });
    expect(button.disabled).toBe(false);
  });
});
