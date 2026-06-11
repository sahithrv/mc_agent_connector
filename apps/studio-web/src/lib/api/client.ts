export interface ApiErrorShape {
  name: "ApiError";
  status: number;
  message: string;
  url: string;
  details?: unknown;
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export class ApiError extends Error {
  readonly shape: ApiErrorShape;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = shape.name;
    this.shape = shape;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? apiBaseUrl();
    this.fetcher = options.fetcher ?? fetch;
  }

  async get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = resolveApiUrl(path, this.baseUrl);
    const headers = new Headers(init.headers);

    if (!headers.has("accept")) {
      headers.set("accept", "application/json");
    }

    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    try {
      const response = await this.fetcher(url, { ...init, headers });
      const body = await parseJsonBody(response);

      if (!response.ok) {
        throw new ApiError({
          name: "ApiError",
          status: response.status,
          message: errorMessageFromBody(body) ?? `Request failed with HTTP ${response.status}`,
          url,
          details: body,
        });
      }

      return body as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError({
        name: "ApiError",
        status: 0,
        message: `Unable to reach backend at ${url}`,
        url,
        details: error instanceof Error ? error.message : error,
      });
    }
  }
}

export function apiBaseUrl(): string {
  return import.meta.env.VITE_STUDIO_API_BASE_URL ?? "/api";
}

export function normalizeApiError(error: unknown): ApiErrorShape {
  if (error instanceof ApiError) {
    return error.shape;
  }

  return {
    name: "ApiError",
    status: 0,
    message: error instanceof Error ? error.message : "Unknown API error",
    url: apiBaseUrl(),
    details: error,
  };
}

function resolveApiUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (/^https?:\/\//.test(baseUrl)) {
    return new URL(normalizedPath, baseUrl).toString();
  }

  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${normalizedPath}`;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body === "object" && "error" in body) {
    const value = (body as { error?: unknown }).error;
    return typeof value === "string" ? value : undefined;
  }

  if (body && typeof body === "object" && "message" in body) {
    const value = (body as { message?: unknown }).message;
    return typeof value === "string" ? value : undefined;
  }

  return undefined;
}
