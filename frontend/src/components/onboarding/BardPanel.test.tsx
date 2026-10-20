import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { BardPanel, BARD_HIDDEN_KEY } from './BardPanel';
import { getLesson } from './lessons';

describe('BardPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('renders the lesson title for step 1', () => {
    const lesson = getLesson(1);
    expect(lesson).toBeDefined();
    render(<BardPanel stepId={1} />);
    expect(screen.getByRole('heading', { name: lesson?.title ?? '' })).toBeTruthy();
  });

  it('hides and shows the body and updates aria-expanded on toggle', () => {
    render(<BardPanel stepId={1} />);
    const toggle = screen.getByRole('button', { name: 'Hide the guide' });
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const bodyId = toggle.getAttribute('aria-controls');
    expect(bodyId).toBeTruthy();
    const body = document.getElementById(bodyId ?? '') as HTMLElement;
    expect(body.hidden).toBe(false);

    fireEvent.click(toggle);
    const showButton = screen.getByRole('button', { name: 'Show the guide' });
    expect(showButton.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    expect(window.localStorage.getItem(BARD_HIDDEN_KEY)).toBe('1');

    fireEvent.click(showButton);
    const hideButton = screen.getByRole('button', { name: 'Hide the guide' });
    expect(hideButton.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(window.localStorage.getItem(BARD_HIDDEN_KEY)).toBe('0');
  });

  it('starts collapsed when the stored state is hidden', () => {
    window.localStorage.setItem(BARD_HIDDEN_KEY, '1');
    render(<BardPanel stepId={1} />);
    expect(screen.getByRole('button', { name: 'Show the guide' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('renders nothing for a step with no lesson', () => {
    const { container } = render(<BardPanel stepId={99} />);
    expect(container.querySelector('section')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('still renders the panel when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const lesson = getLesson(1);
    render(<BardPanel stepId={1} />);
    expect(screen.getByRole('heading', { name: lesson?.title ?? '' })).toBeTruthy();

    const toggle = screen.getByRole('button', { name: 'Hide the guide' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show the guide' })).toBeTruthy();
  });
});
