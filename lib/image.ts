"use client";

/** Phone photos are often 4-8 MB, more than this host accepts in one request. Shrink big pictures before sending; the text on a quote stays readable at 1800 px.
 *  Anything that is not a large image is returned untouched, and so is the original if shrinking fails or does not help. */
export const PHOTO_LIMIT = 900_000;
export const PHOTO_MAX_SIDE = 1800;

export function targetSize(w: number, h: number, max = PHOTO_MAX_SIDE): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export async function prepFile(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/i.test(f.type) || f.size <= PHOTO_LIMIT) return f;
  try {
    const bmp = await createImageBitmap(f);
    const { w, h } = targetSize(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob: Blob | null = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.82));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return f;
  }
}
