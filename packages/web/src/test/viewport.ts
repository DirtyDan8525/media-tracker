/** jsdom has no layout: a fake matchMedia that answers (min-width: Npx) from a settable width. */
type Listener = (e: MediaQueryListEvent) => void;
let width = 390;
const lists = new Set<{ query: string; listeners: Set<Listener>; mql: MediaQueryList }>();

function evaluate(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return width >= Number(min[1]);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return width <= Number(max[1]);
  return false; // e.g. prefers-reduced-motion
}

export function setViewportWidth(w: number): void {
  width = w;
  for (const l of lists) {
    const matches = evaluate(l.query);
    for (const fn of l.listeners) fn({ matches, media: l.query } as MediaQueryListEvent);
  }
}

window.matchMedia = (query: string): MediaQueryList => {
  const listeners = new Set<Listener>();
  const mql = {
    get matches() { return evaluate(query); },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: Listener) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: Listener) => { listeners.delete(fn); },
    addListener: (fn: Listener) => { listeners.add(fn); },
    removeListener: (fn: Listener) => { listeners.delete(fn); },
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  lists.add({ query, listeners, mql });
  return mql;
};
