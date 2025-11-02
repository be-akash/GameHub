"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Toast from "../components/Toast";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";

export default function CreatePage() {
  const router = useRouter();

  const [size, setSize] = useState(5); // 5..40
  const [p1, setP1] = useState("p1");
  const [p2, setP2] = useState("p2");
  const [c1, setC1] = useState("#2b54ff");
  const [c2, setC2] = useState("#ff3b3b");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatEnabled, setChatEnabled] = useState(false);

  // post-create UI
  const [roomId, setRoomId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ show: boolean; msg: string }>({ show: false, msg: "" });

  const clamp = (n: number) => Math.max(5, Math.min(40, n));
  const showToast = (msg: string) => setToast({ show: true, msg });

  const urlFor = (asName: string) =>
    typeof window !== "undefined"
      ? `${window.location.origin}/play?room=${roomId}&as=${encodeURIComponent(asName)}`
      : `/play?room=${roomId}&as=${encodeURIComponent(asName)}`;

  async function handleCreate() {
    setError(null);
    const s = clamp(Number(size));
    if (!p1.trim() || !p2.trim()) return setError("Player names cannot be empty");
    if (p1 === p2) return setError("Player names must be different");

    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: "dots-and-boxes",
          rows: s,
          cols: s,
          players: [p1, p2],
          meta: { colors: { [p1]: c1, [p2]: c2 }, chatEnabled },
          owner: p1,  
           locked: false
        }),
      });
      const data = await res.json();
      if (!data.roomId) {
        setError("Failed to create room");
        setBusy(false);
        return;
      }
      setRoomId(data.roomId);
      showToast("Room created. Copy invite or start game!");
    } catch (e) {
      console.error(e);
      setError("Error creating room");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, label?: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(label ? `Copied ${label}` : "Copied"))
      .catch(() => showToast("Copy failed"));
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0b1020", color: "white", padding: 20 }}>
      <h1>Create Game</h1>

      {/* Config form (disabled after create) */}
      <div style={{ display: "grid", gap: 12, maxWidth: 640, opacity: roomId ? 0.6 : 1 }}>
        <label>
          <div>Board size (5–40)</div>
          <input
            type="number"
            min={5}
            max={40}
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value || "5", 10))}
            style={{ width: 120, padding: 8 }}
            disabled={!!roomId}
          />
          <div style={{ opacity: 0.7, marginTop: 4 }}>Board will be {clamp(size)} × {clamp(size)}</div>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
          <label>
            <div>Player 1 name</div>
            <input value={p1} onChange={(e) => setP1(e.target.value)} style={{ width: "100%", padding: 8 }} disabled={!!roomId} />
          </label>
          <label>
            <div>Color</div>
            <input type="color" value={c1} onChange={(e) => setC1(e.target.value)} style={{ width: 120, height: 40 }} disabled={!!roomId} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
          <label>
            <div>Player 2 name</div>
            <input value={p2} onChange={(e) => setP2(e.target.value)} style={{ width: "100%", padding: 8 }} disabled={!!roomId} />
          </label>
          <label>
            <div>Color</div>
            <input type="color" value={c2} onChange={(e) => setC2(e.target.value)} style={{ width: 120, height: 40 }} disabled={!!roomId} />
          </label>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
  <input
    type="checkbox"
    checked={chatEnabled}
    onChange={(e) => setChatEnabled(e.target.checked)}
  />
  Enable chat
</label>

        {error && (
          <div style={{ color: "#ff6b6b", background: "#2a0f14", padding: 8, borderRadius: 8, border: "1px solid #5a1f26" }}>
            {error}
          </div>
        )}

        {!roomId ? (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={handleCreate} disabled={busy} style={{ padding: "10px 14px" }}>
              {busy ? "Creating..." : "Create"}
            </button>
            <a href="/" style={{ color: "#9ab4ff" }}>Back to Home</a>
          </div>
        ) : null}
      </div>

      {/* Post-create action panel */}
      {roomId && (
        <div
          style={{
            marginTop: 18,
            background: "#0e1530",
            border: "1px solid #24306b",
            borderRadius: 12,
            padding: 14,
            maxWidth: 640,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Room Created</h2>
          <div style={{ marginBottom: 10 }}>
            <strong>Room code:</strong> {roomId}{" "}
            <button onClick={() => copy(roomId, "room code")} style={{ marginLeft: 8 }}>
              Copy code
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <strong>Your link ({p1}):</strong>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                <code style={{ background: "#101738", padding: "6px 8px", borderRadius: 6, overflowX: "auto" }}>
                  {urlFor(p1)}
                </code>
                <button onClick={() => copy(urlFor(p1), `${p1} link`)}>Copy</button>
                <button onClick={() => router.replace(`/play?room=${roomId}&as=${encodeURIComponent(p1)}`)}>
                  Open & Play
                </button>
              </div>
            </div>

            <div>
              <strong>Invite link ({p2}):</strong>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                <code style={{ background: "#101738", padding: "6px 8px", borderRadius: 6, overflowX: "auto" }}>
                  {urlFor(p2)}
                </code>
                <button onClick={() => copy(urlFor(p2), `${p2} invite link`)}>Copy</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast.msg} show={toast.show} onHide={() => setToast({ show: false, msg: "" })} />
    </div>
  );
}
