import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/** Read a browser-only value (e.g. localStorage) without a hydration mismatch: `server` is used during SSR. */
export function useClientValue<T extends string | number | boolean | null>(read: () => T, server: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => server);
}
