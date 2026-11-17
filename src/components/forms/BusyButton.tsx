import type { ReactNode } from "react";

/** What a busy control shows for a given `pending`; pure so every branch is testable (useFormStatus is always idle off-form). */
export function resolveSubmitState<T>(pending: boolean, disabled: boolean, idleLabel: T, pendingLabel: T | undefined) {
  return {
    disabled: disabled || pending,
    ariaBusy: pending ? ("true" as const) : undefined,
    dataBusy: pending ? ("true" as const) : undefined,
    showSpinner: pending,
    label: pending ? pendingLabel : idleLabel,
  };
}

type BusyButtonBase = {
  /** Driven by the caller (useActionState, useTransition, a local flag); SubmitButton drives it from useFormStatus. */
  pending: boolean;
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  type?: "submit" | "button";
  /** The id of the `<form>` this button submits when it is rendered outside it (dialog footers). */
  form?: string;
  name?: string;
  value?: string;
  title?: string;
  ariaDescribedBy?: string;
  onClick?: () => void;
  formAction?: (formData: FormData) => void | Promise<void>;
};
/** While pending the children are replaced, so the button needs a pending label or a stable aria-label to keep an accessible name. */
export type BusyButtonProps = BusyButtonBase &
  ({ pendingLabel: string; ariaLabel?: string } | { pendingLabel?: undefined; ariaLabel: string });

/**
 * The one busy control: spinner, gerund label, `disabled`, `aria-busy` and `data-busy` ON THE BUTTON until `pending`
 * clears. The only spinner markup for a button lives here; SubmitButton is this with `useFormStatus` as the driver.
 */
export function BusyButton({
  pending,
  className,
  children,
  pendingLabel,
  disabled = false,
  ariaLabel,
  type = "submit",
  form,
  name,
  value,
  title,
  ariaDescribedBy,
  onClick,
  formAction,
}: BusyButtonProps) {
  const s = resolveSubmitState(pending, disabled, children, pendingLabel);
  return (
    <button
      type={type}
      className={className}
      form={form}
      name={name}
      value={value}
      disabled={s.disabled}
      title={title}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-busy={s.ariaBusy}
      data-busy={s.dataBusy}
      formAction={formAction}
      onClick={onClick}
    >
      {s.showSpinner && <span className="spinner" aria-hidden="true" />}
      {s.label}
    </button>
  );
}
