import type { ButtonHTMLAttributes } from "react";

/**
 * The "complete a task" control (task-complete-affordance, option B): a
 * circular button, not a checkbox, because completing is an action and a
 * checkbox reads as "select this row". Presentational only; each caller owns
 * the write and the toast. `done` renders the filled, disabled state (also
 * used while the write is in flight). Markup and path are the approved
 * mockup's (`complete-control.html`, block B).
 *
 * `aria-pressed` carries what the old checkbox's `checked` state used to say.
 * Without it a completed task announces only "Completar, dimmed", which tells
 * a screen-reader user the control is unavailable but not that the task is
 * already done — a regression against the checkbox this replaced. With it the
 * control is a toggle button and its pressed state is the task's status.
 */
export function DoneButton({
  done,
  label,
  onClick,
}: {
  done: boolean;
  label: string;
  onClick: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
}) {
  return (
    <button
      type="button"
      className="done-btn"
      title={label}
      aria-label={label}
      aria-pressed={done}
      disabled={done}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
        <path d="m5 13 4 4L19 7" />
      </svg>
    </button>
  );
}
