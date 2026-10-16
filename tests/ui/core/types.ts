export interface Snapshot { ref: string; version: string; hash: string; builtAt?: string }
export interface Profile { id: string; label: string; width: number; height: number; touch: boolean }
export interface Scene { id: string; label: string; root?: string }
export interface Comparison {
  id: string;
  title: string;
  out: string;
  profiles: readonly Profile[];
  scenes: readonly Scene[];
  beforeDirectory?: string;
  afterDirectory?: string;
  snapshots?: Record<string, Snapshot>;
  description?: string;
  liveLabel?: string;
  themes?: readonly string[];
  shotPath?: string;
  hasDiff?: boolean;
  transformHtml?: (html: string, url: URL) => string;
  validateReport?: (report: unknown) => boolean;
}

export interface UiAdapter {
  buildSnapshot: (side: 'before' | 'after', ref?: string) => unknown | Promise<unknown>;
  comparison: () => Comparison;
  check?: () => Promise<number>;
  live?: () => Promise<number>;
  verify?: () => Promise<unknown>;
  commands?: Record<string, () => Promise<unknown>>;
}
