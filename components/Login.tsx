"use client";
import { useState } from "react";
import { hasSavedReading } from "@/lib/store";
import { Button } from "./ui";

export type Entry = "fresh" | "example" | "resume";

/** A demo sign-in. Nothing is checked or sent anywhere: it exists so the product opens the way a real one would. */
export default function Login({ hasWork, onEnter }: { hasWork: boolean; onEnter: (email: string, entry: Entry) => void }) {
  const [email, setEmail] = useState("ananya.rao@saffronleaf.example");
  const ok = /.+@.+\..+/.test(email.trim());
  const go = (e: Entry) => ok && onEnter(email.trim(), e);

  return (
    <div className="grid min-h-screen place-items-center bg-panel px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink text-[15px] font-bold text-white">L</span>
          <span className="text-[20px] font-semibold tracking-tight">Levelset</span>
        </div>
        <div className="rounded-2xl border border-line bg-white p-7 shadow-sm">
          <h1 className="text-[18px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">Turn a pile of vendor quotes into one comparison and a decision you can defend.</p>

          <form className="mt-5 space-y-3" onSubmit={(e) => e.preventDefault()} autoComplete="off">
            <label className="block text-[12px] font-medium text-muted">
              Work email
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="levelset-demo-email" autoComplete="off" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[14px] text-ink outline-none focus:border-kraft" />
            </label>
            <label className="block text-[12px] font-medium text-muted">
              Password
              <input type="password" name="levelset-demo-password" autoComplete="new-password" placeholder="Any password works in the demo" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-[14px] text-ink outline-none placeholder:text-muted/70 focus:border-kraft" />
            </label>
          </form>

          <div className="mt-5 text-[12px] font-medium text-muted">Sign in and open</div>
          <div className="mt-2 space-y-2">
            {hasWork && (
              <button disabled={!ok} onClick={() => go("resume")} className="block w-full rounded-xl bg-ink px-4 py-3 text-left text-white disabled:opacity-50">
                <div className="text-[14px] font-semibold">Continue where you left off</div>
                <div className="text-[12px] text-white/70">Your quotes, decisions and notes from this browser</div>
              </button>
            )}
            <button disabled={!ok} onClick={() => go("fresh")} className={hasWork ? "block w-full rounded-xl border border-line bg-white px-4 py-3 text-left hover:bg-panel disabled:opacity-50" : "block w-full rounded-xl bg-ink px-4 py-3 text-left text-white disabled:opacity-50"}>
              <div className="text-[14px] font-semibold">Start the demo from the beginning</div>
              <div className={hasWork ? "text-[12px] text-muted" : "text-[12px] text-white/70"}>The request is drafted. Send it, read the replies, compare, decide{hasWork ? ". Clears your earlier work." : "."}</div>
            </button>
            <button disabled={!ok} onClick={() => go("example")} className="block w-full rounded-xl border border-line bg-white px-4 py-3 text-left hover:bg-panel disabled:opacity-50">
              <div className="text-[14px] font-semibold">Open the finished example</div>
              <div className="text-[12px] text-muted">{hasSavedReading ? "All five quotes already read. Lands on the recommended award." : "The request is sent and five replies are waiting. Reading them takes about a minute."}{hasWork ? " Clears your earlier work." : ""}</div>
            </button>
          </div>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-muted">Demo sign-in. Nothing is checked or stored on a server, so please don&apos;t type a real password. The companies and quotes are made up.</p>
      </div>
    </div>
  );
}
