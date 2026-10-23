import React, { useEffect, useRef, useState } from 'react';
import { BillingPlanId, BillingSignupInput, BillingSignupResult } from '../types';

interface PlanDef {
  id: BillingPlanId;
  name: string;
  price: string;
  priceDetail: string;
  tagline: string;
  features: string[];
  cta: string;
}

/**
 * Copy, pricing and framing below come straight from gtm/commercial_pricing.md (the
 * source of truth for both tiers) - do not change the numbers or wording here without
 * updating that doc first.
 */
const PLANS: PlanDef[] = [
  {
    id: 'personal',
    name: 'Personal',
    price: '$9–15',
    priceDetail: 'per month, self-serve',
    tagline: 'For the shift manager running the schedule themselves.',
    features: [
      'Fair, rotating schedule generation',
      'Fatigue / rest-gap checks between closing and opening shifts',
      'Labor cost and overtime visibility',
      'Crew availability tracking',
      'Print / CSV export',
      'Single manager, single location',
    ],
    cta: 'Start my Personal plan',
  },
  {
    id: 'business',
    name: 'Business',
    price: '$20–50',
    priceDetail: 'per location, per month',
    tagline: 'For the owner, once a manager has shown a real savings number.',
    features: [
      'Everything in Personal',
      'Multiple manager seats at the same location',
      "Schedule and crew setup lives on the business account, not one person's login",
      'Billing and ownership continuity if the manager who set it up leaves',
    ],
    cta: 'Start my Business plan',
  },
];

interface PricingViewProps {
  onStartPlan: (
    input: BillingSignupInput
  ) => Promise<{ result: BillingSignupResult | null; error: string | null }>;
  /** Lets a returning visitor skip the pricing page and go straight to Sign In. */
  onSignInInstead: () => void;
}

export const PricingView: React.FC<PricingViewProps> = ({ onStartPlan, onSignInInstead }) => {
  const [step, setStep] = useState<'plans' | 'checkout'>('plans');
  const [selectedPlan, setSelectedPlan] = useState<BillingPlanId>('personal');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const plan = PLANS.find((p) => p.id === selectedPlan)!;

  // Both "Start my <plan> plan" and "Back to plans" remove the clicked button from the
  // DOM when the step switches, which otherwise drops focus to the document body. Move
  // it to the new step's heading instead, the same way OnboardingWizard's step changes
  // and FirstRunTour do. Skipped on the very first render so initial mount doesn't steal
  // focus from wherever the page load naturally put it.
  const plansHeadingRef = useRef<HTMLHeadingElement>(null);
  const checkoutHeadingRef = useRef<HTMLHeadingElement>(null);
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (step === 'plans') plansHeadingRef.current?.focus();
    else checkoutHeadingRef.current?.focus();
  }, [step]);

  const choosePlan = (id: BillingPlanId) => {
    setSelectedPlan(id);
    setError(null);
    setStep('checkout');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: err } = await onStartPlan({
      email,
      password,
      plan: selectedPlan,
      businessName: businessName.trim() || undefined,
    });
    setSubmitting(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen bg-[#F4F1EA] text-[#2B3A42] px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-10 h-10 rounded-lg bg-[#2B3A42] text-white flex items-center justify-center font-bold text-sm">
            SF
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">ShiftFlow Studio</h1>
            <p className="text-xs text-slate-500 font-medium">Pick a plan to get started</p>
          </div>
        </div>

        {step === 'plans' && (
          <>
            <div className="text-center mb-8">
              <h2 ref={plansHeadingRef} tabIndex={-1} className="text-2xl font-bold focus:outline-none">
                Simple pricing, no sales calls
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Credit-card-free preview: pick a plan below and you're straight into the app.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {PLANS.map((p) => (
                <div key={p.id} className="enterprise-card p-6 flex flex-col">
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">{p.tagline}</p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold">{p.price}</span>
                    <span className="text-sm text-slate-500">/mo</span>
                  </div>
                  <p className="text-xs text-slate-400">{p.priceDetail}</p>

                  <ul className="mt-5 space-y-2 text-sm text-slate-700 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-[#2B3A42] font-bold" aria-hidden="true">
                          &#10003;
                        </span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => choosePlan(p.id)}
                    className="mt-6 w-full rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold py-2 transition-colors"
                  >
                    {p.cta}
                  </button>
                </div>
              ))}
            </div>

            <p className="mt-6 text-center text-xs text-slate-500">
              Already have an account?{' '}
              <button type="button" onClick={onSignInInstead} className="font-semibold underline">
                Sign in instead
              </button>
            </p>
          </>
        )}

        {step === 'checkout' && (
          <div className="max-w-sm mx-auto">
            <button
              type="button"
              onClick={() => {
                setStep('plans');
                setError(null);
              }}
              className="mb-4 text-xs font-semibold text-slate-500 hover:text-slate-700"
            >
              &larr; Back to plans
            </button>

            <form onSubmit={handleSubmit} className="enterprise-card p-6 space-y-4">
              <div>
                <h2
                  ref={checkoutHeadingRef}
                  tabIndex={-1}
                  className="text-xs font-semibold text-slate-500 uppercase tracking-wide focus:outline-none"
                >
                  {plan.name} plan
                </h2>
                <p className="text-sm text-slate-600">
                  {plan.price}/mo {plan.priceDetail}
                </p>
              </div>

              {selectedPlan === 'business' && (
                <div>
                  <label htmlFor="businessName" className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Business name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Riverside Plant"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
                  />
                </div>
              )}

              <div>
                <label htmlFor="checkoutEmail" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Email
                </label>
                <input
                  id="checkoutEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
                />
              </div>

              <div>
                <label htmlFor="checkoutPassword" className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Password
                </label>
                <input
                  id="checkoutPassword"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
                />
                <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
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
                {submitting ? 'Please wait…' : 'Start my plan'}
              </button>

              <p className="text-center text-[11px] leading-snug text-slate-400">
                This starts your {plan.name} plan as a trial on your new account. No payment
                is collected here - you can cancel any time.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
