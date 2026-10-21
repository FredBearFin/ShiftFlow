import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { OwnerAccessPanel } from './OwnerAccessPanel';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  createOwnerInviteApi: vi.fn(),
  listOwnerInvitesApi: vi.fn(),
}));

afterEach(cleanup);

describe('OwnerAccessPanel accessibility', () => {
  it('moves focus to the panel heading on expand, instead of losing it when the clicked trigger unmounts', () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([]);
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    const heading = screen.getByRole('heading', { name: 'Invite a business owner' });
    expect(document.activeElement).toBe(heading);
  });

  it('returns focus to the trigger button on collapse, instead of losing it when Collapse unmounts', () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([]);
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Invite an owner' }));
  });

  it('uses h2 for the panel heading, so it does not skip a level ahead of the h2 that follows it on the page', () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([]);
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    expect(screen.getByRole('heading', { name: 'Invite a business owner' }).tagName).toBe('H2');
  });

  it('associates the owner-email field with a real label, not just a placeholder', () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([]);
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    expect(screen.getByLabelText("Owner's email")).toBeTruthy();
  });

  it('announces a validation error with role=alert', async () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([]);
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    // No dot after the @ - passes the native type="email" constraint (so the submit event
    // actually fires) but fails this component's own, stricter EMAIL_RE.
    fireEvent.change(screen.getByLabelText("Owner's email"), { target: { value: 'owner@localhost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid email/i);
  });

  it('gives the generated invite link an accessible name, not just a bare readonly text field', async () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([]);
    vi.mocked(api.createOwnerInviteApi).mockResolvedValue({
      result: {
        invite_token: 'tok123',
        accept_path: '/accept/tok123',
        owner_email: 'owner@example.com',
        facility_id: 'f1',
        note: '',
      },
      error: null,
    });
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    fireEvent.change(screen.getByLabelText("Owner's email"), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));
    const link = await screen.findByLabelText(/invite link/i);
    await waitFor(() => expect((link as HTMLInputElement).value).toContain('tok123'));
  });

  it('marks accepted vs. not-yet-accepted invites with text, not color alone', async () => {
    vi.mocked(api.listOwnerInvitesApi).mockResolvedValue([
      { id: '1', owner_email: 'a@example.com', accept_path: '/x', invited_at: '2026-01-01', accepted_at: '2026-01-02' },
      { id: '2', owner_email: 'b@example.com', accept_path: '/y', invited_at: '2026-01-01', accepted_at: null },
    ]);
    render(<OwnerAccessPanel facilityId="f1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Invite an owner' }));
    expect(await screen.findByText('Accepted')).toBeTruthy();
    expect(screen.getByText(/invited.*not yet accepted/i)).toBeTruthy();
  });
});
