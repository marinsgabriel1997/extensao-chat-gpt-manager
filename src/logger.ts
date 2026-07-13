export type DebugLevel = "debug" | "info" | "warn" | "error";

export interface DebugEvent {
  timestamp: string;
  level: DebugLevel;
  category: string;
  name: string;
  context: Record<string, unknown>;
}

const SECRET_KEY_PATTERN = /authorization|access.?token|cookie|secret|password/i;
const MAX_EVENTS = 500;

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key)
      ? "[redacted]"
      : sanitizeValue(item, seen);
  }

  return sanitized;
}

export class DebugLogger {
  private enabled = true;
  private readonly events: DebugEvent[] = [];

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.record("info", "logger", "debug_mode_changed", { enabled }, true);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getEvents(): DebugEvent[] {
    return [...this.events];
  }

  debug(category: string, name: string, context: Record<string, unknown> = {}): void {
    this.record("debug", category, name, context);
  }

  info(category: string, name: string, context: Record<string, unknown> = {}): void {
    this.record("info", category, name, context);
  }

  warn(category: string, name: string, context: Record<string, unknown> = {}): void {
    this.record("warn", category, name, context);
  }

  error(category: string, name: string, context: Record<string, unknown> = {}): void {
    this.record("error", category, name, context);
  }

  private record(
    level: DebugLevel,
    category: string,
    name: string,
    context: Record<string, unknown>,
    force = false,
  ): void {
    if (!this.enabled && !force) {
      return;
    }

    const sanitized = sanitizeValue(context, new WeakSet<object>());
    const event: DebugEvent = {
      timestamp: new Date().toISOString(),
      level,
      category,
      name,
      context: sanitized as Record<string, unknown>,
    };

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }

    console[level === "debug" ? "debug" : level](`[${category}] ${name}`, event.context);
  }
}

export const logger = new DebugLogger();

