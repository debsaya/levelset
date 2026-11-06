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
          <h1 className="text-[18px] font-semibold tracking-tight">Sign in to Levelset</h1>
          <p className="mt-1.5 text-[13px] text-muted">Turn a pile of vendor quotes into one comparison and a decision you can defend.</p>
          <Button variant="primary" className="mt-6 w-full justify-center py-2.5 text-[14px]" onClick={() => onEnter(email)}>
            Continue with company SSO
          </Button>
          <div className="mt-3 text-[11.5px] text-muted">
            Signs in as <span className="text-ink">{email}</span>
          </div>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-muted">Demo sign-in. No password and nothing stored on a server. The companies and quotes are made up.</p>
      </div>
    </div>
  );
}
