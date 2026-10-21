import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { BardPanel } from '../onboarding/BardPanel';
import { getLesson } from '../onboarding/lessons';
import { POSIntegrationView } from '../POSIntegrationView';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('the step guide announces the step, not the whole lesson', () => {
  it('keeps the collapsible body out of the live region', () => {
    const { container } = render(<BardPanel stepId={1} />);
    const live = container.querySelectorAll('[aria-live]');
    expect(live.length).toBe(1);

    const region = live[0];
    const lesson = getLesson(1)!;
    expect(region.textContent).toBe(lesson.title);
    expect(region.textContent).not.toContain(lesson.explanation);

    const toggle = screen.getByRole('button', { name: /the guide/ });
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(region.contains(body)).toBe(false);
    expect(region.contains(toggle)).toBe(false);
  });

  it('does not change the live region when the guide is collapsed', () => {
    const { container } = render(<BardPanel stepId={1} />);
    const before = container.querySelector('[aria-live]')!.textContent;
    fireEvent.click(screen.getByRole('button', { name: /the guide/ }));
    expect(container.querySelector('[aria-live]')!.textContent).toBe(before);
  });

  it('does not outrank the step heading it belongs to', () => {
    render(<BardPanel stepId={1} />);
    const heading = screen.getByRole('heading', { name: getLesson(1)!.title });
    expect(heading.tagName).toBe('H3');
  });
});

describe('the POS file field has a visible label', () => {
  it('names the file input with a real label element', () => {
    const { container } = render(<POSIntegrationView facilityId="FAC-TEST" />);
    const input = container.querySelector('input[type=file]') as HTMLInputElement;

    expect(input.id).toBeTruthy();
    const label = container.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain('POS export CSV file');
    expect(input.getAttribute('aria-label')).toBeNull();
    expect(screen.getByLabelText('POS export CSV file')).toBe(input);
  });
});
