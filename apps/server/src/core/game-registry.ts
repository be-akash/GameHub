import type { GameDefinition, GameState, MovePayload } from "@dashanddots/shared";
import { DotsAndBoxes } from "../games/dots-and-boxes.js";

// Keep storage wide to accept any concrete game shapes safely
const registry = new Map<string, GameDefinition<any, any>>();

export function registerGame<S extends GameState, M extends MovePayload>(def: GameDefinition<S, M>) {
  registry.set(def.id, def as unknown as GameDefinition<GameState, MovePayload>);
}

export function getGame(id: string): GameDefinition<GameState, MovePayload> | undefined {
  return registry.get(id) as GameDefinition<GameState, MovePayload> | undefined;
}

// Register your games here
registerGame(DotsAndBoxes);
