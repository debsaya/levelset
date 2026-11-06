"use client";
import Recover from "@/components/Recover";

export default function Error({ error }: { error: unknown }) {
  return <Recover error={error} />;
}
