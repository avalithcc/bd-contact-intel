"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** What a submit button shows for a given `pending`; pure so every branch is testable (useFormStatus is always idle off-form). */
export function resolveSubmitState<T>(pending: boolean, disabled: boolean, idleLabel: T, pendingLabel: T | undefined) {
  return {
    disabled: disabled || pending,
    ariaBusy: pending ? ("true" as const) : undefined,
    dataBusy: pending ? ("true" as const) : undefined,
    showSpinner: pending,
    label: pending ? pendingLabel : idleLabel,
  };
}

type SubmitButtonBase = {
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
};
/** While pending the children are replaced, so the button needs a pending label or a stable aria-label to keep an accessible name. */
type SubmitButtonProps = SubmitButtonBase &
  ({ pendingLabel: string; ariaLabel?: string } | { pendingLabel?: undefined; ariaLabel: string });

/** The markup for a given `pending`; split from the hook so the pending branch can be rendered in a test. */
export function SubmitButtonView({
  pending,
  className,
  children,
  pendingLabel,
  disabled = false,
  ariaLabel,
  formAction,
}: SubmitButtonProps & { pending: boolean }) {
  const s = resolveSubmitState(pending, disabled, children, pendingLabel);
  return (
    <button
      type="submit"
      className={className}
      disabled={s.disabled}
      aria-label={ariaLabel}
      aria-busy={s.ariaBusy}
      data-busy={s.dataBusy}
      formAction={formAction}
    >
      {s.showSpinner && <span className="spinner" aria-hidden="true" />}
      {s.label}
    </button>
  );
}

/**
 * The submit button of a server-action `<form action={...}>`, with the same in-progress behaviour as SendNowButton:
 * spinner and the gerund label, disabled with `aria-busy` and `data-busy` until the action settles.
 * `useFormStatus` reports only the form this button is a CHILD of, so render it inside the `<form>`, never as the
 * form itself. Without `pendingLabel` (icon-only buttons) the spinner replaces the content and the caller's
 * `aria-label` stays put.
 */
export function SubmitButton(props: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return <SubmitButtonView pending={pending} {...props} />;
}
