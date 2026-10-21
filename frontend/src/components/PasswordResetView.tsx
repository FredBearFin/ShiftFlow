import React, { useState } from 'react';
import { confirmPasswordResetApi, requestPasswordResetApi } from '../services/api';

interface PasswordResetViewProps {
  /** 'request': the "forgot password?" entry point (no token yet) - enter an email,
   *  get a reset link back (no email service is configured here - see OwnerAccessPanel.tsx
   *  for the same situation with owner invites).
   *  'confirm': landed here from that link, i.e. a ?password_reset=<token> URL - enter a
   *  new password. */
  mode: 'request' | 'confirm';
  /** Only used in 'confirm' mode: the token from the URL. */
  token?: string;
  /** Returns to the normal sign-in screen. */
  onBackToLogin: () => void;
}

/**
 * Self-serve "I forgot my password" flow for a locked-out manager (see
 * backend/app/api/auth_routes.py's /password-reset/request and /password-reset/confirm).
 * Unlike owner invites, the request step never shows the actual reset link: this
 * endpoint is unauthenticated and reachable against any email, so handing the live link
 * back to whoever submitted the form - rather than only to the account's real inbox -
 * would let anyone who knows or guesses a manager's email take over that account with no
 * access to their email at all. There is no email service configured in this environment
 * yet, so for now the link is only written to the server log, which a locked-out manager
 * would need to ask the site operator for.
 */
export const PasswordResetView: React.FC<PasswordResetViewProps> = ({ mode, token, onBackToLogin }) => {
  const [email, setEmail] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestSubmitting(true);
    setRequestError(null);
    const { result, error } = await requestPasswordResetApi(email.trim());
    setRequestSubmitting(false);
    if (error || !result) {
      setRequestError(error ?? 'The reset request could not be sent.');
      return;
    }
    setRequestSubmitted(true);
  };

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setConfirmSubmitting(true);
    setConfirmError(null);
    const error = await confirmPasswordResetApi(token, password);
    setConfirmSubmitting(false);
    if (error) {
      setConfirmError(error);
      return;
    }
    setConfirmed(true);
  };

  if (mode === 'confirm') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F1EA] text-[#2B3A42] px-4">
        <div className="w-full max-w-sm enterprise-card p-6 space-y-4">
          <div>
            <h1 className="text-lg font-bold tracking-tight">Choose a new password</h1>
            <p className="text-xs text-slate-500 mt-1">
              Set a new password for your account. This link only works once.
            </p>
          </div>

          {confirmed ? (
            <div className="space-y-3">
              <p role="status" className="text-xs text-emerald-700 font-semibold">
                Your password has been changed. Sign in with your new password below.
              </p>
              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold py-2 transition-colors"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleConfirmSubmit} className="space-y-3">
              <div>
                <label htmlFor="password-reset-new-password" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  New password
                </label>
                <input
                  id="password-reset-new-password"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
                />
                <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
              </div>

              {confirmError && (
                <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
                  {confirmError}
                </div>
              )}

              <button
                type="submit"
                disabled={confirmSubmitting || password.length < 8}
                className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold py-2 transition-colors"
              >
                {confirmSubmitting ? 'Please wait…' : 'Set new password'}
              </button>
              <button
                type="button"
                onClick={onBackToLogin}
                className="w-full text-xs font-semibold text-slate-500 underline hover:text-[#2B3A42]"
              >
                Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F1EA] text-[#2B3A42] px-4">
      <div className="w-full max-w-sm enterprise-card p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Reset your password</h1>
          <p className="text-xs text-slate-500 mt-1">
            Enter the email on your account. No email service is configured here yet, so
            the reset link isn't sent automatically - ask the site operator for it once
            you've submitted this.
          </p>
        </div>

        {!requestSubmitted && (
          <form onSubmit={handleRequestSubmit} className="space-y-3">
            <div>
              <label htmlFor="password-reset-email" className="block text-xs font-semibold text-slate-600 mb-1.5">
                Email
              </label>
              <input
                id="password-reset-email"
                type="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
              />
            </div>

            {requestError && (
              <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
                {requestError}
              </div>
            )}

            <button
              type="submit"
              disabled={requestSubmitting || !email.trim()}
              className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold py-2 transition-colors"
            >
              {requestSubmitting ? 'Please wait…' : 'Request reset link'}
            </button>
          </form>
        )}

        {requestSubmitted && (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-semibold">
              If an account exists for that email, a one-time reset link has been generated.
            </p>
            <p className="mt-1">
              No email service is configured here yet, so it wasn't sent anywhere - ask
              whoever operates this site for the link rather than waiting on an email.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onBackToLogin}
          className="w-full text-xs font-semibold text-slate-500 underline hover:text-[#2B3A42]"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
};
