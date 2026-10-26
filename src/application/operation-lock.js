export function createOperationLock() {
  let tail = Promise.resolve();
  return {
    run(operation) {
      const result = tail.then(operation, operation);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
