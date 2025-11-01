export type PlayerId = string;

export interface GameState {
  currentPlayer: PlayerId;
  players: PlayerId[];
  finished?: boolean;
}

export interface MovePayload {
  [key: string]: any;
}

export interface MoveResult {
  state: GameState;
  events?: { type: string; payload?: any }[];
}

export interface GameDefinition<S extends GameState = GameState, M extends MovePayload = MovePayload> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  createInitialState: (opts: any) => S;
  validateMove: (state: S, move: M, player: PlayerId) => true | string;
  applyMove: (state: S, move: M, player: PlayerId) => MoveResult;
}
