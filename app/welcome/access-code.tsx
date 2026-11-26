"use client";

// The access code in large letters, with its "Copy" button.
//
// The button copies the code exactly as shown on the screen. If the
// browser refuses to copy (some do, without permission), the code's text
// is selected instead, so the person can copy it themselves. The code is
// never stored anywhere in the browser.

import { useEffect, useRef, useState } from "react";

import styles from "./page.module.css";

export function AccessCode({ code }: { code: string }) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [copied, setCopied] = useState(false);

  // "Copied" goes back to "Copy" after two seconds.
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  function selectText() {
    const element = textRef.current;
    const selection = window.getSelection();
    if (element === null || selection === null) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function copy() {
    const visible = textRef.current?.textContent ?? "";
    try {
      if (navigator.clipboard === undefined) {
        throw new Error("no clipboard");
      }
      await navigator.clipboard.writeText(visible);
      setCopied(true);
    } catch {
      selectText();
    }
  }

  return (
    <div className={styles.codeCard}>
      <p ref={textRef} className={styles.code}>
        {code}
      </p>
      <button type="button" className={styles.copy} onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
