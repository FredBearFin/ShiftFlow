import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerAcceptView } from './OwnerAcceptView';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  previewOwnerInviteApi: vi.fn(),
  acceptOwnerInviteApi: vi.fn(),
  logoutApi: vi.fn(),
}));

afterEach(cleanup);

describe('OwnerAcceptView accessibility', () => {
  it('moves focus to its own heading on mount, the way the page this flow ends on also does', () => {
    vi.mocked(api.previewOwnerInviteApi).mockReturnValue(new Promise(() => {}));
    render(<OwnerAcceptView token="tok" onAccepted={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: /invited as an owner/i });
    expect(document.activeElement).toBe(heading);
  });

  it('announces that the invite is loading as role=status, instead of showing nothing', () => {
    vi.mocked(api.previewOwnerInviteApi).mockReturnValue(new Promise(() => {}));
    render(<OwnerAcceptView token="tok" onAccepted={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
  });

  it('announces an invalid or expired invite link with role=alert', async () => {
    vi.mocked(api.previewOwnerInviteApi).mockResolvedValue({
      result: null,
      error: 'This invite link is not valid.',
    });
    render(<OwnerAcceptView token="tok" onAccepted={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('not valid');
    expect(screen.getByRole('button', { name: /back to shiftflow studio/i })).toBeTruthy();
  });

  it('labels the new password field for a fresh invite', async () => {
    vi.mocked(api.previewOwnerInviteApi).mockResolvedValue({
      result: { facility_id: 'f1', facility_name: 'Omaha Foodmart', owner_email: 'owner@example.com', already_accepted: false },
      error: null,
    });
    render(<OwnerAcceptView token="tok" onAccepted={vi.fn()} />);
    expect(await screen.findByLabelText(/choose a password/i)).toBeTruthy();
  });

  it('announces an already-accepted invite as role=status, not silently', async () => {
    vi.mocked(api.previewOwnerInviteApi).mockResolvedValue({
      result: { facility_id: 'f1', facility_name: 'Omaha Foodmart', owner_email: 'owner@example.com', already_accepted: true },
      error: null,
    });
    render(<OwnerAcceptView token="tok" onAccepted={vi.fn()} />);
    const status = await screen.findByText(/already been accepted/i);
    expect(status.getAttribute('role')).toBe('status');
  });

  it('surfaces a submit error with role=alert, with the recovery action reachable by keyboard', async () => {
    vi.mocked(api.previewOwnerInviteApi).mockResolvedValue({
      result: { facility_id: 'f1', facility_name: 'Omaha Foodmart', owner_email: 'owner@example.com', already_accepted: false },
      error: null,
    });
    vi.mocked(api.acceptOwnerInviteApi).mockResolvedValue({
      status: null,
      facilityId: null,
      error: 'You are signed in with a different email. Log out and try again.',
    });
    render(<OwnerAcceptView token="tok" onAccepted={vi.fn()} />);
    const input = await screen.findByLabelText(/choose a password/i);
    fireEvent.change(input, { target: { value: 'correcthorse' } });
    fireEvent.click(screen.getByRole('button', { name: /accept invite/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('different email');
    const retry = screen.getByRole('button', { name: /log out and try again/i });
    expect(retry.tagName).toBe('BUTTON');
  });
});
