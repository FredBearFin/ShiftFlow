import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-xs font-semibold',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold',
  ghost: 'text-slate-700 hover:bg-slate-100 font-semibold',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-xs font-semibold',
  // Accent carries its own padding (py-2.5), so it skips the size classes below.
  accent: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm font-bold px-5 py-2.5 text-xs',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[11px]',
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
    'inline-flex items-center justify-center gap-2 rounded-lg',
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
