import { describe, expect, it, vi } from 'vitest';
import { createMainnetPreparationRequestCoordinator } from './mainnetPreparationRequests';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Mainnet preparation request coordination', () => {
  it('makes StrictMode-style duplicate initial effects share one effective preparation request', async () => {
    const coordinator = createMainnetPreparationRequestCoordinator<string>();
    const response = deferred<string>();
    const request = vi.fn(() => response.promise);

    const initialEffect = coordinator.run('invoice:buyer:wNvda', request);
    const effectReplay = coordinator.run('invoice:buyer:wNvda', request);

    expect(initialEffect.isNew).toBe(true);
    expect(effectReplay.isNew).toBe(false);
    expect(effectReplay.ticket).toBe(initialEffect.ticket);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    response.resolve('prepared');
    await expect(initialEffect.ticket.promise).resolves.toBe('prepared');
    expect(coordinator.isLatest(initialEffect.ticket)).toBe(true);
  });

  it('prevents an older out-of-order success from replacing the latest successful preparation', async () => {
    const coordinator = createMainnetPreparationRequestCoordinator<string>();
    const oldResponse = deferred<string>();
    const latestResponse = deferred<string>();
    const displayed: string[] = [];
    const oldRequest = coordinator.run('invoice:old-buyer:wNvda', () => oldResponse.promise).ticket;
    const latestRequest = coordinator.run('invoice:current-buyer:wNvda', () => latestResponse.promise).ticket;

    latestResponse.resolve('latest-ready');
    const latestValue = await latestRequest.promise;
    if (coordinator.isLatest(latestRequest)) displayed.push(latestValue);

    oldResponse.resolve('stale-ready');
    const oldValue = await oldRequest.promise;
    if (coordinator.isLatest(oldRequest)) displayed.push(oldValue);

    expect(displayed).toEqual(['latest-ready']);
  });

  it('does not surface a stale failure after a newer preparation succeeded', async () => {
    const coordinator = createMainnetPreparationRequestCoordinator<string>();
    const oldResponse = deferred<string>();
    const latestResponse = deferred<string>();
    let displayed = '';
    let displayedError = '';
    const oldRequest = coordinator.run('invoice:old-buyer:wNvda', () => oldResponse.promise).ticket;
    const latestRequest = coordinator.run('invoice:current-buyer:wNvda', () => latestResponse.promise).ticket;

    latestResponse.resolve('latest-ready');
    const latestValue = await latestRequest.promise;
    if (coordinator.isLatest(latestRequest)) displayed = latestValue;
    oldResponse.reject(new Error('stale initial failure'));
    await expect(oldRequest.promise).rejects.toThrow('stale initial failure');
    if (coordinator.isLatest(oldRequest)) displayedError = 'stale initial failure';

    expect(displayed).toBe('latest-ready');
    expect(displayedError).toBe('');
  });

  it('allows the same preparation function to make a new request for explicit manual refresh', async () => {
    const coordinator = createMainnetPreparationRequestCoordinator<string>();
    let callCount = 0;
    const request = vi.fn(async () => `preparation-${++callCount}`);

    const initial = coordinator.run('invoice:buyer:wNvda', request);
    await expect(initial.ticket.promise).resolves.toBe('preparation-1');
    const refreshed = coordinator.run('invoice:buyer:wNvda', request);

    expect(refreshed.isNew).toBe(true);
    await expect(refreshed.ticket.promise).resolves.toBe('preparation-2');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
