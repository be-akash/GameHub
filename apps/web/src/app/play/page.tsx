"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter, useSearchParams } from "next/navigation";
import DotsBoard from "../components/DotsBoard";
import Toast from "../components/Toast";

const API_URL = "http://localhost:4002";
const WS_URL = "http://localhost:4001";

/** Winner overlay */
function WinnerModal({
  open,
  scores,
  colors,
  onClose,
}: {
  open: boolean;
  scores: Record<string, number>;
  colors: Record<string, string>;
  onClose: () => void;
}) {
  if (!open) return null;
  const entries = Object.entries(scores || {});
  const sorted = entries.sort((a, b) => (b[1] as number) - (a[1] as number));
  const top = sorted[0];
  const winner = top?.[0] ?? "n/a";
  const maxScore = top?.[1] ?? 0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: "min(520px, 92vw)",
          background: "#0e1530",
          border: "1px solid #24306b",
          borderRadius: 14,
          padding: 16,
          color: "white",
          boxShadow: "0 12px 60px rgba(0,0,0,0.45)",
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 12 }}>🏆 Game Over</h2>
        <div style={{ marginBottom: 8 }}>
          <strong>Winner: </strong>
          <span style={{ color: colors[winner] || "#fff" }}>{winner}</span> &nbsp;({maxScore})
        </div>

        <div style={{ marginTop: 10, background: "#101738", padding: 10, borderRadius: 10 }}>
          <div style={{ marginBottom: 6, opacity: 0.85 }}>Final scores</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {sorted.map(([p, s]) => (
              <div
                key={p}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#0b1020",
                  border: "1px solid #1c2a59",
                  color: colors[p] || "#fff",
                }}
              >
                {p}: {s as number}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <a href="/create" style={{ textDecoration: "none" }}>
            <button style={{ padding: "8px 12px" }}>Play again</button>
          </a>
          <button
            onClick={onClose}
            style={{ padding: "8px 12px", background: "transparent", border: "1px solid #33406b", color: "#cbd5e1" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlayPage() {
  const router = useRouter();
  const search = useSearchParams();

  const initialRoom = search.get("room") ?? "";
  const initialAs = decodeURIComponent(search.get("as") ?? "p1");

  const [roomId, setRoomId] = useState(initialRoom);
  const [playerId, setPlayerId] = useState(initialAs);
  const [state, setState] = useState<any>(null);
  const [joined, setJoined] = useState(false);
  const [colors, setColors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ show: boolean; msg: string }>({ show: false, msg: "" });
  const [isSending, setIsSending] = useState(false);     // 👈 in-flight guard

  const sRef = useRef<Socket | null>(null);
  const lastJoinRef = useRef<{ roomId: string; playerId: string } | null>(null);

  // Sounds
  const clickAudioRef = useRef<HTMLAudioElement | null>(null);
  const scoreAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (initialRoom && initialAs && !joined) {
      joinRoom(initialRoom, initialAs, { pushUrl: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(msg: string) {
    setToast({ show: true, msg });
  }

  async function fetchRoomMeta(id: string) {
    try {
      const res = await fetch(`${API_URL}/rooms/${id}`);
      const data = await res.json();
      if (data?.meta?.colors && typeof data.meta.colors === "object") {
        setColors(data.meta.colors);
      }
    } catch {
      /* ignore */
    }
  }

  function setupSocketListeners(s: Socket) {
    // Prevent duplicate bindings
    s.removeAllListeners("game.state");
    s.removeAllListeners("game.events");
    s.removeAllListeners("error");
    s.removeAllListeners("reconnect");
    s.removeAllListeners("connect");
    s.removeAllListeners("disconnect");

    s.on("game.state", (st) => {
      setState(st);
      setIsSending(false); // release click lock when state arrives
    });

    s.on("game.events", (ev: any[]) => {
      // play score sound if any score event
      if (Array.isArray(ev) && ev.some((e) => e?.type === "score")) {
        scoreAudioRef.current?.play().catch(() => {});
      }
    });

    s.on("error", (e) => console.warn("socket error:", e));

    // Reconnect & auto re-join
    s.on("connect", () => {
      if (lastJoinRef.current) {
        const { roomId: r, playerId: p } = lastJoinRef.current;
        s.emit("room.join", { roomId: r, playerId: p });
        setJoined(true);
      }
    });

    s.on("disconnect", () => {
      setJoined(false);
    });
  }

  function ensureSocket(): Socket {
    if (sRef.current && sRef.current.connected) return sRef.current;
    const s = io(WS_URL, { transports: ["websocket"], reconnection: true, autoConnect: true });
    sRef.current = s;
    setupSocketListeners(s);
    return s;
  }

  async function createRoom() {
    try {
      const res = await fetch(`${API_URL}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: "dots-and-boxes", rows: 8, cols: 8, players: ["p1", "p2"] }),
      });
      const data = await res.json();
      if (!data.roomId) return showToast("Failed to create room");
      setRoomId(data.roomId);
      router.replace(`/play?room=${data.roomId}&as=${encodeURIComponent("p1")}`);
      joinRoom(data.roomId, "p1", { pushUrl: false });
    } catch {
      showToast("Error creating room");
    }
  }

  function joinRoom(room: string, who: string, opts: { pushUrl?: boolean } = {}) {
    if (!room) return showToast("Enter a room ID");
    const s = ensureSocket();

    // store last successful join intent
    lastJoinRef.current = { roomId: room, playerId: who };

    if (s.connected) {
      s.emit("room.join", { roomId: room, playerId: who });
      setJoined(true);
      setRoomId(room);
      setPlayerId(who);
      if (opts.pushUrl !== false) router.replace(`/play?room=${room}&as=${encodeURIComponent(who)}`);
      fetchRoomMeta(room);
      showToast(`Joined as ${who}`);
    } else {
      s.once("connect", () => {
        s.emit("room.join", { roomId: room, playerId: who });
        setJoined(true);
        setRoomId(room);
        setPlayerId(who);
        if (opts.pushUrl !== false) router.replace(`/play?room=${room}&as=${encodeURIComponent(who)}`);
        fetchRoomMeta(room);
        showToast(`Joined as ${who}`);
      });
    }
  }

  function handleManualJoin() {
    if (!roomId) return showToast("Enter a room ID");
    if (!playerId.trim()) return showToast("Player name cannot be empty");
    joinRoom(roomId, playerId);
  }

  function copyLink(asName?: string) {
    const as = encodeURIComponent(asName ?? playerId);
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/play?room=${roomId}&as=${as}`
        : `/play?room=${roomId}&as=${as}`;
    navigator.clipboard.writeText(url).then(
      () => showToast(`Copied invite link (${decodeURIComponent(as)})`),
      () => showToast("Copy failed")
    );
  }

  const myTurn = state && state.currentPlayer === playerId;
  const totalEdges = state ? (state.rows + 1) * state.cols + (state.cols + 1) * state.rows : 0;

  const onMove = (edge: { a: { r: number; c: number }; b: { r: number; c: number } }) => {
    if (!state || state.finished) return;
    if (isSending) return;                 // ⛔ prevent double-click spam
    setIsSending(true);
    clickAudioRef.current?.play().catch(() => {});
    sRef.current?.emit("game.move", { a: [edge.a.r, edge.a.c], b: [edge.b.r, edge.b.c] });

    // Safety net: auto-release lock if no state arrives (packet loss)
    setTimeout(() => setIsSending(false), 350);
  };

  return (
    <div
      style={{
        padding: 16,
        color: "white",
        background: "#0b1020",
        minHeight: "100vh",
      }}
    >
      {/* mobile-friendly width container */}
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ margin: "8px 0 16px" }}>Dots & Boxes – Play</h1>

        {/* Create / Share */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 10,
            alignItems: "center",
            flexWrap: "wrap", // stack on mobile
          }}
        >
          <button onClick={createRoom} style={{ padding: "10px 14px" }} disabled={joined}>
            Quick Create (p1/p2)
          </button>
          <a href="/create" style={{ marginLeft: 4, color: "#9ab4ff" }}>
            Custom Create
          </a>
          <span style={{ opacity: 0.85, minWidth: 180 }}>
            {roomId ? `Room: ${roomId}` : "No room yet — create or paste an ID"}
          </span>
          <button onClick={() => copyLink()} disabled={!roomId} title="Copy your invite link" style={{ padding: "10px 14px" }}>
            Copy My Link
          </button>
        </div>

        {/* Join */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 12,
            flexWrap: "wrap", // mobile stack
          }}
        >
          <input
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            style={{ width: 240, padding: 10 }}
            disabled={joined}
          />
          <input
            placeholder="Your player name"
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            style={{ width: 200, padding: 10 }}
            disabled={joined}
          />
          <button onClick={handleManualJoin} disabled={joined} style={{ padding: "10px 14px" }}>
            Join
          </button>
        </div>

        {/* live region for turn changes (a11y) */}
        <div aria-live="polite" role="status" style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}>
          {state ? (state.currentPlayer === playerId ? "Your turn" : "Opponent's turn") : ""}
        </div>

        {/* Status + Board */}
        {state ? (
          <>
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                marginBottom: 10,
                background: "#0e1530",
                padding: 10,
                borderRadius: 10,
                border: "1px solid #24306b",
                flexWrap: "wrap",
              }}
            >
              <span>
                <strong>Current:</strong>{" "}
                <span style={{ color: (colors as any)[state.currentPlayer] || "#fff" }}>{state.currentPlayer}</span>
              </span>
              <span>
                <strong>You:</strong> <span style={{ color: (colors as any)[playerId] || "#fff" }}>{playerId}</span>
              </span>
              <span>
                <strong>Turn:</strong> {state.currentPlayer === playerId ? "✅ Your turn" : "⌛ Opponent"}
              </span>
              <span>
                <strong>Remaining edges:</strong> {state.remainingEdges} / {totalEdges}
              </span>
              <span>
                <strong>Scores:</strong>{" "}
                {Object.entries(state.scores || {}).map(([p, s]) => (
                  <span key={p} style={{ marginRight: 8, color: (colors as any)[p] || "#fff" }}>
                    {p}:{s as any}
                  </span>
                ))}
              </span>
            </div>

            {/* Board wrapper with turn pulse */}
            <div
              style={{
                display: "inline-block",
                padding: 8,
                borderRadius: 14,
                boxShadow:
                  state.finished
                    ? "none"
                    : state.currentPlayer === playerId
                    ? "0 0 0 3px rgba(43,84,255,0.35)"
                    : "0 0 0 1px rgba(255,255,255,0.08)",
                transition: "box-shadow 180ms ease",
                maxWidth: "100%",
                overflowX: "auto",
              }}
            >
              <DotsBoard
                rows={state.rows}
                cols={state.cols}
                edges={state.edges}
                edgeOwners={state.edgeOwners}
                owners={state.owners}
                currentPlayer={state.currentPlayer}
                myPlayerId={playerId}
                onMove={onMove}
                colors={colors}
                disabled={isSending || state.finished}  // 👈 disable while sending / when finished
              />
            </div>

            <WinnerModal
              open={!!state.finished}
              scores={state.scores || {}}
              colors={colors}
              onClose={() => {
                // optional: just dismiss; or navigate to /create
                // router.push("/create");
              }}
            />
          </>
        ) : (
          <p>Join a room to see the board.</p>
        )}
      </div>

      {/* Sounds (click + score) */}
      <audio ref={clickAudioRef} preload="auto" src="data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA..." />
      <audio ref={scoreAudioRef} preload="auto" src="data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAA..." />

      <Toast message={toast.msg} show={toast.show} onHide={() => setToast({ show: false, msg: "" })} />
    </div>
  );
}
