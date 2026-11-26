"use client";

// The "Add money" button.
//
// This small piece runs in the browser, so it can notice when the form is
// being sent and switch the button off until the answer comes back. A
// second tap while it is off does nothing. The real protection against
// paying twice is the idempotency key in the form; this is the polite one.

import { useFormStatus } from "react-dom";

export function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? "Adding money…" : "Add money"}
    </button>
  );
}
