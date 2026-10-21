import React, { useEffect, useRef, useState } from 'react';
import { createOwnerInviteApi, listOwnerInvitesApi, OwnerInviteRecord } from '../services/api';

interface OwnerAccessPanelProps {
  facilityId: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Lets the manager invite a second, independent "owner" login onto this facility - so the
 * account survives if the manager's own login is ever deleted or stops being used. No email
 * service is configured here, so accepting the invite means sharing the link shown below.
 */
export const OwnerAccessPanel: React.FC<OwnerAccessPanelProps> = ({ facilityId }) => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [invites, setInvites] = useState<OwnerInviteRecord[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Expanding/collapsing swaps in a whole different subtree, removing whichever button
  // was just clicked ("Invite an owner" or "Collapse") from the DOM. Left alone, that
  // drops focus to the document body. Move it to the newly-revealed heading on expand,
  // and back to the trigger button on collapse - skipped on the very first render so
  // mounting the panel doesn't itself steal focus.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    if (expanded) headingRef.current?.focus();
    else triggerRef.current?.focus();
  }, [expanded]);

  const loadInvites = () => {
    listOwnerInvitesApi(facilityId)
      .then(setInvites)
      .catch(() => undefined);
  };

  useEffect(() => {
    if (expanded) loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, facilityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const { result, error: err } = await createOwnerInviteApi(facilityId, email.trim());
    setSubmitting(false);
    if (err || !result) {
      setError(err ?? 'The invite could not be created.');
      return;
    }
    setLastLink(`${window.location.origin}/?owner_invite=${result.invite_token}`);
    setEmail('');
    loadInvites();
  };

  if (!expanded) {
    return (
      <div className="card p-4 bg-white flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
            Business continuity
          </span>
          <p className="text-xs text-slate-500 mt-0.5">
            Give the business owner their own login, so this account isn't only yours.
          </p>
        </div>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setExpanded(true)}
          className="px-3 py-1.5 rounded-md border border-[#7F8A92] bg-white text-xs font-semibold text-[#2B3A42] hover:bg-[#F4F1EA]"
        >
          Invite an owner
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5 bg-white space-y-4 no-print">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-[#5C6770] block">
            Business continuity
          </span>
          {/* h2, not h3: this panel renders before StaffDirectoryView's own "Your team,
              their days off..." h2, so h3 here would skip a heading level in the outline. */}
          <h2 ref={headingRef} tabIndex={-1} className="text-sm font-bold text-slate-900 mt-0.5 focus:outline-none">
            Invite a business owner
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            An owner signs in with their own email and password, separate from yours. They get a
            quick-glance labor-cost summary, and can open the same full scheduling tool you use
            for this facility - the real roster, staff, labor analysis, coverage and ergonomics,
            alongside you, not a copy. The account and its data stay in place even if your own
            login is later deleted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse"
          className="text-slate-400 font-bold text-xs"
        >
          Collapse
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <label htmlFor="owner-invite-email" className="block text-xs font-semibold text-slate-700 mb-1">
            Owner's email
          </label>
          <input
            id="owner-invite-email"
            type="email"
            placeholder="owner@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-[#7F8A92] rounded-md text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="px-4 py-2 bg-[#2B3A42] hover:bg-[#1E2A31] text-white rounded-md text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          {submitting ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      {error && (
        <div role="alert" className="rounded-md border border-[#9F3A32] bg-white px-3 py-2 text-xs text-[#9F3A32]">
          {error}
        </div>
      )}

      {lastLink && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
          <p className="font-semibold">
            No email service is configured here. In a real deployment this link would be emailed
            to the owner automatically — for now, copy it and send it to them yourself:
          </p>
          <input
            readOnly
            aria-label="Invite link to copy and send to the owner"
            value={lastLink}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full px-2 py-1.5 border border-amber-300 rounded bg-white text-xs font-mono"
          />
        </div>
      )}

      {invites.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-700 block mb-1.5">Invited owners</span>
          <ul className="space-y-1">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{inv.owner_email}</span>
                <span
                  className={`font-semibold px-1.5 py-0.5 rounded ${
                    inv.accepted_at
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}
                >
                  {inv.accepted_at ? 'Accepted' : 'Invited — not yet accepted'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
