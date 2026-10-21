/**
 * Chart text must not scale with its container.
 *
 * The ergonomics bar chart was one <svg viewBox="0 0 640 256"> sized
 * `w-full h-auto`, so its whole coordinate system — text included — scaled to
 * the container: 2.08x at a 1440 viewport, 2.83x at 2560. Its hardcoded 11px
 * criterion names rendered at 22.9px and 31.2px and were the largest type in
 * the application, larger than every page title, while at 375 the same
 * mechanism shrank them below 6px.
 *
 * jsdom does no layout, so this asserts the mechanism rather than the measured
 * pixel size: no <text> may sit inside a viewBox'd SVG that is sized to its
 * container, and the labels must carry an ordinary type-scale class instead.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErgonomicsAuditView } from '../ErgonomicsAuditView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

/** An SVG whose viewBox is mapped onto a container-relative width scales. */
function scalesWithContainer(svg: SVGElement): boolean {
  if (!svg.getAttribute('viewBox')) return false;
  const cls = svg.getAttribute('class') ?? '';
  return /\bw-full\b|\bflex-1\b|\bw-\[/.test(cls);
}

describe('the ergonomics chart does not magnify its own labels', () => {
  it('puts no text inside a container-scaled SVG', () => {
    const { container } = render(<ErgonomicsAuditView solution={solutionFixture} />);
    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      if (!scalesWithContainer(svg)) continue;
      expect(
        svg.querySelectorAll('text, tspan').length,
        'text in a container-scaled viewBox renders at the container scale factor'
      ).toBe(0);
    }
  });

  it('sets no font-size in raw SVG user units anywhere in the view', () => {
    const { container } = render(<ErgonomicsAuditView solution={solutionFixture} />);
    for (const el of Array.from(container.querySelectorAll('svg *'))) {
      expect((el as SVGElement).style.fontSize).toBe('');
      expect(el.getAttribute('font-size')).toBeNull();
    }
  });

  it('renders the criterion names as HTML on the 12px type scale', () => {
    const { container } = render(<ErgonomicsAuditView solution={solutionFixture} />);
    const chart = screen.getByText("What's pulling the score down").closest('.card')!;
    const names = Array.from(chart.querySelectorAll('li > span:first-child'));
    expect(names.length).toBe(solutionFixture.ergonomics_audit.criteria_breakdown.length);
    for (const name of names) {
      // 12px, the smallest step of the type scale — never larger than a title.
      expect(name.closest('li')!.className).toContain('text-xs');
      expect(name.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    }
    // And the bars themselves are still decorative.
    for (const svg of Array.from(container.querySelectorAll('svg'))) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
