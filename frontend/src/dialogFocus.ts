import { useEffect, useRef, type KeyboardEvent } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isFocusable(element: HTMLElement) {
  return !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true" && element.getClientRects().length > 0;
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(isFocusable);
}

export function useDialogFocus<T extends HTMLElement>(open: boolean) {
  const dialogRef = useRef<T | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      document.body.style.overflow = previousOverflow;
      if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
    };
  }, [open]);

  return dialogRef;
}

export function trapDialogTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;

  const focusable = focusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (event.shiftKey && (!active || active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
