import React, { useState } from 'react';
import { Button } from './ui/Button';

interface LoginViewProps {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onSignup: (email: string, password: string) => Promise<string | null>;
  /** When false the server has closed public sign-up, so only Sign In is offered. */
  signupAllowed?: boolean;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onSignup, signupAllowed = true }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const err = mode === 'login' || !signupAllowed ? await onLogin(email, password) : await onSignup(email, password);
    setSubmitting(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F1EA] text-[#2B3A42] px-4">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-[#2B3A42] text-white flex items-center justify-center font-bold text-sm">
          SF
        </div>
        <div>
          <h1 className="type-section-title">ShiftFlow Studio</h1>
          <p className="type-prose text-slate-500 font-medium">Internal workforce scheduling tool</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm enterprise-card p-6 space-y-4">
        {signupAllowed && (
          <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-semibold">
            <button
              type="button"
              aria-pressed={mode === 'login'}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                mode === 'login' ? 'bg-white shadow-sm text-[#2B3A42]' : 'text-slate-500'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              aria-pressed={mode === 'signup'}
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                mode === 'signup' ? 'bg-white shadow-sm text-[#2B3A42]' : 'text-slate-500'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-xs font-semibold text-slate-600 mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              [mode === 'signup' ? 'password-rule' : null, error ? 'login-error' : null]
                .filter(Boolean)
                .join(' ') || undefined
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
          />
          {mode === 'signup' && (
            <p id="password-rule" className="mt-1 text-xs text-muted">At least 8 characters.</p>
          )}
        </div>

        {error && (
          <div id="login-error" role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
            {error}
          </div>
        )}

        <Button
          variant="primary"
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full"
        >
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </Button>
      </form>
    </div>
  );
};
