import type { PendingStudioEventEnvelope } from "../types";

export type DashboardConnectionPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface DashboardConnectionState {
  phase: DashboardConnectionPhase;
  attempts: number;
  nextRetryAt?: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  error?: string;
}

export interface DashboardWebSocketClientOptions {
  url?: string;
  webSocketFactory?: (url: string) => WebSocket;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  onConnectionChange?: (state: DashboardConnectionState) => void;
  onEnvelope?: (event: PendingStudioEventEnvelope) => void;
}

export class DashboardWebSocketClient {
  private readonly url: string;
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly onConnectionChange?: (state: DashboardConnectionState) => void;
  private readonly onEnvelope?: (event: PendingStudioEventEnvelope) => void;
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private attempts = 0;
  private stopped = true;

  constructor(options: DashboardWebSocketClientOptions = {}) {
    this.url = options.url ?? dashboardWsUrl();
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 15_000;
    this.onConnectionChange = options.onConnectionChange;
    this.onEnvelope = options.onEnvelope;
  }

  connect(): void {
    this.stopped = false;
    this.openSocket();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close();
    this.emit({ phase: "disconnected", attempts: this.attempts, lastDisconnectedAt: nowIso() });
  }

  private openSocket(): void {
    if (this.stopped) {
      return;
    }

    this.emit({
      phase: this.attempts > 0 ? "reconnecting" : "connecting",
      attempts: this.attempts,
    });

    try {
      const socket = this.webSocketFactory(this.url);
      this.socket = socket;

      socket.onopen = () => {
        this.attempts = 0;
        this.emit({ phase: "connected", attempts: 0, lastConnectedAt: nowIso() });
      };

      socket.onmessage = (message) => {
        try {
          this.onEnvelope?.(JSON.parse(String(message.data)) as PendingStudioEventEnvelope);
        } catch (error) {
          this.emit({
            phase: "connected",
            attempts: this.attempts,
            error: error instanceof Error ? error.message : "Invalid dashboard event payload",
          });
        }
      };

      socket.onerror = () => {
        this.emit({
          phase: this.attempts > 0 ? "reconnecting" : "connecting",
          attempts: this.attempts,
          error: "Dashboard event stream error",
        });
      };

      socket.onclose = () => {
        if (this.stopped) {
          return;
        }
        this.scheduleReconnect("Dashboard event stream closed");
      };
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : "Unable to open event stream");
    }
  }

  private scheduleReconnect(error: string): void {
    this.attempts += 1;
    const delay = Math.min(this.reconnectBaseMs * 2 ** (this.attempts - 1), this.reconnectMaxMs);
    const nextRetryAt = new Date(Date.now() + delay).toISOString();

    // Reconnect state is emitted before the timer starts so the UI can show attempts and retry timing.
    this.emit({
      phase: "reconnecting",
      attempts: this.attempts,
      nextRetryAt,
      lastDisconnectedAt: nowIso(),
      error,
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
  }

  private emit(state: DashboardConnectionState): void {
    this.onConnectionChange?.(state);
  }
}

export function createDashboardWsClient(
  options: DashboardWebSocketClientOptions = {},
): DashboardWebSocketClient {
  return new DashboardWebSocketClient(options);
}

export function dashboardWsUrl(): string {
  const explicit = import.meta.env.VITE_STUDIO_WS_URL;
  if (explicit) {
    return explicit;
  }

  const apiBase = import.meta.env.VITE_STUDIO_API_BASE_URL;
  if (!apiBase && isLocalViteDevOrigin()) {
    const url = new URL(window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.port = "3100";
    url.pathname = "/ws/dashboard";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const resolvedApiBase = apiBase ?? "/api";
  const path = `${resolvedApiBase.replace(/\/$/, "")}/ws/dashboard`;

  if (/^https?:\/\//.test(path)) {
    return path.replace(/^http/, "ws");
  }

  const origin = window.location.origin.replace(/^http/, "ws");
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

function isLocalViteDevOrigin(): boolean {
  return window.location.port === "5173"
    && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function nowIso(): string {
  return new Date().toISOString();
}
