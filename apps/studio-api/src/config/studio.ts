import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  optionalBoolean,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredObject,
  requiredString,
} from "./json";

export interface StudioConfig {
  server: {
    host: string;
    port: number;
    logger: boolean;
  };
  tickRates: {
    schedulerMs: number;
    routineMs: number;
    perceptionMs: number;
  };
  database: {
    path: string;
  };
  llm: {
    maxConcurrency: number;
  };
}

export function defaultStudioConfigPath(): string {
  const cwdConfig = resolve(process.cwd(), "config", "studio.config.json");
  if (existsSync(cwdConfig)) {
    return cwdConfig;
  }
  return resolve(process.cwd(), "..", "..", "config", "studio.config.json");
}

export async function loadStudioConfig(
  filePath = defaultStudioConfigPath(),
): Promise<StudioConfig> {
  const source = await readJsonObject(filePath);
  const server = requiredObject(source, "server", filePath);
  const tickRates = requiredObject(source, "tickRates", filePath);
  const database = requiredObject(source, "database", filePath);
  const llm = requiredObject(source, "llm", filePath);

  return {
    server: {
      host: requiredString(server, "host", filePath),
      port: requiredInteger(server, "port", filePath, 1, 65_535),
      logger: optionalBoolean(server, "logger", filePath) ?? true,
    },
    tickRates: {
      schedulerMs: requiredInteger(tickRates, "schedulerMs", filePath, 1, 60_000),
      routineMs: requiredInteger(tickRates, "routineMs", filePath, 1, 60_000),
      perceptionMs: requiredInteger(tickRates, "perceptionMs", filePath, 1, 60_000),
    },
    database: {
      path: requiredString(database, "path", filePath),
    },
    llm: {
      maxConcurrency: requiredInteger(llm, "maxConcurrency", filePath, 1, 100),
    },
  };
}
