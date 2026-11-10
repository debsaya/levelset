"use client";
import { useState } from "react";
import { Button, Card, CopyButton, useEscape } from "./ui";

/** An email the buyer checks, edits, copies or opens in their own mail app, then marks as sent. Nothing is sent from here. */
export function EmailDraftModal({ title, hint, to, initial, sentLabel, onSent, onClose }: { title: string; hint?: string; to: string; initial: { subject: string; body: string }; sentLabel: string; onSent: () => void; onClose: () => void }) {
  useEscape(onClose);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const openMail = () => {
    window.location.href = `mailto:${to ? encodeURIComponent(to).replace(/%2C/g, ",") : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 sm:p-6" onClick={onClose}>
      <Card className="flex max-h-full w-[720px] max-w-full flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3" onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="font-semibold">{title}</div>
            <div className="text-xs text-muted">{hint || "Check the email, send it from your own mail, then mark it as sent."}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted">
            ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
          <div className="text-[12px] text-muted">{to ? `To: ${to.split(",").join(", ")}` : "No email address on file"}</div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" className="rounded-lg border border-line px-3 py-2 text-[13px] font-medium outline-none focus:border-kraft" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body" rows={14} className="min-h-[240px] flex-1 resize-y rounded-lg border border-line px-3 py-2.5 font-sans text-[13px] leading-relaxed outline-none focus:border-kraft" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="text-[12px] text-muted">Demo: nothing is sent from here. Send it from your own email, then mark it as sent.</div>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={() => `Subject: ${subject}\n\n${body}`} label="Copy email" />
            <Button onClick={openMail} disabled={!to}>
              Open email
            </Button>
            <Button variant="primary" onClick={onSent}>
              {sentLabel}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
