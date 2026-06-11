export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

export function decodeJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function nullableJson<T>(value: string | null): T | undefined {
  if (value === null) {
    return undefined;
  }
  return decodeJson<T>(value);
}
