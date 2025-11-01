import { GameDefinition, GameState, MovePayload, MoveResult, PlayerId } from "@dashanddots/shared";

export interface DotsState extends GameState {
  rows: number;
  cols: number;
  edges: Record<string, 1>;
  owners: Record<string, PlayerId | null>;
  remainingEdges: number;
  scores: Record<PlayerId, number>;
  edgeOwners: Record<string, PlayerId>;
}

export interface DotsMove extends MovePayload {
  a: [number, number];
  b: [number, number];
}

function keyOf(a: [number, number], b: [number, number]) {
  const [r1, c1] = a, [r2, c2] = b;
  const k1 = `${r1},${c1}`, k2 = `${r2},${c2}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

function isAdjacent(a: [number, number], b: [number, number]) {
  const dr = Math.abs(a[0] - b[0]);
  const dc = Math.abs(a[1] - b[1]);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

function cellEdges(r: number, c: number) {
  const top: [[number, number], [number, number]] = [[r, c], [r, c + 1]];
  const bottom: [[number, number], [number, number]] = [[r + 1, c], [r + 1, c + 1]];
  const left: [[number, number], [number, number]] = [[r, c], [r + 1, c]];
  const right: [[number, number], [number, number]] = [[r, c + 1], [r + 1, c + 1]];
  return [top, right, bottom, left];
}

export const DotsAndBoxes: GameDefinition<DotsState, DotsMove> = {
  id: "dots-and-boxes",
  name: "Dots & Boxes",
  minPlayers: 2,
  maxPlayers: 2,

  createInitialState(opts: any): DotsState {
    const rows = Math.max(2, Number(opts?.rows ?? 5));
    const cols = Math.max(2, Number(opts?.cols ?? 5));
    const players: PlayerId[] = opts?.players?.length ? opts.players : ["p1", "p2"];
    const totalEdges = (rows + 1) * cols + (cols + 1) * rows;

    const scores: Record<PlayerId, number> = {};
    players.forEach(p => (scores[p] = 0));

    return {
      rows,
      cols,
      players,
      currentPlayer: players[0],
      edges: {},
      owners: {},
      remainingEdges: totalEdges,
      scores,
      finished: false,
      edgeOwners: {},
    };
  },

  validateMove(state, move, player) {
    if (state.finished) return "Game is finished";
    if (player !== state.currentPlayer) return "Not your turn";
    if (!move?.a || !move?.b) return "Missing edge endpoints";
    if (!isAdjacent(move.a, move.b)) return "Dots must be adjacent";

    const [r1, c1] = move.a;
    const [r2, c2] = move.b;
    const maxR = state.rows, maxC = state.cols;
    if (r1 < 0 || c1 < 0 || r2 < 0 || c2 < 0) return "Out of bounds";
    if (r1 > maxR || r2 > maxR || c1 > maxC || c2 > maxC) return "Out of bounds";

    const k = keyOf(move.a, move.b);
    if (state.edges[k]) return "Edge already taken";
    return true;
  },

  applyMove(state, move, player) {
    const k = keyOf(move.a, move.b);
    state.edges[k] = 1;
    state.edgeOwners[k] = player;
    // state.remainingEdges--;

    let boxesCompleted = 0;
    const [r1, c1] = move.a, [r2, c2] = move.b;
    const candidates: Array<[number, number]> = [];

    if (r1 === r2) {
      const r = r1, cStart = Math.min(c1, c2);
      if (r > 0) candidates.push([r - 1, cStart]); // cell above
      if (r < state.rows) candidates.push([r, cStart]); // ✅ cell below (ALLOW r == rows-1)
    } else {
      const c = c1, rStart = Math.min(r1, r2);
      if (c > 0) candidates.push([rStart, c - 1]); // cell left
      if (c < state.cols) candidates.push([rStart, c]); // ✅ cell right (ALLOW c == cols-1)
    }


    for (const [rr, cc] of candidates) {
      const complete = cellEdges(rr, cc)
        .map(([a, b]) => keyOf(a, b))
        .every(e => !!state.edges[e]);
      const cellKey = `${rr},${cc}`;
      if (complete && !state.owners[cellKey]) {
        state.owners[cellKey] = player;
        boxesCompleted++;
      }
    }

    if (boxesCompleted > 0) {
      state.scores[player] = (state.scores[player] ?? 0) + boxesCompleted;
      // extra turn
    } else {
      const idx = state.players.indexOf(state.currentPlayer);
      state.currentPlayer = state.players[(idx + 1) % state.players.length];
    }

    const total = (state.rows + 1) * state.cols + (state.cols + 1) * state.rows;
    state.remainingEdges = total - Object.keys(state.edges).length;
    if (state.remainingEdges <= 0) state.finished = true;

    const result: MoveResult = {
      state,
      events: boxesCompleted ? [{ type: "score", payload: { player, boxes: boxesCompleted } }] : [],
    };
    return result;
  },
};
