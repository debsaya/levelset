"use client";
import { Button } from "./ui";

/** A demo single sign-on screen. Nothing is checked or sent anywhere: it exists so the product opens the way a company tool would. */
export default function Login({ onEnter }: { onEnter: (email: string) => void }) {
  const email = "ananya.rao@saffronleaf.example";
  return (
    <div className="grid min-h-screen place-items-center bg-panel px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-[15px] font-bold text-white">L</span>
          <span className="text-[20px] font-semibold tracking-tight">Levelset</span>
        </div>
        <div className="rounded-2xl border border-line bg-white p-7 text-center shadow-sm">
          <h1 className="text-[20px] font-semibold leading-snug tracking-tight">Turn a pile of quotes into one decision that you can defend.</h1>
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-kraft-soft text-[12px] font-semibold text-ink">AR</span>
            <div className="min-w-0">
              <div className="text-[11.5px] text-muted">Signing in as</div>
              <div className="truncate text-[14px] font-medium text-ink">{email}</div>
            </div>
          </div>
          <Button variant="primary" className="mt-3 w-full justify-center py-2.5 text-[14px]" onClick={() => onEnter(email)}>
            Continue with company SSO
          </Button>
        </div>
      </div>
    </div>
  );
}
