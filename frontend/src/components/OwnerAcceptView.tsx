import React, { useEffect, useState } from 'react';
import { acceptOwnerInviteApi, OwnerInvitePreview, previewOwnerInviteApi } from '../services/api';

interface OwnerAcceptViewProps {
  token: string;
  /** Called once the invite has been accepted (new account created, or linked) and the
   *  owner is signed in - the caller re-checks auth state and moves on. */
  onAccepted: () => void;
}

/**
 * The page an invited owner lands on from their invite link (?owner_invite=<token>). In a
 * real deployment that link would have been emailed to them; see OwnerAccessPanel.tsx for
 * where it is created and shown to the manager instead.
 */
export const OwnerAcceptView: React.FC<OwnerAcceptViewProps> = ({ token, onAccepted }) => {
  const [preview, setPreview] = useState<OwnerInvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    previewOwnerInviteApi(token).then(({ result, error }) => {
      if (result) setPreview(result);
      else setPreviewError(error ?? 'This invite link is not valid.');
    });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    const { status, error } = await acceptOwnerInviteApi(token, password || undefined);
    setSubmitting(false);
    if (error) {
      setSubmitError(error);
      return;
    }
    if (status) onAccepted();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F1EA] text-[#2B3A42] px-4">
      <div className="w-full max-w-sm enterprise-card p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight">You've been invited as an owner</h1>
          <p className="text-xs text-slate-500 mt-1">
            A manager invited you to a read-only labor-cost view of their ShiftFlow Studio
            facility.
          </p>
        </div>

        {previewError && (
          <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
            {previewError}
          </div>
        )}

        {preview && !previewError && (
          <>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Facility: <span className="font-semibold">{preview.facility_name}</span>
              <br />
              Invited email: <span className="font-semibold">{preview.owner_email}</span>
            </div>

            {preview.already_accepted ? (
              <p className="text-xs text-slate-500">
                This invite has already been accepted. Sign in with {preview.owner_email} from
                the normal sign-in screen.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label htmlFor="owner-accept-password" className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Choose a password (at least 8 characters)
                  </label>
                  <input
                    id="owner-accept-password"
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B3A42]/30"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Already have a ShiftFlow Studio account with this email? Sign in first, then
                    open this link again to link it instead.
                  </p>
                </div>

                {submitError && (
                  <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
                    {submitError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || password.length < 8}
                  className="w-full rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold py-2 transition-colors"
                >
                  {submitting ? 'Please wait…' : 'Accept invite & sign in'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
};
