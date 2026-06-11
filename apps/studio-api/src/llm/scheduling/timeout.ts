export interface TimeoutOutcome<T> {
  value: T;
  timedOut: boolean;
}

export async function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fallback: () => T | Promise<T>,
): Promise<TimeoutOutcome<T>> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;

  const operationPromise = Promise.resolve()
    .then(() => operation(controller.signal))
    .then((value): TimeoutOutcome<T> => ({ value, timedOut: false }));
  operationPromise.catch(() => undefined);

  const timeoutPromise = new Promise<TimeoutOutcome<T>>((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort("llm request timed out");
      Promise.resolve(fallback())
        .then((value) => resolve({ value, timedOut: true }))
        .catch(reject);
    }, timeoutMs);
  });

  try {
    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (!timedOut && timer) clearTimeout(timer);
  }
}
