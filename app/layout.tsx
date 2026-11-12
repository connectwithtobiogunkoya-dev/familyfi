import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "FamilyFi",
  description: "FamilyFi: one shared wallet for couples, with labelled pots.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <main style={{ padding: "24px 16px" }}>{children}</main>
      </body>
    </html>
  );
}
