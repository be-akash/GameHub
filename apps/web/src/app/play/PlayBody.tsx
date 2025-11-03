"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter, useSearchParams } from "next/navigation";
import DotsBoard from "../components/DotsBoard";
import Toast from "../components/Toast";


const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001";

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

export default function PlayBody() {
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

  // Chat
  const [chat, setChat] = useState<Array<{ from?: string; text: string; at: number; system?: boolean }>>([]);
  const [msg, setMsg] = useState("");
  const [chatEnabled, setChatEnabled] = useState<boolean>(true);      // from server meta
  const [chatPanelVisible, setChatPanelVisible] = useState<boolean>(true); // local toggle
  const playerIdRef = useRef(playerId);

  // Meta (owner/lock)
  const [locked, setLocked] = useState<boolean>(false);
  const [owner, setOwner] = useState<string>("");

  const sRef = useRef<Socket | null>(null);
  const lastJoinRef = useRef<{ roomId: string; playerId: string } | null>(null);

  // Sounds (optional placeholders)
  const clickAudioRef = useRef<HTMLAudioElement | null>(null);
  const scoreAudioRef = useRef<HTMLAudioElement | null>(null);
  const turnAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const [soundReady, setSoundReady] = useState(false);
  const prevTurnRef = useRef<string | null>(null);
  const [edgeHighlights, setEdgeHighlights] = useState<Map<string, number>>(new Map());
  const [boxHighlights, setBoxHighlights] = useState<Map<string, number>>(new Map());
  type Point = { r: number; c: number };
  type EdgeLike =
    | { a: Point | [number, number]; b: Point | [number, number] }
    | [[number, number], [number, number]];
  const prevStateRef = useRef<any | null>(null);

  const isOwner = !!owner && playerId === owner;

  function toPoint(x: any): Point {
    if (Array.isArray(x)) return { r: x[0], c: x[1] };
    return { r: x?.r, c: x?.c };
  }

  function edgeKeyFlexible(e: EdgeLike): string {
    const aRaw = (e as any).a ?? (e as any)[0];
    const bRaw = (e as any).b ?? (e as any)[1];
    const a = toPoint(aRaw);
    const b = toPoint(bRaw);
    const A = `${a.r},${a.c}`;
    const B = `${b.r},${b.c}`;
    return A < B ? `${A}|${B}` : `${B}|${A}`;
  }

  function extractEdgeKeys(s: any): string[] {
    if (!s) return [];

    // 1) edges as an array?
    const e = s.edges;
    if (Array.isArray(e)) {
      try { return e.map((x: any) => edgeKeyFlexible(x)); } catch { /* fallthrough */ }
    }

    // 2) edges as an object map? use its keys if they look like "r,c|r,c"
    if (e && typeof e === "object") {
      const ks = Object.keys(e);
      if (ks.length && ks[0].includes("|")) return ks;
    }

    // 3) edgeOwners as an object map?
    const eo = s.edgeOwners;
    if (eo && typeof eo === "object") {
      const ks = Object.keys(eo);
      if (ks.length) return ks;
    }

    return [];
  }


  /** Return a list of "r,c" keys for squares that are already claimed */
  function extractBoxKeys(s: any): string[] {
    if (!s) return [];

    // 1) owners as 2D array (rows-1 x cols-1)
    const m = s.owners || s.cellOwners || s.boxOwners;
    if (Array.isArray(m)) {
      const out: string[] = [];
      for (let r = 0; r < m.length; r++) {
        const row = m[r] || [];
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          // consider claimed if value is neither undefined nor null nor empty string
          if (v !== undefined && v !== null && `${v}` !== "") out.push(`${r},${c}`);
        }
      }
      if (out.length) return out;
    }

    // 2) owners as object map: { "r,c": "p1", ... }
    const obj = s.owners || s.cellOwners || s.boxOwners;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const ks = Object.keys(obj);
      // Heuristic: keys that look like "r,c"
      if (ks.length && ks[0].includes(",")) {
        // keep only those with truthy owner values
        return ks.filter(k => {
          const v = obj[k];
          return v !== undefined && v !== null && `${v}` !== "";
        });
      }
    }

    // 3) fallback: some servers send a list of completed squares
    if (Array.isArray(s.completedSquares)) {
      // each entry may be {r,c} or [r,c]
      return s.completedSquares.map((x: any) => {
        const r = Array.isArray(x) ? x[0] : x?.r;
        const c = Array.isArray(x) ? x[1] : x?.c;
        return `${r},${c}`;
      });
    }

    return [];
  }


  function cellKey(r: number, c: number) {
    return `${r},${c}`;
  }


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

  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);

  useEffect(() => {
    if (soundReady) return;
    const handler = () => unlockAudio();
    window.addEventListener("pointerdown", handler, { once: true });
    return () => window.removeEventListener("pointerdown", handler);
  }, [soundReady]);

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();

      setEdgeHighlights((old) => {
        let changed = false;
        const next = new Map<string, number>();
        for (const [k, expires] of old) {
          if (expires > now) next.set(k, expires);
          else changed = true;
        }
        return changed ? next : old;
      });

      setBoxHighlights((old) => {
        let changed = false;
        const next = new Map<string, number>();
        for (const [k, expires] of old) {
          if (expires > now) next.set(k, expires);
          else changed = true;
        }
        return changed ? next : old;
      });
    }, 200);

    return () => clearInterval(t);
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

  function unlockAudio() {
    if (soundReady) return;
    const tryPlayAll = async () => {
      try { await clickAudioRef.current?.play(); } catch { }
      try { await scoreAudioRef.current?.play(); } catch { }
      try { await turnAudioRef.current?.play(); } catch { }
      // Pause them immediately so we don't actually hear them now
      clickAudioRef.current?.pause(); clickAudioRef.current!.currentTime = 0;
      scoreAudioRef.current?.pause(); scoreAudioRef.current!.currentTime = 0;
      turnAudioRef.current?.pause(); turnAudioRef.current!.currentTime = 0;
      setSoundReady(true);
    };
    tryPlayAll();
  }

  async function fetchRoomMeta(id: string) {
    try {
      const res = await fetch(`${API_URL}/rooms/${id}`);
      const data = await res.json();
      if (data?.meta?.colors && typeof data.meta.colors === "object") setColors(data.meta.colors);
      if (typeof data?.meta?.chatEnabled === "boolean") {
        setChatEnabled(data.meta.chatEnabled);
        setChatPanelVisible(data.meta.chatEnabled); // default local toggle from server setting
      }
      if (typeof data?.meta?.locked === "boolean") setLocked(data.meta.locked);
      if (typeof data?.meta?.owner === "string") setOwner(data.meta.owner);
    } catch {
      /* ignore */
    }
  }

  function setupSocketListeners(s: Socket) {
    s.removeAllListeners("game.state");
    s.removeAllListeners("game.events");
    s.removeAllListeners("chat.message");
    s.removeAllListeners("chat.system");
    s.removeAllListeners("error");
    s.removeAllListeners("connect");
    s.removeAllListeners("disconnect");
    s.removeAllListeners("room.kicked");

    s.on("game.state", (st) => {
      const prevTurn = prevTurnRef.current;
      const nextTurn = st.currentPlayer;
      if (prevTurn === null) {
        prevTurnRef.current = nextTurn;
      }

      if (soundReady) {
        clickAudioRef.current?.play().catch(() => { });
      }

      // --- Step 1: compute diffs for highlights ---
      const now = Date.now();
      const prevState = prevStateRef.current;

      if (!prevStateRef.current) {
        console.log("[debug] first state", {
          ownersType: Array.isArray(st.owners) ? "matrix" : typeof st.owners,
          ownersSampleRow0: Array.isArray(st.owners) ? st.owners?.[0] : undefined,
          cellOwnersType: Array.isArray(st.cellOwners) ? "matrix" : typeof st.cellOwners,
          cellOwnersSampleRow0: Array.isArray(st.cellOwners) ? st.cellOwners?.[0] : undefined,
          boxOwnersType: typeof st.boxOwners,
          boxOwnersKeys: st.boxOwners ? Object.keys(st.boxOwners).slice(0, 5) : undefined,
          completedSquares: st.completedSquares,
        });
      }



      // EDGE DIFF: new edges since last state (robust to arrays or maps)
      try {
        const prevKeys = new Set(extractEdgeKeys(prevState));
        const nextKeys = new Set(extractEdgeKeys(st));

        const addedNow: string[] = [];
        for (const k of nextKeys) {
          if (!prevKeys.has(k)) addedNow.push(k);
        }

        if (addedNow.length) {
          setEdgeHighlights((old) => {
            const m = new Map(old);
            const expires = Date.now() + 2000; // 2s burn
            for (const k of addedNow) m.set(k, expires);
            return m;
          });
          console.log("[highlight] new edges:", addedNow);
        }
      } catch (err) {
        console.warn("edge diff failed", err);
      }



      // BOX DIFF: owners matrix transition undefined -> some player
      // BOX DIFF: newly claimed squares since last state (robust to arrays or maps)
      try {
        const prevBoxes = new Set(extractBoxKeys(prevState));
        const nextBoxes = new Set(extractBoxKeys(st));

        const newlyClaimed: string[] = [];
        for (const k of nextBoxes) {
          if (!prevBoxes.has(k)) newlyClaimed.push(k);
        }

        if (newlyClaimed.length) {
          setBoxHighlights((old) => {
            const m = new Map(old);
            const expires = Date.now() + 1000; // 1s bomb
            for (const k of newlyClaimed) m.set(k, expires);
            return m;
          });
          console.log("[highlight] new boxes:", newlyClaimed);
        }
      } catch (err) {
        console.warn("box diff failed", err);
      }


      // move along with your existing state updates
      setState(st);
      setIsSending(false);

      // Turn change audio (existing)
      if (prevTurn !== nextTurn) {
        prevTurnRef.current = nextTurn;
        if (nextTurn === playerId && soundReady) {
          turnAudioRef.current?.play().catch(() => { });
        }
      }

      // Save snapshot for next diff
      prevStateRef.current = st;
    });


    s.on("game.events", (ev: any[]) => {
      if (Array.isArray(ev) && ev.some((e) => e?.type === "score")) {
        scoreAudioRef.current?.play().catch(() => { });
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

    s.on("room.kicked", (payload) => {
      showToast(payload?.reason || "You were removed");
      // Optional: navigate away
      router.replace("/create");
    });

    s.on("error", (e) => console.warn("socket error:", e));

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

  // inside PlayPage
  const onMove = (edge: { a: { r: number; c: number }; b: { r: number; c: number } }) => {
    if (!state || state.finished) return;
    if (isSending) return;

    setIsSending(true);
    clickAudioRef.current?.play().catch(() => { });

    const payload = { a: [edge.a.r, edge.a.c], b: [edge.b.r, edge.b.c] };

    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        setIsSending(false);
      }
    };

    // Safety net: release if nothing comes back
    const guard = setTimeout(release, 600);

    sRef.current?.emit("game.move", payload, (resp?: { ok?: true; error?: string }) => {
      clearTimeout(guard);
      if (resp?.error) {
        // ✅ Show the server's validation message
        showToast(resp.error);
        release();
        return;
      }
    });
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
              flexWrap: "wrap", // stacks on small screens
            }}
          >
            {/* LEFT: Board + status (~80%) */}
            <div style={{ flex: chatEnabled && chatPanelVisible ? "1 1 720px" : "1 1 100%", minWidth: 320 }}>
              {/* Room controls / status */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  margin: "8px 0 12px",
                  background: "#0e1530",
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid #24306b",
                  flexWrap: "wrap",
                }}
              >
                <span><strong>Room:</strong> {roomId || "—"}</span>
                <span><strong>Owner:</strong> {owner || "—"}</span>
                <span>
                  <strong>Locked:</strong>{" "}
                  <span style={{ color: locked ? "#f59e0b" : "#22c55e" }}>
                    {locked ? "Yes" : "No"}
                  </span>
                </span>

                {/* Local chat panel toggle (only if room chat is enabled) */}
                {chatEnabled && (
                  <button
                    onClick={() => setChatPanelVisible((v) => !v)}
                    style={{ padding: "6px 10px", marginLeft: 4 }}
                    title={chatPanelVisible ? "Hide chat panel" : "Show chat panel"}
                  >
                    {chatPanelVisible ? "Hide Chat" : "Show Chat"}
                  </button>
                )}

                {/* Owner controls */}
                {isOwner && (
                  <>
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${API_URL}/rooms/${roomId}/lock`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ by: playerId, locked: !locked }),
                          });
                          const data = await res.json();
                          if (data?.error) return showToast(data.error);
                          setLocked(!!data.locked);
                        } catch {
                          showToast("Failed to toggle lock");
                        }
                      }}
                      style={{ padding: "6px 10px", marginLeft: 4 }}
                      title={locked ? "Unlock room" : "Lock room (block new names)"}
                    >
                      {locked ? "Unlock room" : "Lock room"}
                    </button>

                    {/* Quick kick buttons (for each non-owner player) */}
                    {(state?.players || [])
                      .filter((p: string) => p !== owner)
                      .map((p: string) => (
                        <button
                          key={p}
                          onClick={async () => {
                            try {
                              const res = await fetch(`${API_URL}/rooms/${roomId}/kick`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ by: playerId, target: p }),
                              });
                              const data = await res.json();
                              if (data?.error) return showToast(data.error);
                              showToast(`Kicked ${p}`);
                            } catch {
                              showToast("Kick failed");
                            }
                          }}
                          style={{ padding: "6px 10px" }}
                          title={`Kick ${p}`}
                        >
                          Kick {p}
                        </button>
                      ))}
                  </>
                )}
              </div>

              {/* Turn + score strip */}
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
              </div>

              {/* Board */}
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
                  overflowX: "visible",
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
                  edgeHighlights={edgeHighlights}
                  boxHighlights={boxHighlights}
                />

                {/* <span title="Edges highlighted for burn">🔥 edges: {edgeHighlights.size}</span>
                <span title="Boxes highlighted for bomb">💥 boxes: {boxHighlights.size}</span> */}
              </div>

              <WinnerModal
                open={!!state.finished}
                scores={state.scores || {}}
                colors={colors}
                onClose={() => { }}
              />
            </div>

            {/* RIGHT: Chat (~20%) — visible only if server enabled AND user toggled on */}
            {chatEnabled && chatPanelVisible && (
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
                  height: 520,
                }}
              >
                <div ref={chatBoxRef} style={{ padding: 8, overflowY: "auto" }}>
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
                    <button key={e} onClick={() => sendChat(e)} style={{ padding: "0 8px" }} title={`Send ${e}`}>
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

      {!soundReady && (
        <div style={{
          position: "fixed", bottom: 14, right: 14, zIndex: 50,
          background: "#101738", border: "1px solid #24306b", borderRadius: 10, padding: "8px 12px"
        }}>
          <span style={{ marginRight: 8 }}>🔊 Enable sound</span>
          <button onClick={unlockAudio} style={{ padding: "6px 10px" }}>Allow</button>
        </div>
      )}

      {/* Sounds (click + score) */}

      <audio ref={clickAudioRef} preload="auto" src="/audio/click.mp3" />
      <audio ref={scoreAudioRef} preload="auto" src="/audio/score.mp3" />
      <audio ref={turnAudioRef} preload="auto" src="/audio/chance.mp3" />

      <Toast message={toast.msg} show={toast.show} onHide={() => setToast({ show: false, msg: "" })} />
    </div>
  );
}
