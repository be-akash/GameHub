// apps/web/src/app/components/DotsBoard.tsx
"use client";

type Point = { r: number; c: number };
type Edge = { a: Point; b: Point };

function keyOf(a: Point, b: Point) {
  const k1 = `${a.r},${a.c}`, k2 = `${b.r},${b.c}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

function isEdgeTaken(edges: Record<string, 1>, a: Point, b: Point) {
  return !!edges[keyOf(a, b)];
}

export default function DotsBoard({
  rows,
  cols,
  edges,
  onMove,
}: {
  rows: number;
  cols: number;
  edges: Record<string, 1>;
  onMove: (edge: Edge) => void;
}) {
  // layout
  const cell = 40; // px
  const dot = 6;   // dot radius
  const width = cols * cell;
  const height = rows * cell;

  // build all candidate edges (between adjacent dots)
  const candidates: Edge[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r <= rows) candidates.push({ a: { r, c }, b: { r, c: c + 1 } }); // horizontal
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (c <= cols) candidates.push({ a: { r, c }, b: { r: r + 1, c } }); // vertical
    }
  }

  const toXY = (p: Point) => ({ x: p.c * cell, y: p.r * cell });

  return (
    <svg width={width + 2 * dot} height={height + 2 * dot} style={{ background: "#0a0f22", borderRadius: 12 }}>
      <g transform={`translate(${dot},${dot})`}>
        {/* edges (draw taken first) */}
        {candidates.map((e, i) => {
          const a = toXY(e.a);
          const b = toXY(e.b);
          const taken = isEdgeTaken(edges, e.a, e.b);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={taken ? "#2b54ff" : "rgba(255,255,255,0.15)"}
              strokeWidth={taken ? 6 : 10}
              strokeLinecap="round"
              style={{ cursor: taken ? "default" : "pointer" }}
              onClick={() => !taken && onMove(e)}
              onMouseEnter={(evt) => {
                if (!taken) (evt.currentTarget as SVGLineElement).setAttribute("stroke", "rgba(255,255,255,0.4)");
              }}
              onMouseLeave={(evt) => {
                if (!taken) (evt.currentTarget as SVGLineElement).setAttribute("stroke", "rgba(255,255,255,0.15)");
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
