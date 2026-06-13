export * from "./farmer";
export * from "./guard";
export * from "./miner";
export * from "./survival";
export * from "./types";

import { FarmerRoutine } from "./farmer";
import { GuardRoutine } from "./guard";
import { MinerRoutine } from "./miner";
import { SurvivalRoutine } from "./survival";
import type { Routine } from "./types";

export function defaultRoutines(): Map<string, Routine> {
  return new Map<string, Routine>([
    ["survival", new SurvivalRoutine()],
    ["farmer", new FarmerRoutine()],
    ["guard", new GuardRoutine()],
    ["miner", new MinerRoutine()],
  ]);
}
