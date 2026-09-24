export function createLatestRequestSequence() {
  let current = 0;

  return {
    next: () => ++current,
    invalidate: () => { current += 1; },
    isCurrent: (request: number) => request === current,
  };
}
