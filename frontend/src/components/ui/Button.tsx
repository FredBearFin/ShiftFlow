import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
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
  primary: `bg-[#2B3A42] text-[#FFFFFF] hover:bg-[#1E2A31] ${BUTTON_SHADOW} font-semibold`,
  secondary: 'border border-[#7F8A92] bg-[#FFFFFF] text-[#2B3A42] hover:bg-[#F4F1EA] font-semibold',
  ghost: 'text-[#2B3A42] hover:bg-[#F4F1EA] font-semibold',
  danger: `bg-[var(--danger)] text-[#FFFFFF] hover:bg-[#862F28] ${BUTTON_SHADOW} font-semibold`,
  // Accent is for one key action per view. It carries its own padding (py-2.5), so it skips the size classes below.
  accent: `bg-[#4A6B5D] text-[#FFFFFF] hover:bg-[#3E5C50] ${BUTTON_SHADOW} font-bold px-5 py-2.5 text-xs`,
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
