import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StaffDirectoryView } from '../StaffDirectoryView';
import { LoginView } from '../LoginView';
import { solutionFixture } from '../../test/solutionFixture';

// This repo runs vitest without globals, so Testing Library does not unmount
// between cases on its own.
afterEach(cleanup);

/** Every invalid field must name an element that actually holds the error text. */
function describedByText(field: HTMLElement): string {
  const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  expect(ids.length).toBeGreaterThan(0);
  return ids
    .map((id) => {
      const el = document.getElementById(id);
      expect(el, `aria-describedby points at missing id "${id}"`).not.toBeNull();
      return el!.textContent || '';
    })
    .join(' ');
}

describe('error text is linked to its field', () => {
  it('describes an out-of-range wage instead of only setting aria-invalid', () => {
    render(
      <StaffDirectoryView
        employees={[]}
        rosterLines={solutionFixture.roster_lines}
        onAddEmployee={vi.fn()}
        onToggleActive={vi.fn()}
        onUpdateAvailability={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Add Employee' }));

    const wage = screen.getByLabelText(/Wage \(\$\/hr\)/) as HTMLInputElement;
    expect(wage.getAttribute('aria-describedby')).toBeNull();

    fireEvent.change(wage, { target: { value: '3' } });
    expect(wage.getAttribute('aria-invalid')).toBe('true');
    expect(describedByText(wage)).toContain('between $7.25 and $100.00');
  });

  it('links the login alert to the fields it is about', async () => {
    render(
      <LoginView
        onLogin={() => Promise.resolve('Email or password is wrong.')}
        onSignup={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Sign In' }).find((b) => b.getAttribute('type') === 'submit')!
    );

    const alert = await screen.findByRole('alert');
    expect(alert.id).toBe('login-error');
    expect(describedByText(screen.getByLabelText('Email'))).toContain('Email or password is wrong.');
    expect(describedByText(screen.getByLabelText('Password'))).toContain('Email or password is wrong.');
  });

  it('keeps the signup password rule as a description of the password field', () => {
    render(<LoginView onLogin={vi.fn()} onSignup={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(describedByText(screen.getByLabelText('Password'))).toContain('At least 8 characters.');
  });
});
