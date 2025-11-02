"use client";

import { useEffect, useMemo, useRef } from "react";

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

  // Optional: highlights from PlayBody (we also do internal diffs)
  edgeHighlights,
  boxHighlights,
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
}) {
  const myTurn = currentPlayer === myPlayerId;

  // Layout (rows/cols are BOX counts; dots = boxes + 1)
  const cell = 48, pad = 18, dotR = 5;
  const rowsDots = rows + 1, colsDots = cols + 1;
  const W = cols * cell + pad * 2;
  const H = rows * cell + pad * 2;

  const toXYdot = (p: Point) => ({ x: pad + p.c * cell, y: pad + p.r * cell });

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

  // ===== Overlay via Web Animations API (WAAPI) =====
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const seenBurnKeysRef = useRef<Set<string>>(new Set());
  const seenBlastKeysRef = useRef<Set<string>>(new Set());

  function playBurnFromPoints(a: Point, b: Point, dur = 2000) {
    const ov = overlayRef.current; if (!ov) return;
    const A = toXYdot(a), B = toXYdot(b);

    // Are we horizontal or vertical? (Game edges are orthogonal)
    const isHorizontal = a.r === b.r;
    const isVertical = a.c === b.c;

    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);

    // Center point
    const midX = (A.x + B.x) / 2;
    const midY = (A.y + B.y) / 2;

    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.borderRadius = "999px";
    el.style.background = "linear-gradient(90deg, rgba(255,180,0,0.6), #ff6a00, rgba(255,180,0,0.6))";
    el.style.boxShadow = "0 0 10px rgba(255,90,0,0.9), 0 0 18px rgba(255,160,0,0.8)";
    el.style.pointerEvents = "none";
    el.style.willChange = "opacity, filter, transform";

    if (isHorizontal) {
      // width along X, fixed height
      el.style.width = `${len}px`;
      el.style.height = `10px`;
      el.style.transform = `translate(${Math.round(midX)}px, ${Math.round(midY)}px) translate(-50%, -50%)`;
    } else if (isVertical) {
      // height along Y, fixed width — NO rotation
      el.style.width = `10px`;
      el.style.height = `${len}px`;
      el.style.transform = `translate(${Math.round(midX)}px, ${Math.round(midY)}px) translate(-50%, -50%)`;
    } else {
      // (Shouldn't happen in Dots & Boxes, but keep a safe fallback)
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      el.style.width = `${len}px`;
      el.style.height = `10px`;
      el.style.transform = `translate(${midX}px, ${midY}px) rotate(${angle}deg) translate(-50%, -50%)`;
    }

    ov.appendChild(el);

    const anim = el.animate(
      [
        { opacity: 1, filter: "saturate(1)" },
        { opacity: 0.9, filter: "saturate(1.2)", offset: 0.4 },
        { opacity: 0.6, filter: "saturate(1.1)", offset: 0.75 },
        { opacity: 0, filter: "saturate(1)" },
      ],
      { duration: dur, easing: "ease-out", fill: "forwards" }
    );
    anim.onfinish = () => el.remove();
    setTimeout(() => el.remove(), dur + 1000);
  }


  function playBlastAtBox(r: number, c: number, dur = 1000) {
    const ov = overlayRef.current; if (!ov) return;
    const x = pad + c * cell + cell / 2;
    const y = pad + r * cell + cell / 2;

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

  // ===== Animate from PlayBody-provided highlight maps (if present) =====
  useEffect(() => {
    if (!edgeHighlights) return;
    const keys = Array.from(edgeHighlights.keys?.() || []);
    for (const k of keys) {
      if (seenBurnKeysRef.current.has(k)) continue;
      const parsed = parseEdgeKey(k);
      if (!parsed) continue;
      seenBurnKeysRef.current.add(k);
      playBurnFromPoints(parsed[0], parsed[1], 2000);
      setTimeout(() => seenBurnKeysRef.current.delete(k), 2400);
    }
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

  // ===== ALSO animate by diffing incoming props (works even without highlight maps) =====
  const prevEdgesRef = useRef<Set<string>>(new Set());
  const prevBoxesRef = useRef<Set<string>>(new Set());

  // Edge diff (newly added edges)
  useEffect(() => {
    const current = new Set(Object.keys(edges || {}));
    const prev = prevEdgesRef.current;
    for (const k of current) {
      if (!prev.has(k)) {
        const parsed = parseEdgeKey(k);
        if (parsed) playBurnFromPoints(parsed[0], parsed[1], 2000);
      }
    }
    prevEdgesRef.current = current;
  }, [edges, rowsDots, colsDots]);

  // Box diff (newly claimed boxes)
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

  return (
    <div style={{ position: "relative", width: W, height: H }}>
      {/* === Base SVG board (cells under, then edges, then dots) === */}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="Dots and Boxes board">
        <rect x={0} y={0} width={W} height={H} fill="transparent" />

        {/* Cells (fills under edges) */}
        {cells.map(({ r, c, key, owner }) => {
          if (!owner) return null;
          const x = pad + c * cell, y = pad + r * cell;
          const fill = colors[owner] || "#22c55e";
          return (
            <rect
              key={`cell-${key}`}
              x={x + 6} y={y + 6} width={cell - 12} height={cell - 12}
              fill={fill} opacity={0.22} rx={8}
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

          return (
            <line
              key={`edge-${i}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={stroke}
              strokeWidth={taken ? 6 : 10}
              strokeLinecap="round"
              style={{ cursor: clickable ? "pointer" : "default", transition: "stroke 160ms ease" }}
              onClick={() => { if (clickable) onMove(e); }}
              onMouseEnter={(evt) => { if (clickable) (evt.currentTarget as SVGLineElement).setAttribute("stroke", baseHover); }}
              onMouseLeave={(evt) => { if (clickable) (evt.currentTarget as SVGLineElement).setAttribute("stroke", baseIdle); }}
            />
          );
        })}

        {/* Dots */}
        {Array.from({ length: rowsDots }).map((_, r) =>
          Array.from({ length: colsDots }).map((__, c) => {
            const { x, y } = toXYdot({ r, c });
            return <circle key={`dot-${r}-${c}`} cx={x} cy={y} r={dotR} fill="#fff" opacity={0.9} />;
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
