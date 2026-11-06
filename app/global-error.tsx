"use client";
import Recover from "@/components/Recover";

export default function GlobalError({ error }: { error: unknown }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Recover error={error} />
      </body>
    </html>
  );
}
