/** Copy text to the clipboard. Tries the old way first (works straight from a click, even in embedded frames), then the modern API, and never waits forever for it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) return true;
  } catch {
    // fall through to the modern API
  }
  try {
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 1500))]);
    return true;
  } catch {
    return false;
  }
}
