import React, { useId, useLayoutEffect, useRef, useState } from 'react';

export interface TermProps {
  /** The visible word. */
  children: React.ReactNode;
  /** Short plain-language explanation shown in the popover. */
  explanation: string;
  className?: string;
}

// A dotted-underline word that opens a short explanation on hover, click or focus.
// Closes on Escape, on a second click, on mouse leave (unless focused), or when focus leaves the component.
export const Term: React.FC<TermProps> = ({ children, explanation, className = '' }) => {
  const [open, setOpen] = useState(false);
  // True when the popover should anchor to the trigger's right edge (near the viewport's right edge).
  const [alignRight, setAlignRight] = useState(false);
  const popoverId = useId();
  const triggerId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  // Focus opens the popover. The click that usually follows a mouse focus must not
  // toggle it closed again, so the next click after a focus-open is absorbed.
  const openedByFocus = useRef(false);

  // On each open, measure whether the popover would overflow the right edge; if so, anchor it right.
  useLayoutEffect(() => {
    if (!open) {
      setAlignRight(false);
      return;
    }
    const triggerLeft = triggerRef.current?.getBoundingClientRect().left ?? 0;
    const popoverWidth = popoverRef.current?.getBoundingClientRect().width ?? 0;
    setAlignRight(triggerLeft + popoverWidth > window.innerWidth - 16);
  }, [open]);

  const handleMouseEnter = () => {
    setOpen(true);
  };

  const handleMouseLeave = () => {
    // A focused trigger keeps the popover open; otherwise hover-out closes it.
    if (document.activeElement !== triggerRef.current) {
      setOpen(false);
      openedByFocus.current = false;
    }
  };

  const handleFocus = () => {
    openedByFocus.current = true;
    setOpen(true);
  };

  const handleClick = () => {
    if (openedByFocus.current) {
      openedByFocus.current = false;
      setOpen(true);
      return;
    }
    setOpen((prev) => !prev);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      // Focus is already on the trigger (the only focusable element here), so it stays put.
      setOpen(false);
      openedByFocus.current = false;
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next)) {
      setOpen(false);
      openedByFocus.current = false;
    }
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onFocus={handleFocus}
        onClick={handleClick}
        className={[
          'cursor-help bg-transparent p-0 border-0 font-inherit text-inherit',
          'underline decoration-dotted decoration-muted underline-offset-2',
          className,
        ].join(' ')}
      >
        {children}
      </button>
      {open && (
        <span
          ref={popoverRef}
          role="dialog"
          id={popoverId}
          aria-labelledby={triggerId}
          className={[
            'absolute top-full z-50 mt-2 block w-max max-w-[min(16rem,calc(100vw-2rem))] whitespace-normal break-words rounded-lg border border-border-subtle bg-white px-3 py-2 text-left text-xs font-normal leading-relaxed text-ink shadow-lg',
            alignRight ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {explanation}
        </span>
      )}
    </span>
  );
};
