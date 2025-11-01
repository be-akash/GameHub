"use client";

import { useEffect, useMemo, useRef } from "react";

type Point = { r: number; c: number };
type Edge = { a: Point; b: Point };

function keyOf(a: Point, b: Point) {
  const k1 = `${a.r},${a.c}`, k2 = `${b.r},${b.c}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

export default function DotsBoard({
  rows,
  cols,
  edges,
  edgeOwners = {},
  owners,
  currentPlayer,
  myPlayerId,
  colors = {},
  disabled = false,           // 👈 NEW
  onMove,
}: {
  rows: number;
  cols: number;
  edges: Record<string, 1>;
  edgeOwners?: Record<string, string>;
  owners: Record<string, string | null>;
  currentPlayer: string;
  myPlayerId: string;
  colors?: Record<string, string>;
  disabled?: boolean;         // 👈 NEW
  onMove: (edge: Edge) => void;
}) {
  const cell = 40;
  const dot = 6;
  const width = cols * cell;
  const height = rows * cell;
  const myTurn = currentPlayer === myPlayerId;

  // Build all possible edges (memo for perf)
  const candidates: Edge[] = useMemo(() => {
    const list: Edge[] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) list.push({ a: { r, c }, b: { r, c: c + 1 } });
    for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) list.push({ a: { r, c }, b: { r: r + 1, c } });
    return list;
  }, [rows, cols]);

  const toXY = (p: Point) => ({ x: p.c * cell, y: p.r * cell });

  // Cells and ownership map
  const cells = useMemo(
    () =>
      Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const key = `${r},${c}`;
        return { r, c, key, owner: owners[key] ?? null };
      }),
    [rows, cols, owners]
  );

  // Track newly captured cells for a subtle fade-in
  const prevOwnedRef = useRef<Set<string>>(new Set());
  const newlyCaptured = useMemo(() => {
    const current = new Set<string>();
    const newly: Set<string> = new Set();
    for (const { key, owner } of cells) {
      if (owner) {
        current.add(key);
        if (!prevOwnedRef.current.has(key)) newly.add(key);
      }
    }
    return newly;
  }, [cells]);

  useEffect(() => {
    const next = new Set<string>();
    for (const { key, owner } of cells) if (owner) next.add(key);
    prevOwnedRef.current = next;
  }, [cells]);

  return (
    <svg
      width={width + 2 * dot}
      height={height + 2 * dot}
      style={{ background: "#0a0f22", borderRadius: 12, touchAction: "manipulation" }}
      role="img"
      aria-label="Dots and Boxes board"
    >
      <g transform={`translate(${dot},${dot})`}>
        {/* box fills */}
        {cells.map(({ r, c, key, owner }) => {
          if (!owner) return null;
          const x = c * cell, y = r * cell;
          const color = colors[owner] || "#23c55e";
          const isNew = newlyCaptured.has(key);
          const baseOpacity = 0.22;
          return (
            <rect
              key={key}
              x={x + 6}
              y={y + 6}
              width={cell - 12}
              height={cell - 12}
              fill={color}
              opacity={isNew ? 0 : baseOpacity}
              rx={8}
            >
              {isNew && (
                <animate
                  attributeName="opacity"
                  from="0"
                  to={String(baseOpacity)}
                  dur="0.3s"
                  fill="freeze"
                  begin="indefinite"
                  ref={(el) => {
                    if (el && typeof (el as any).beginElement === "function") {
                      (el as any).beginElement();
                    }
                  }}
                />
              )}
            </rect>
          );
        })}

        {/* edges */}
        {candidates.map((e, i) => {
          const a = toXY(e.a), b = toXY(e.b);
          const k = keyOf(e.a, e.b);
          const taken = !!edges[k];
          const owner = edgeOwners[k];
          const strokeColor = taken ? (owner && colors[owner]) || "#9ab4ff" : "rgba(255,255,255,0.14)";
          const clickable = !disabled && !taken && myTurn;

          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={strokeColor}
              strokeWidth={taken ? 6 : 10}
              strokeLinecap="round"
              style={{ cursor: clickable ? "pointer" : "default" }}
              onClick={() => { if (clickable) onMove(e); }}
              onMouseEnter={(evt) => {
                if (clickable) (evt.currentTarget as SVGLineElement).setAttribute("stroke", "rgba(255,255,255,0.4)");
              }}
              onMouseLeave={(evt) => {
                if (clickable) (evt.currentTarget as SVGLineElement).setAttribute("stroke", "rgba(255,255,255,0.14)");
              }}
            />
          );
        })}

        {/* dots */}
        {Array.from({ length: (rows + 1) * (cols + 1) }).map((_, idx) => {
          const r = Math.floor(idx / (cols + 1));
          const c = idx % (cols + 1);
          const { x, y } = toXY({ r, c });
          return <circle key={idx} cx={x} cy={y} r={dot} fill="#ffffff" />;
        })}
      </g>
    </svg>
  );
}
