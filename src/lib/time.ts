/** Format seconds as `HH:MM:SS`. */
export function hms(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Parse an `HH:MM:SS` label back to seconds; null when it isn't one. */
export function parseHms(label: string): number | null {
  const m = /(\d{1,2}):(\d{2}):(\d{2})/.exec(label);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
