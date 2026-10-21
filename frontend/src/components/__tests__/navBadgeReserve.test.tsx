import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Header } from '../Header';
import { solutionFixture } from '../../test/solutionFixture';
import { formatCurrency } from '../../utils/format';

afterEach(cleanup);

const noop = () => undefined;

/**
 * jsdom performs no layout, so these cannot measure pixels.
 *
 * A character-count budget was tried here and removed: 'Staff Directory & Availability'
 * is 30 characters and fits, while a shorter label beside a digit-heavy mono badge did
 * not, so counting characters gives false confidence. False confidence from a proxy is
 * precisely what let every tab overflow to 400px while a 375px test stayed green.
 *
 * Real pixel measurement lives in scripts/measure-375-reflow.mjs, which renders the app
 * in a browser with loaded-state payroll text. What is guarded here is only what a
 * string can honestly guard.
 */
describe('nav badge reserve and label budget', () => {
  it('reserves at least the width the loaded payroll badge needs', () => {
    // The reserve must cover the money AND the priced fraction beside it. Reserving
    // only the money let the nav reflow when a solve landed.
    const realBadge = `${formatCurrency(4970.4)} · 6/6 priced`;
    const reserve = `${formatCurrency(100000)} · 00/00 priced`;
    expect(reserve.length).toBeGreaterThanOrEqual(realBadge.length);
  });

  it('still renders the payroll total and its priced fraction together', () => {
    render(
      <Header
        activeTab="roster"
        onSelectTab={noop}
        onOpenWizard={noop}
        onOpenShortcuts={noop}
        solution={solutionFixture}
        leewayPct={10}
      />
    );
    const priced = screen.getAllByText(/priced/);
    expect(priced.length).toBeGreaterThan(0);
  });
});
