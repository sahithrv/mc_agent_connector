import { z } from "zod";

export const LLMResponseSchema = z.object({
  nextBestAction: z.string().trim().min(1).max(160),
  targetCoordinates: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
}).strict();

export type LLMDecisionResponse = z.infer<typeof LLMResponseSchema>;

export interface LLMRequestQueueConfig {
  minDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LLMQueuedRequest {
  agentId: string;
  reason: string;
  execute(signal: AbortSignal): Promise<unknown>;
}

export type LLMQueueResult =
  | {
      ok: true;
      agentId: string;
      decision: LLMDecisionResponse;
    }
  | {
      ok: false;
      agentId: string;
      error: string;
      retryable: boolean;
    };

interface InternalJob {
  request: LLMQueuedRequest;
  resolve(result: LLMQueueResult): void;
}

export class LLMRequestQueue {
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queue: InternalJob[] = [];
  private draining = false;
  private active = false;
  private controller?: AbortController;

  constructor(config: LLMRequestQueueConfig = {}) {
    this.minDelayMs = config.minDelayMs ?? 200;
    this.maxDelayMs = config.maxDelayMs ?? 500;
    this.random = config.random ?? Math.random;
    this.sleep = config.sleep ?? defaultSleep;

    if (this.minDelayMs < 0 || this.maxDelayMs < this.minDelayMs) {
      throw new Error("LLMRequestQueue delay bounds are invalid");
    }
  }

  enqueue(request: LLMQueuedRequest): Promise<LLMQueueResult> {
    const promise = new Promise<LLMQueueResult>((resolve) => {
      this.queue.push({ request, resolve });
    });

    // Fire-and-forget draining keeps callers from synchronously blocking the agent loop.
    // Every result is delivered through the returned Promise, so validation failures are contained.
    void this.drain();
    return promise;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  activeCount(): number {
    return this.active ? 1 : 0;
  }

  abort(reason = "LLM request queue aborted"): void {
    this.controller?.abort(reason);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      let startedAtLeastOne = false;
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) continue;

        if (startedAtLeastOne) {
          await this.sleep(this.jitterDelayMs());
        }
        startedAtLeastOne = true;

        this.controller = new AbortController();
        this.active = true;
        try {
          const raw = await job.request.execute(this.controller.signal);
          job.resolve(this.parse(job.request.agentId, raw));
        } catch (error) {
          job.resolve({
            ok: false,
            agentId: job.request.agentId,
            error: formatError(error),
            retryable: true,
          });
        } finally {
          this.active = false;
          this.controller = undefined;
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private parse(agentId: string, raw: unknown): LLMQueueResult {
    const decoded = typeof raw === "string" ? parseJson(raw) : raw;
    const parsed = LLMResponseSchema.safeParse(decoded);
    if (!parsed.success) {
      return {
        ok: false,
        agentId,
        error: `LLM response validation failed: ${parsed.error.issues.map((issue) =>
          `${issue.path.join(".") || "root"} ${issue.message}`,
        ).join("; ")}`,
        retryable: false,
      };
    }

    return {
      ok: true,
      agentId,
      decision: parsed.data,
    };
  }

  private jitterDelayMs(): number {
    const span = this.maxDelayMs - this.minDelayMs;
    return Math.round(this.minDelayMs + this.random() * span);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      parseError: formatError(error),
    };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
