// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
it.each(['default','denied'] as const)('never repeats a native permission request after %s',async result=>{
  vi.resetModules();localStorage.clear();
  const requestPermission=vi.fn().mockResolvedValue(result);
  vi.stubGlobal('Notification',{permission:'default',requestPermission});
  const permission=await import('../taskNotifications');
  expect(await permission.requestTaskNotifications()).toBe(result);
  await permission.requestTaskNotifications();
  expect(requestPermission).toHaveBeenCalledOnce();
});
