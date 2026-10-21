import React, { useState } from 'react';

interface LoginViewProps {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onSignup: (email: string, password: string) => Promise<string | null>;
  /** When false the server has closed public sign-up, so only Sign In is offered. */
  signupAllowed?: boolean;
  /** When set, shows a link back to the pricing page (see PricingView.tsx) for a new
   *  visitor who landed here first instead of picking a plan. Omit to hide the link. */
  onViewPricing?: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onSignup, signupAllowed = true, onViewPricing }) => {
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
          <h1 className="text-lg font-bold tracking-tight">ShiftFlow Studio</h1>
          <p className="text-xs text-slate-500 font-medium">Internal workforce scheduling tool</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm enterprise-card p-6 space-y-4">
        {signupAllowed && (
          <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-semibold">
            <button
              type="button"
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
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
          />
          {mode === 'signup' && (
            <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
          )}
        </div>

        {error && (
          <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold py-2 transition-colors"
        >
          {submitting ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>
      </form>

      {signupAllowed && onViewPricing && (
        <p className="mt-4 text-xs text-slate-500">
          New here?{' '}
          <button type="button" onClick={onViewPricing} className="font-semibold underline">
            View plans and pricing
          </button>
        </p>
      )}
    </div>
  );
};
