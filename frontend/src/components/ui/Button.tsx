import React from 'react';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'danger-quiet'
  | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// Buttons are the only elements allowed a box-shadow in the design system.
const BUTTON_SHADOW = 'shadow-[0_1px_2px_rgba(43,58,66,0.08)]';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: `bg-ink text-card hover:bg-ink-strong ${BUTTON_SHADOW} font-semibold`,
  secondary: 'border border-border-control bg-card text-ink hover:bg-canvas font-semibold',
  ghost: 'text-ink hover:bg-canvas font-semibold',
  danger: `bg-[var(--danger)] text-card hover:bg-danger-strong ${BUTTON_SHADOW} font-semibold`,
  // For a destructive action that repeats down a list. Twelve filled red
  // buttons in a staff grid read as twelve warnings rather than as twelve
  // rarely-used controls, and drown the availability the grid exists to show.
  // No shadow: only the filled variants carry one.
  // --danger on --card measures 6.72:1, and 5.73:1 on the --danger-soft hover.
  'danger-quiet': 'border border-border-control bg-card text-danger hover:bg-danger-soft font-semibold',
  // Accent is for one key action per view. It carries its own padding (py-2.5), so it skips the size classes below.
  accent: `bg-accent text-card hover:bg-accent-strong ${BUTTON_SHADOW} font-bold px-5 py-2.5 text-xs`,
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-xs',
  lg: 'px-5 py-2 text-xs',
};

// Focus ring comes from the global *:focus-visible rule in index.css.
export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  className = '',
  children,
  ...rest
}) => {
  const classes = [
    'inline-flex items-center justify-center gap-2 rounded-md',
    'disabled:opacity-40',
    VARIANT_CLASSES[variant],
    variant === 'accent' ? '' : SIZE_CLASSES[size],
    className,
  ].join(' ');

  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      className={classes}
    >
      {loading ? 'Working…' : children}
    </button>
  );
};
