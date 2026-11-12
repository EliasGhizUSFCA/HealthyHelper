/** Minimal external store for useSyncExternalStore. */
export class Store<S extends object> {
  private listeners = new Set<() => void>();
  constructor(protected state: S) {}
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  setState(patch: Partial<S> | ((s: S) => Partial<S>)) {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }
}
