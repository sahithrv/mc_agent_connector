import { loadAgentConfigs } from "./config/agents";
import { formatStartupError } from "./config/errors";
import { loadStudioConfig } from "./config/studio";
import { createApp } from "./server/app";

export async function main(): Promise<void> {
  try {
    const studioConfig = await loadStudioConfig();
    const agents = await loadAgentConfigs();
    const app = createApp({ studioConfig, agents });

    await app.listen({
      host: studioConfig.server.host,
      port: studioConfig.server.port,
    });
  } catch (error) {
    console.error(formatStartupError(error));
    process.exitCode = 1;
  }
}

void main();
