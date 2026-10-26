// @vitest-environment jsdom
import React, { act, lazy, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OnFirstOpen from '../OnFirstOpen';
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('does not request a lazy module until its overlay is opened', async () => {
  const load = vi.fn(async () => ({ default: () => <p>Overlay</p> }));
  const Overlay = lazy(load);
  await act(async () => root.render(<OnFirstOpen open={false}><Overlay /></OnFirstOpen>));
  expect(load).not.toHaveBeenCalled();
  expect(host.textContent).toBe('');
  await act(async () => root.render(<OnFirstOpen open><Overlay /></OnFirstOpen>));
  expect(load).toHaveBeenCalledOnce();
  expect(host.textContent).toBe('Overlay');
});
it('retains the component across close/reopen so close effects and state survive', async () => {
  const closed = vi.fn();
  const unmounted = vi.fn();
  function Overlay({ open }: { open: boolean }) {
    const [count, setCount] = useState(0);
    useEffect(() => { if (!open) closed(); }, [open]);
    useEffect(() => () => unmounted(), []);
    return open ? <button onClick={() => setCount(c => c + 1)}>{count}</button> : null;
  }
  const render = (open: boolean) => act(async () => root.render(<OnFirstOpen open={open}><Overlay open={open} /></OnFirstOpen>));
  await render(true);
  await act(async () => host.querySelector('button')!.click());
  await render(false);
  expect(closed).toHaveBeenCalledOnce();
  expect(unmounted).not.toHaveBeenCalled();
  await render(true);
  expect(host.textContent).toBe('1');
});
it('keeps the surrounding UI visible while an overlay module loads', async () => {
  let resolve!: (module: { default: () => React.JSX.Element }) => void;
  const Overlay = lazy(() => new Promise<{ default: () => React.JSX.Element }>(done => { resolve = done; }));
  await act(async () => root.render(<><p>Workspace</p><OnFirstOpen open><Overlay /></OnFirstOpen></>));
  expect(host.textContent).toBe('Workspace');
  await act(async () => resolve({ default: () => <p>Overlay</p> }));
  expect(host.textContent).toBe('WorkspaceOverlay');
});
