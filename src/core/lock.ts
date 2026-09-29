/** Serializes async work: each call waits for the previous one to finish. */
export function createLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.catch(() => undefined);
    return result;
  };
}
