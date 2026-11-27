"use client";

// The "Create an invite code" (or "Create a new code") button.
//
// It notices when the form is being sent and switches itself off until
// the answer comes back, so a second tap does nothing.

import { useFormStatus } from "react-dom";

export function SubmitButton({ className, label }: { className: string; label: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? "Creating..." : label}
    </button>
  );
}
