import { GameDefinition } from "@dashanddots/shared";
import { DotsAndBoxes } from "../games/dots-and-boxes";

const registry = new Map<string, GameDefinition>();
registry.set(DotsAndBoxes.id, DotsAndBoxes);

export function getGame(id: string): GameDefinition | undefined {
  return registry.get(id);
}

export function listGames() {
  return Array.from(registry.values()).map(g => ({ id: g.id, name: g.name }));
}
