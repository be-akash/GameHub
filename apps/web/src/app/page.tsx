// apps/web/src/app/page.tsx
"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1020" }}>
      <div style={{ width: "min(960px, 92vw)", color: "white" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 36, margin: 0 }}>GameHub</h1>
          <p style={{ opacity: 0.8, marginTop: 6 }}>Multiplayer turn-based games</p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
          <article style={{ background: "#121933", borderRadius: 14, padding: 16, border: "1px solid #1d2550" }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Dots & Boxes</h2>
            <p style={{ marginTop: 0, opacity: 0.9 }}>
              Connect adjacent dots to make boxes. Completing a box gives you another turn.
            </p>
            {/* <Link
              href="/play"
              style={{
                display: "inline-block",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                background: "#2b54ff",
                color: "white",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Play
            </Link> */}
            <Link href="/create" style={{
                display: "inline-block",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                background: "#2b54ff",
                color: "white",
                textDecoration: "none",
                fontWeight: 600,
              }}>Create custom game</Link>
          </article>

          {/* Future games go here as more <article> cards */}
          <article
            aria-disabled
            style={{
              background: "#0e1530",
              borderRadius: 14,
              padding: 16,
              border: "1px dashed #24306b",
              opacity: 0.6,
            }}
          >
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>More games (coming soon)</h2>
            <p style={{ marginTop: 0 }}>Chess, Checkers, …</p>
          </article>
        </section>
      </div>
    </main>
  );
}
