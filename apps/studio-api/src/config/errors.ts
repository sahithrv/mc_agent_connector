export class ConfigError extends Error {
  public readonly filePath?: string;

  public constructor(message: string, filePath?: string) {
    super(filePath ? `${filePath}: ${message}` : message);
    this.name = "ConfigError";
    this.filePath = filePath;
  }
}

export function formatStartupError(error: unknown): string {
  if (error instanceof ConfigError) {
    return `Startup config error: ${error.message}`;
  }

  if (error instanceof Error) {
    return `Startup error: ${error.message}`;
  }

  return "Startup error: unknown failure";
}
