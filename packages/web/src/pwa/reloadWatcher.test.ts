import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForReload, resetReloadWatcher, RELOAD_SEEN_KEY, type ReloadDeps } from './reloadWatcher';

const OLD = '2026-11-20T10:00:00.000Z';
const NEW = '2026-11-20T15:55:00.000Z';

/** A fake registration whose update() can bring a worker; and a fake navigator.serviceWorker to fire controllerchange. */
function setup(reloadAt: string | null, opts: { newWorker?: boolean } = {}) {
  const swEvents = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: swEvents });
  const worker = Object.assign(new EventTarget(), { state: 'installed', postMessage: vi.fn() });
  const regEvents = new EventTarget();
  const reg = Object.assign(regEvents, {
    waiting: null as unknown,
    installing: null as unknown,
    update: vi.fn(async () => { if (opts.newWorker) reg.waiting = worker; }),
  });
  const reload = vi.fn();
  const deps: ReloadDeps = {
    fetchReloadAt: async () => reloadAt,
    getRegistration: async () => reg as unknown as ServiceWorkerRegistration,
    reload,
    waitMs: 30,
  };
  return { deps, reg, reload, worker, swEvents };
}
const tick = (n = 60) => new Promise((r) => setTimeout(r, n));

beforeEach(() => { localStorage.clear(); resetReloadWatcher(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('reload watcher ("Update everyone\'s app")', () => {
  it('a newer reloadAt: stores it, asks the service worker to update, activates the new worker and reloads once it takes control', async () => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const t = setup(NEW, { newWorker: true });
    await checkForReload(t.deps);
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe(NEW);
    expect(t.reg.update).toHaveBeenCalledTimes(1);
    expect(t.worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(t.reload).not.toHaveBeenCalled();
    t.swEvents.dispatchEvent(new Event('controllerchange'));
    t.swEvents.dispatchEvent(new Event('controllerchange'));
    await tick();
    expect(t.reload).toHaveBeenCalledTimes(1);
    // and the same value again does nothing
    await checkForReload(t.deps);
    await tick();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('a newer reloadAt with no new version: just reloads, once', async () => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const t = setup(NEW);
    await checkForReload(t.deps);
    await tick();
    expect(t.reg.update).toHaveBeenCalledTimes(1);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('a new worker that never takes control: reloads anyway after the wait, once', async () => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const t = setup(NEW, { newWorker: true });
    await checkForReload(t.deps);
    expect(t.reload).not.toHaveBeenCalled();
    await tick(100);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('with no service worker registration it just reloads', async () => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const t = setup(NEW);
    await checkForReload({ ...t.deps, getRegistration: async () => undefined });
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it.each([[OLD], ['2026-11-19T10:00:00.000Z'], [null]])('the same, an older or no reloadAt (%s) does nothing', async (value) => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const t = setup(value);
    await checkForReload(t.deps);
    await tick();
    expect(t.reg.update).not.toHaveBeenCalled();
    expect(t.reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe(OLD);
  });

  it('a device that never stored one only stores the current value (and still reloads for a later press)', async () => {
    const t = setup(NEW);
    await checkForReload(t.deps);
    await tick();
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe(NEW);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.reg.update).not.toHaveBeenCalled();

    localStorage.clear();
    const none = setup(null);
    await checkForReload(none.deps);
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe('');
    await checkForReload(setup(NEW).deps);
    await tick();
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe(NEW);
  });

  it('while a text field has focus it waits, then reloads after the field blurs', async () => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const t = setup(NEW);
    await checkForReload(t.deps);
    await tick();
    expect(t.reg.update).not.toHaveBeenCalled();
    expect(t.reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe(OLD); // not stored yet: coming back later still reloads
    input.blur();
    await tick(100);
    expect(localStorage.getItem(RELOAD_SEEN_KEY)).toBe(NEW);
    expect(t.reg.update).toHaveBeenCalledTimes(1);
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('if the value cannot be stored it never reloads (no loop)', async () => {
    localStorage.setItem(RELOAD_SEEN_KEY, OLD);
    const t = setup(NEW);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await checkForReload(t.deps);
    await tick();
    spy.mockRestore();
    expect(t.reload).not.toHaveBeenCalled();
  });
});
