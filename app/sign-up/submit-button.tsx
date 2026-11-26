"use client";

// The "Check my details" button.
//
// It notices when the form is being sent and switches itself off until
// the answer comes back, so a second tap does nothing.

import { useFormStatus } from "react-dom";

export function SubmitButton({ className }: { className: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? "Checking your identity..." : "Check my details"}
    </button>
  );
}
