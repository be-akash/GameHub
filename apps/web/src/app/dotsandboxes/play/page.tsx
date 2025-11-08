import { Suspense } from "react";
import PlayBody from "./PlayBody";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div style={{ color: "#9ab4ff", padding: 16 }}>Loading…</div>}>
      <PlayBody />
    </Suspense>
  );
}
