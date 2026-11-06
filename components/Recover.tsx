"use client";
import { useEffect } from "react";

const CHUNK = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported|Importing a module script failed|error loading dynamically/i;

/** What to show when the app fails to draw. A page that was open (or cached) across a new publish is the usual cause, and one fresh load fixes it. */
export default function Recover({ error }: { error: unknown }) {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const stale = CHUNK.test(msg);
  useEffect(() => {
    // A new version was published under this tab: reload once, on our own, to pick it up.
    if (stale) {
      try {
        if (sessionStorage.getItem("levelset-reloaded") !== "1") {
          sessionStorage.setItem("levelset-reloaded", "1");
          location.reload();
        }
      } catch {}
    }
  }, [stale]);

  const clearAndReload = () => {
    try {
      localStorage.removeItem("levelset-state-v3");
    } catch {}
    location.reload();
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f7f9", padding: 24, fontFamily: "system-ui, sans-serif", color: "#14161a" }}>
      <div style={{ maxWidth: 440, background: "#fff", border: "1px solid #e3e5ea", borderRadius: 16, padding: 28, textAlign: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{stale ? "A new version was just published" : "This page hit a problem"}</div>
        <p style={{ marginTop: 8, fontSize: 13.5, color: "#6b7280", lineHeight: 1.5 }}>{stale ? "Reload to pick it up. Your work in this browser is kept." : "Reloading usually fixes it. If it comes back, clear the saved data in this browser and start the sample event again."}</p>
        <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => location.reload()} style={{ background: "#14161a", color: "#fff", border: 0, borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
            Reload
          </button>
          {!stale && (
            <button onClick={clearAndReload} style={{ background: "#fff", border: "1px solid #e3e5ea", borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer" }}>
              Clear saved data and reload
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
