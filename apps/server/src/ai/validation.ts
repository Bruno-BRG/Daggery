export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 2000, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text');
  return value.trim();
}
export function number(value: unknown, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid number');
  return value;
}
export function integer(value: unknown, min: number, max: number, fallback?: number) {
  const n = number(value, min, max, fallback);
  if (!Number.isInteger(n)) throw new Error('Invalid integer');
  return n;
}
