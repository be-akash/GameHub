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
  const [isSending, setIsSending] = useState(false);
  const [chat, setChat] = useState<Array<{ from?: string; text: string; at: number; system?: boolean }>>([]);
  const [msg, setMsg] = useState("");
  const [chatEnabled, setChatEnabled] = useState<boolean>(true);
  const [meta, setMeta] = useState<any>(null);
  

  const sRef = useRef<Socket | null>(null);
  const lastJoinRef = useRef<{ roomId: string; playerId: string } | null>(null);

  // Sounds (optional placeholders)
  const clickAudioRef = useRef<HTMLAudioElement | null>(null);
  const scoreAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialRoom && initialAs && !joined) {
      joinRoom(initialRoom, initialAs, { pushUrl: false });
    }
    return () => {
      if (sRef.current) {
        sRef.current.removeAllListeners();
        sRef.current.disconnect();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(msg: string) {
    setToast({ show: true, msg });
  }

  function scrollChatToBottom() {
    const el = chatBoxRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  async function fetchRoomMeta(id: string) {
  try {
    const res = await fetch(`${API_URL}/rooms/${id}`);
    const data = await res.json();
    if (data) setMeta(data.meta || null);
    if (data?.meta?.colors && typeof data.meta.colors === "object") {
      setColors(data.meta.colors);
    }
    if (typeof data?.meta?.chatEnabled === "boolean") {
      setChatEnabled(data.meta.chatEnabled);
    }
  } catch {}
}


  function setupSocketListeners(s: Socket) {
    s.removeAllListeners("game.state");
    s.removeAllListeners("game.events");
    s.removeAllListeners("chat.message");
    s.removeAllListeners("chat.system");
    s.removeAllListeners("error");
    s.removeAllListeners("connect");
    s.removeAllListeners("disconnect");

    s.on("game.state", (st) => {
      setState(st);
      setIsSending(false);
    });

    s.on("game.events", (ev: any[]) => {
      if (Array.isArray(ev) && ev.some((e) => e?.type === "score")) {
        scoreAudioRef.current?.play().catch(() => {});
      }
    });

    s.on("chat.message", (m) => {
      setChat((old) => {
        const next = [...old.slice(-99), m];
        return next;
      });
      scrollChatToBottom();
    });

    s.on("chat.system", (m) => {
      setChat((old) => {
        const next = [...old.slice(-99), { ...m, system: true }];
        return next;
      });
      scrollChatToBottom();
    });

    s.on("error", (e) => console.warn("socket error:", e));

    s.on("connect", () => {
      if (lastJoinRef.current) {
        const { roomId: r, playerId: p } = lastJoinRef.current;
        s.emit("room.join", { roomId: r, playerId: p }, (resp: any) => {
          if (resp?.error) return showToast(resp.error);
          setJoined(true);
        });
        
      }
    });

    // after you create the socket (inside setupSocketListeners)
s.on("room.kicked", (payload) => {
  // Show toast and optionally redirect
  console.warn("You were kicked:", payload);
  // show a toast
  // router.replace("/create"); // optional
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

    // (temporary dev logger)
    s.onAny((event, ...args) => {
      try {
        console.log(`[ws:onAny] event="${event}" args=`, args);
      } catch {
        console.log(`[ws:onAny] event="${event}" (args not serializable)`);
      }
    });

    lastJoinRef.current = { roomId: room, playerId: who };

    const doJoinedSideEffects = () => {
      setJoined(true);
      setRoomId(room);
      setPlayerId(who);
      if (opts.pushUrl !== false) router.replace(`/play?room=${room}&as=${encodeURIComponent(who)}`);
      fetchRoomMeta(room);
      
      showToast(`Joined as ${who}`);
    };

    if (s.connected) {
      s.emit("room.join", { roomId: room, playerId: who });
      doJoinedSideEffects();
    } else {
      s.once("connect", () => {
        s.emit("room.join", { roomId: room, playerId: who });
        doJoinedSideEffects();
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

  const totalEdges = state ? (state.rows + 1) * state.cols + (state.cols + 1) * state.rows : 0;

  const onMove = (edge: { a: { r: number; c: number }; b: { r: number; c: number } }) => {
    if (!state || state.finished) return;
    if (isSending) return;
    setIsSending(true);
    clickAudioRef.current?.play().catch(() => {});
    sRef.current?.emit("game.move", { a: [edge.a.r, edge.a.c], b: [edge.b.r, edge.b.c] });
    setTimeout(() => setIsSending(false), 350);
  };

  // Chat send helpers (with ack + roomId)
  const sendChat = (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (!joined || !roomId) {
      showToast("Join a room first");
      return;
    }
    sRef.current?.emit("chat.message", { text: t, roomId }, (resp: any) => {
      if (resp?.error) showToast(resp.error);
    });
    // after sending, scroll to bottom
    scrollChatToBottom();
  };

  return (
    <div style={{ padding: 16, color: "white", background: "#0b1020", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ margin: "8px 0 16px" }}>Dots & Boxes – Play</h1>

        {/* Top actions */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 10,
            alignItems: "center",
            flexWrap: "wrap",
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

        {/* Join inputs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
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

        {/* live region for turn changes */}
        <div
          aria-live="polite"
          role="status"
          style={{ position: "absolute", left: -9999, top: "auto", width: 1, height: 1, overflow: "hidden" }}
        >
          {state ? (state.currentPlayer === playerId ? "Your turn" : "Opponent's turn") : ""}
        </div>

        {state ? (
          <div
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              flexWrap: "wrap",                // stacks on small screens
            }}
          >
            {/* LEFT: Board + status (~80%) */}
            <div style={{ flex: chatEnabled ? "1 1 720px" : "1 1 100%" /* stretch if no chat */ , minWidth: 320 }}>
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
                  <span style={{ color: (colors as any)[state.currentPlayer] || "#fff" }}>
                    {state.currentPlayer}
                  </span>
                </span>
                <span>
                  <strong>You:</strong>{" "}
                  <span style={{ color: (colors as any)[playerId] || "#fff" }}>{playerId}</span>
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
                {meta?.owner === playerId && (
  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
    <button onClick={async ()=>{
      await fetch(`${API_URL}/rooms/${roomId}/lock`, { method:"POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify({ by: playerId, locked: !meta.locked })});
      const r = await fetch(`${API_URL}/rooms/${roomId}`).then(r=>r.json());
      setMeta(r.meta || {});
      showToast(`Room ${r.meta.locked ? "locked" : "unlocked"}`);
    }}>
      {meta.locked ? "Unlock room" : "Lock room"}
    </button>

    {/* Kick dropdown simple */}
    {state?.players?.filter((p:string)=>p!==playerId).map((p:string)=>(
      <button key={p} onClick={async ()=>{
        await fetch(`${API_URL}/rooms/${roomId}/kick`, { method:"POST", headers:{ "Content-Type": "application/json" }, body: JSON.stringify({ by: playerId, target: p })});
        showToast(`Kicked ${p}`);
      }}>Kick {p}</button>
    ))}
  </div>
)}
              </div>

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
                  background: "transparent",
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
                  disabled={isSending || state.finished}
                />
              </div>

              <WinnerModal
                open={!!state.finished}
                scores={state.scores || {}}
                colors={colors}
                onClose={() => {}}
              />
            </div>

            {/* RIGHT: Chat (~20%) */}
            {chatEnabled && (
            <aside
              style={{
                flex: "0 1 320px",          
                minWidth: 260,              
                maxWidth: 420,              
                background: "#0e1530",
                border: "1px solid #24306b",
                borderRadius: 10,
                overflow: "hidden",
                display: "grid",
                gridTemplateRows: "1fr auto",
                height: 520,                // a nice fixed panel height
              }}
            >
              <div
                ref={chatBoxRef}
                style={{ padding: 8, overflowY: "auto" }}
              >
                {chat.map((m, i) => (
                  <div key={i} style={{ opacity: m.system ? 0.75 : 1, marginBottom: 6 }}>
                    {!m.system && (
                      <strong style={{ color: colors[m.from || ""] || "#9ab4ff" }}>{m.from}:</strong>
                    )}{" "}
                    <span>{m.text}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, padding: 8 }}>
                <input
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && msg.trim()) {
                      sendChat(msg);
                      setMsg("");
                    }
                  }}
                  placeholder="Message…"
                  style={{ flex: 1, padding: 8 }}
                />
                {["😀", "👍", "🔥", "🎉", "😮"].map((e) => (
                  <button
                    key={e}
                    onClick={() => sendChat(e)}
                    style={{ padding: "0 8px" }}
                    title={`Send ${e}`}
                  >
                    {e}
                  </button>
                ))}
                <button
                  onClick={() => {
                    if (!msg.trim()) return;
                    sendChat(msg);
                    setMsg("");
                  }}
                >
                  Send
                </button>
              </div>
              </aside>
              )}
          </div>
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
