"use client";

import { useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import DotsBoard from "../components/DotsBoard";

export default function PlayPage() {
  const [roomId, setRoomId] = useState("");
  const [playerId, setPlayerId] = useState("p1");
  const [state, setState] = useState<any>(null);
  const socketRef = useRef<Socket | null>(null);

  const joinRoom = () => {
    if (!roomId || !playerId) return alert("Enter roomId and playerId");
    const s = io("http://localhost:4001", { transports: ["websocket"] });
    socketRef.current = s;
    s.on("connect", () => s.emit("room.join", { roomId, playerId }));
    s.on("game.state", (st) => setState(st));
    s.on("game.events", (ev) => console.log("events:", ev));
    s.on("error", (e) => console.warn("socket error:", e));
  };

  const onMove = (edge: { a: { r: number; c: number }; b: { r: number; c: number } }) => {
    socketRef.current?.emit("game.move", { a: [edge.a.r, edge.a.c], b: [edge.b.r, edge.b.c] });
  };

  return (
    <div style={{ padding: 20, color: "white", background: "#0b1020", minHeight: "100vh" }}>
      <h1>Dots & Boxes – Play</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          style={{ width: 240 }}
        />
        <input
          placeholder="Player ID (p1/p2)"
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          style={{ width: 140 }}
        />
        <button onClick={joinRoom}>Join</button>
      </div>

      {state ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <strong>Current:</strong> {state.currentPlayer} &nbsp;|&nbsp; 
            <strong>Remaining edges:</strong> {state.remainingEdges}
          </div>
          <DotsBoard rows={state.rows} cols={state.cols} edges={state.edges} onMove={onMove} />
          <pre style={{ background: "#111", color: "#0f0", padding: 12, borderRadius: 8, marginTop: 16 }}>
            {JSON.stringify({ scores: state.scores, owners: state.owners, finished: state.finished }, null, 2)}
          </pre>
        </>
      ) : (
        <p>Join a room to see the board.</p>
      )}
    </div>
  );
}
