/// <reference lib="webworker" />
// Student code in the Python worker can reach JavaScript (`import js`, `pyodide.code.run_js`).
// Left alone it could write the site's Cache Storage, where the offline app itself lives, so a
// shared link that someone runs could replace the app on their device. Before any student code
// runs we remove storage, network and worker-spawning APIs from the worker's global scope.
// The worker keeps its own private references to what it needs (see python.worker.ts).

/** Globals student code must not reach. */
export const BLOCKED_GLOBALS = [
  "caches", "indexedDB", "fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "EventSource",
  "WebTransport", "importScripts", "Worker", "SharedWorker", "BroadcastChannel",
] as const;

/** Properties of `navigator` that open storage or service workers. */
export const BLOCKED_NAVIGATOR = ["storage", "serviceWorker"] as const;

/** Deletes `name` from `obj` and every object on its prototype chain (Web IDL members live on prototypes). */
function removeEverywhere(obj: object, name: string) {
  for (let o: object | null = obj; o; o = Object.getPrototypeOf(o)) {
    if (Object.prototype.hasOwnProperty.call(o, name)) Reflect.deleteProperty(o, name);
  }
}

/** Removes the blocked APIs. Returns any that are still reachable (should be none). */
export function lockDown(scope: WorkerGlobalScope): string[] {
  for (const name of BLOCKED_GLOBALS) removeEverywhere(scope, name);
  for (const name of BLOCKED_NAVIGATOR) removeEverywhere(scope.navigator, name);
  return [
    ...BLOCKED_GLOBALS.filter((n) => n in scope),
    ...BLOCKED_NAVIGATOR.filter((n) => n in scope.navigator).map((n) => `navigator.${n}`),
  ];
}
