"use client";

import { useFormStatus } from "react-dom";
import { BusyButton, type BusyButtonProps, resolveSubmitState } from "./BusyButton";

export { resolveSubmitState };

/** Omit that keeps the pendingLabel / ariaLabel union intact. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type SubmitButtonProps = DistributiveOmit<BusyButtonProps, "pending" | "type" | "form" | "onClick">;

/**
 * The submit button of a server-action `<form action={...}>`: BusyButton with `useFormStatus` as the driver.
 * `useFormStatus` reports only the form this button is a CHILD of, so render it inside the `<form>`, never as the
 * form itself. For a button outside its form (dialog footers, `form={id}`) or a non-action pending source use
 * BusyButton with an explicit `pending`. Without `pendingLabel` (icon-only buttons) the spinner replaces the content
 * and the caller's `aria-label` stays put.
 */
export function SubmitButton(props: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return <BusyButton {...(props as DistributiveOmit<BusyButtonProps, "pending">)} pending={pending} />;
}
