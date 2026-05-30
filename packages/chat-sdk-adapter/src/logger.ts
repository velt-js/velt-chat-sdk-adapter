/**
 * Minimal logger interface compatible with the Chat SDK's logger shape.
 * Consumers can pass any object with these methods (e.g. `console`).
 */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** A logger that discards everything. Used as the default. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
