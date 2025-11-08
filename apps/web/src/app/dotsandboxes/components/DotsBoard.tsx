"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** Minimal types */
type Point = { r: number; c: number };
export type Edge = { a: Point; b: Point };

function edgeKey(a: Point, b: Point) {
  const k1 = `${a.r},${a.c}`;
  const k2 = `${b.r},${b.c}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}
function cellKey(r: number, c: number) {
  return `${r},${c}`;
}

/** Parse "r,c|r,c" (also tolerates "r,c-r,c" / "r,c>r,c") -> [{r,c},{r,c}] */
function parseEdgeKey(k: string): [Point, Point] | null {
  if (!k) return null;
  const sep = k.includes("|") ? "|" : k.includes("-") ? "-" : k.includes(">") ? ">" : null;
  if (!sep) return null;
  const [a, b] = k.split(sep);
  const [ar, ac] = a.split(",").map((n) => parseInt(n, 10));
  const [br, bc] = b.split(",").map((n) => parseInt(n, 10));
  if ([ar, ac, br, bc].some((n) => Number.isNaN(n))) return null;
  return [{ r: ar, c: ac }, { r: br, c: bc }];
}

type OwnersMap = Record<string, string | null>;
type OwnersMatrix = Array<Array<string | null | undefined>>;
function getOwnerForCell(owners: OwnersMap | OwnersMatrix, r: number, c: number) {
  if (Array.isArray(owners)) return owners[r]?.[c] ?? null;
  return owners[cellKey(r, c)] ?? null;
}

export default function DotsBoard({
  rows,                 // number of BOXES vertically
  cols,                 // number of BOXES horizontally
  edges,                // taken edges keyed by DOT coords "r,c|r,c"
  edgeOwners = {},      // edge->owner
  owners,               // box owners: matrix or "r,c" map
  currentPlayer,
  myPlayerId,
  colors = {},
  disabled = false,
  onMove,
  edgeHighlights,
  boxHighlights,
  finished,
}: {
  rows: number; cols: number;
  edges: Record<string, 1>;
  edgeOwners?: Record<string, string>;
  owners: OwnersMap | OwnersMatrix;
  currentPlayer: string;
  myPlayerId: string;
  colors?: Record<string, string>;
  disabled?: boolean;
  onMove: (edge: Edge) => void;
  edgeHighlights?: Map<string, number>;
  boxHighlights?: Map<string, number>;
  finished?: boolean;
}) {
  const myTurn = currentPlayer === myPlayerId;

  const prevFinishedRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (!overlayRef.current) return;
    if (finished && !prevFinishedRef.current) {
      // mega burst on win
      fireConfetti(overlayRef.current, 140, 2.0);
    }
    prevFinishedRef.current = finished;
  }, [finished]);


  /** ———————————————————————————
   *  Responsive square sizing
   *  ——————————————————————————— */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<number>(480); // square side in px (auto)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Keep the board square; take the smaller of width/height if parent constrains height too
      const w = el.clientWidth || 480;
      const h = el.clientHeight || w;
      setSize(Math.min(w, h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // padding scales lightly with size
  const pad = Math.max(12, Math.round(size * 0.035)); // px padding inside svg
  const rowsDots = rows + 1;
  const colsDots = cols + 1;

  // Use separate cellX / cellY so non-square grids still fill the square
  const innerW = Math.max(1, size - 2 * pad);
  const innerH = Math.max(1, size - 2 * pad);
  const cellX = innerW / Math.max(1, cols);
  const cellY = innerH / Math.max(1, rows);

  // Dot radius and stroke widths scale with size
  const dotR = Math.max(3, Math.min(7, Math.round(Math.min(cellX, cellY) * 0.12)));
  const takenStroke = Math.max(4, Math.round(Math.min(cellX, cellY) * 0.22));
  const idleStroke = Math.max(6, Math.round(Math.min(cellX, cellY) * 0.34));

  const toXYdot = (p: Point) => ({ x: pad + p.c * cellX, y: pad + p.r * cellY });

  // Base edge candidates (in DOT space)
  const candidates = useMemo(() => {
    const list: Edge[] = [];
    for (let r = 0; r < rowsDots; r++) {
      for (let c = 0; c < colsDots - 1; c++) {
        list.push({ a: { r, c }, b: { r, c: c + 1 } });
      }
    }
    for (let r = 0; r < rowsDots - 1; r++) {
      for (let c = 0; c < colsDots; c++) {
        list.push({ a: { r, c }, b: { r: r + 1, c } });
      }
    }
    return list;
  }, [rowsDots, colsDots]);

  // Box list (in BOX space)
  const cells = useMemo(() => {
    const out: Array<{ r: number; c: number; key: string; owner: string | null }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({ r, c, key: cellKey(r, c), owner: getOwnerForCell(owners, r, c) });
      }
    }
    return out;
  }, [rows, cols, owners]);

  /** ———————————————————————————
   *  Overlay via Web Animations API (WAAPI)
   *  ——————————————————————————— */
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Keep track of the currently persistent burn so we can clear it on the next move
  const persistentBurnElsRef = useRef<HTMLElement[]>([]);
  function clearPersistentBurns() {
    const els = persistentBurnElsRef.current;
    for (const el of els) {
      try {
        el.getAnimations().forEach(a => a.cancel());
        el.remove();
      } catch { }
    }
    persistentBurnElsRef.current = [];
  }

  // Persistent burn: pulses indefinitely until we clear it when the *next* edge is added
  function playBurnPersistent(a: Point, b: Point) {
    const ov = overlayRef.current; if (!ov) return;
    const A = toXYdot(a), B = toXYdot(b);
    const isHorizontal = a.r === b.r;
    const isVertical = a.c === b.c;

    const lenX = Math.abs(B.x - A.x);
    const lenY = Math.abs(B.y - A.y);
    const midX = (A.x + B.x) / 2;
    const midY = (A.y + B.y) / 2;

    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0"; el.style.top = "0";
    el.style.borderRadius = "999px";
    el.style.background = "linear-gradient(90deg, rgba(255,180,0,0.6), #ff6a00, rgba(255,180,0,0.6))";
    el.style.boxShadow = "0 0 10px rgba(255,90,0,0.9), 0 0 18px rgba(255,160,0,0.8)";
    el.style.pointerEvents = "none";
    el.style.willChange = "opacity, filter, transform";

    if (isHorizontal) {
      el.style.width = `${lenX}px`;
      el.style.height = `${Math.max(8, Math.round(Math.min(cellX, cellY) * 0.22))}px`;
    } else if (isVertical) {
      el.style.width = `${Math.max(8, Math.round(Math.min(cellX, cellY) * 0.22))}px`;
      el.style.height = `${lenY}px`;
    } else {
      // not expected in Dots & Boxes, but safe fallback: treat as horizontal
      el.style.width = `${Math.hypot(B.x - A.x, B.y - A.y)}px`;
      el.style.height = `${Math.max(8, Math.round(Math.min(cellX, cellY) * 0.22))}px`;
    }
    el.style.transform = `translate(${Math.round(midX)}px, ${Math.round(midY)}px) translate(-50%, -50%)`;

    ov.appendChild(el);

    // Pulse indefinitely
    const anim = el.animate(
      [
        { opacity: 0.85, filter: "saturate(1.0)" },
        { opacity: 1.0, filter: "saturate(1.2)" },
        { opacity: 0.85, filter: "saturate(1.0)" },
      ],
      { duration: 900, easing: "ease-in-out", iterations: Infinity }
    );

    persistentBurnElsRef.current.push(el);

    // Safety: if something goes wrong, hard remove after 2 minutes
    setTimeout(() => {
      try { anim.cancel(); el.remove(); } catch { }
    }, 120000);
  }

  // One-shot blast (unchanged: ~1s)
  function playBlastAtBox(r: number, c: number, dur = 1000) {
    const ov = overlayRef.current; if (!ov) return;
    const x = pad + c * cellX + cellX / 2;
    const y = pad + r * cellY + cellY / 2;

    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0"; el.style.top = "0";
    el.style.width = "20px"; el.style.height = "20px";
    el.style.marginLeft = "-10px"; el.style.marginTop = "-10px";
    el.style.borderRadius = "999px";
    el.style.background = "radial-gradient(circle, #ffd966 0%, #ff9900 55%, rgba(255,0,0,0.85) 72%, rgba(255,0,0,0) 73%)";
    el.style.transform = `translate(${x}px, ${y}px) scale(0.1)`;
    el.style.transformOrigin = "center";
    el.style.pointerEvents = "none";
    el.style.willChange = "transform, opacity";
    ov.appendChild(el);

    const anim = el.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(0.1)`, opacity: 0.95 },
        { transform: `translate(${x}px, ${y}px) scale(1.2)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${x}px, ${y}px) scale(2.0)`, opacity: 0 },
      ],
      { duration: dur, easing: "ease-out", fill: "forwards" }
    );
    anim.onfinish = () => el.remove();
    setTimeout(() => el.remove(), dur + 1000);
  }

  function fireConfetti(host: HTMLElement, count: number, power = 1) {
    const rect = host.getBoundingClientRect();
    const centerX = rect.width / 2;
    const originY = rect.height * 0.25;

    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      piece.style.position = "absolute";
      piece.style.left = `${centerX}px`;
      piece.style.top = `${originY}px`;
      piece.style.width = "6px";
      piece.style.height = "10px";
      piece.style.background = `hsl(${Math.floor(Math.random() * 360)}, 90%, 60%)`;
      piece.style.borderRadius = "2px";
      piece.style.pointerEvents = "none";
      piece.style.willChange = "transform, opacity";

      const angle = (Math.random() * Math.PI) - Math.PI / 2; // left/right spread
      const speed = (3 + Math.random() * 5) * power;
      const vx = Math.cos(angle) * speed;
      const vy0 = (Math.sin(angle) - 1.2) * speed; // bias upward
      const rotate = (Math.random() * 2 - 1) * 0.15;

      host.appendChild(piece);

      let x = 0, y = 0, vy = vy0, opacity = 1, t = 0;
      const gravity = 0.18 * power;
      const life = 900 + Math.random() * 600;

      function step(ts: number) {
        if (!t) t = ts;
        const dt = ts - t;
        t = ts;

        vy += gravity;
        x += vx;
        y += vy;
        opacity -= dt / life;

        piece.style.transform = `translate(${x}px, ${y}px) rotate(${rotate * y}rad)`;
        piece.style.opacity = `${Math.max(0, opacity)}`;

        if (opacity > 0 && y < rect.height + 40) {
          requestAnimationFrame(step);
        } else {
          piece.remove();
        }
      }
      requestAnimationFrame(step);
    }
  }


  /** ———————————————————————————
   *  Animate from PlayBody-provided highlight maps (if present)
   *  (We also do internal diffs further below.)
   *  ——————————————————————————— */
  const seenBurnKeysRef = useRef<Set<string>>(new Set());
  const seenBlastKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!edgeHighlights) return;
    const keys = Array.from(edgeHighlights.keys?.() || []);
    if (!keys.length) return;

    // A new edge highlight arrived: clear previous persistent burns, show only the newest key
    clearPersistentBurns();
    const k = keys[keys.length - 1];
    const parsed = parseEdgeKey(k);
    if (parsed) {
      seenBurnKeysRef.current.add(k);
      playBurnPersistent(parsed[0], parsed[1]);
    }
    // Clean seen set after a short while to allow re-highlighting the same key
    setTimeout(() => seenBurnKeysRef.current.delete(k), 5000);
  }, [edgeHighlights, rowsDots, colsDots]);

  useEffect(() => {
    if (!boxHighlights) return;
    const keys = Array.from(boxHighlights.keys?.() || []);
    for (const k of keys) {
      if (seenBlastKeysRef.current.has(k)) continue;
      const [rs, cs] = k.split(",");
      const r = parseInt(rs || "0", 10);
      const c = parseInt(cs || "0", 10);
      if (Number.isNaN(r) || Number.isNaN(c)) continue;
      seenBlastKeysRef.current.add(k);
      playBlastAtBox(r, c, 1000);
      setTimeout(() => seenBlastKeysRef.current.delete(k), 1400);
    }
  }, [boxHighlights, rows, cols]);

  /** ———————————————————————————
   *  ALSO animate by diffing incoming props (works even without highlight maps)
   *  ——————————————————————————— */
  const prevEdgesRef = useRef<Set<string>>(new Set());
  const prevBoxesRef = useRef<Set<string>>(new Set());

  // Edge diff (newly added edges) — persistent until next edge
  useEffect(() => {
    const current = new Set(Object.keys(edges || {}));
    const prev = prevEdgesRef.current;

    // find keys present now but not before
    const addedNow: string[] = [];
    for (const k of current) if (!prev.has(k)) addedNow.push(k);

    if (addedNow.length) {
      // Only keep the latest edge’s glow visible
      clearPersistentBurns();
      // take the last added (in case multiple arrive at once)
      const last = addedNow[addedNow.length - 1];
      const parsed = parseEdgeKey(last);
      if (parsed) playBurnPersistent(parsed[0], parsed[1]);
    }

    prevEdgesRef.current = current;
  }, [edges, rowsDots, colsDots]);

  // Box diff (newly claimed boxes) — 1s blast
  useEffect(() => {
    let currentKeys: string[] = [];
    if (Array.isArray(owners)) {
      for (let r = 0; r < owners.length; r++) {
        const row = owners[r] || [];
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          if (v !== undefined && v !== null && `${v}` !== "") currentKeys.push(cellKey(r, c));
        }
      }
    } else {
      const map = owners as OwnersMap;
      currentKeys = Object.keys(map).filter((k) => {
        const v = map[k];
        return v !== undefined && v !== null && `${v}` !== "";
      });
    }
    const current = new Set(currentKeys);
    const prev = prevBoxesRef.current;

    for (const k of current) {
      if (!prev.has(k)) {
        const [rs, cs] = k.split(",");
        const r = parseInt(rs || "0", 10);
        const c = parseInt(cs || "0", 10);
        if (!Number.isNaN(r) && !Number.isNaN(c)) playBlastAtBox(r, c, 1000);
      }
    }
    prevBoxesRef.current = current;
  }, [owners, rows, cols]);

  // Box diff (newly claimed boxes) — blasts per box + confetti for chains
  useEffect(() => {
    let currentKeys: string[] = [];
    if (Array.isArray(owners)) {
      for (let r = 0; r < owners.length; r++) {
        const row = owners[r] || [];
        for (let c = 0; c < row.length; c++) {
          const v = row[c];
          if (v !== undefined && v !== null && `${v}` !== "") currentKeys.push(cellKey(r, c));
        }
      }
    } else {
      const map = owners as OwnersMap;
      currentKeys = Object.keys(map).filter((k) => {
        const v = map[k];
        return v !== undefined && v !== null && `${v}` !== "";
      });
    }
    const current = new Set(currentKeys);
    const prev = prevBoxesRef.current;

    let addedCount = 0;

    for (const k of current) {
      if (!prev.has(k)) {
        addedCount++;
        const [rs, cs] = k.split(",");
        const r = parseInt(rs || "0", 10);
        const c = parseInt(cs || "0", 10);
        if (!Number.isNaN(r) && !Number.isNaN(c)) playBlastAtBox(r, c, 1000);
      }
    }

    // chain celebration: 1–2 small, 3+ big
    if (addedCount > 0 && overlayRef.current) {
      const big = addedCount >= 3;
      fireConfetti(overlayRef.current, big ? 80 : 35, big ? 1.6 : 1.0);
    }

    prevBoxesRef.current = current;
  }, [owners, rows, cols]);


  /** ———————————————————————————
   *  Render
   *  ——————————————————————————— */
  return (
    <div
      ref={containerRef}
      style={{
        // Make the container square and responsive. Parent width controls overall size.
        width: "min(65svw, 65svh)",
        aspectRatio: "1 / 1",
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      {/* Base SVG occupies the square */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="Dots and Boxes board">
        <rect x={0} y={0} width={size} height={size} fill="transparent" />

        {/* Cells (fills under edges) */}
        {cells.map(({ r, c, key, owner }) => {
          if (!owner) return null;
          const x = pad + c * cellX, y = pad + r * cellY;
          const fill = colors[owner] || "#22c55e";
          return (
            <rect
              key={`cell-${key}`}
              x={x + Math.max(3, cellX * 0.12)}
              y={y + Math.max(3, cellY * 0.12)}
              width={Math.max(2, cellX - Math.max(6, cellX * 0.24))}
              height={Math.max(2, cellY - Math.max(6, cellY * 0.24))}
              fill={fill}
              opacity={0.22}
              rx={Math.min(12, Math.round(Math.min(cellX, cellY) * 0.25))}
            />
          );
        })}

        {/* Edges */}
        {candidates.map((e, i) => {
          const a = toXYdot(e.a), b = toXYdot(e.b);
          const k = edgeKey(e.a, e.b);
          const taken = !!edges[k];
          const owner = edgeOwners?.[k];
          const clickable = !disabled && !taken && myTurn;

          const baseIdle = "rgba(255,255,255,0.14)";
          const baseHover = "rgba(255,255,255,0.40)";
          const takenClr = (owner && colors[owner]) || "#9ab4ff";
          const stroke = taken ? takenClr : baseIdle;
          const width = taken ? takenStroke : idleStroke;

          return (
            <line
              key={`edge-${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke}
              strokeWidth={width}
              strokeLinecap="round"
              style={{ cursor: clickable ? "pointer" : "default", transition: "stroke 160ms ease" }}
              onClick={() => { if (clickable) onMove(e); }}
              onMouseEnter={(evt) => { if (clickable) (evt.currentTarget as SVGLineElement).setAttribute("stroke", baseHover); }}
              onMouseLeave={(evt) => { if (clickable) (evt.currentTarget as SVGLineElement).setAttribute("stroke", baseIdle); }}
            />
          );
        })}

        {/* Dots (grey) */}
        {Array.from({ length: rowsDots }).map((_, r) =>
          Array.from({ length: colsDots }).map((__, c) => {
            const { x, y } = toXYdot({ r, c });
            return <circle key={`dot-${r}-${c}`} cx={x} cy={y} r={dotR} fill="#9ca3af" opacity={0.95} />;
          })
        )}
      </svg>

      {/* Overlay container where WAAPI injects animated elements */}
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 9999 }}
        aria-hidden
      />
    </div>
  );
}
