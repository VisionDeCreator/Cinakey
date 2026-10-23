import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage<AbortSignal>();
export function withProviderSignal<T>(signal: AbortSignal, run: () => T): T {
  return scope.run(signal, run);
}
export function currentProviderSignal() {
  return scope.getStore();
}
