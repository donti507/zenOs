/** One place that maps the app's views to URLs. */
export const ROUTES = [
  { view: 'dashboard', path: '/', label: 'Home', icon: 'home' },
  { view: 'tasks', path: '/tasks', label: 'All tasks', icon: 'checklist' },
  { view: 'kanban', path: '/board', label: 'Board', icon: 'view_kanban' },
  { view: 'calendar', path: '/calendar', label: 'Calendar', icon: 'calendar_today' },
  { view: 'gallery', path: '/gallery', label: 'Gallery', icon: 'public' },
  { view: 'space', path: '/space', label: 'My Space', icon: 'dashboard_customize' },
  { view: 'search', path: '/search', label: 'Search', icon: 'search' },
  { view: 'lectures', path: '/lectures', label: 'Lectures', icon: 'school' },
  { view: 'meetings', path: '/meetings', label: 'Meetings', icon: 'videocam' },
  { view: 'analytics', path: '/analytics', label: 'Analytics', icon: 'monitoring' },
  { view: 'vault', path: '/vault', label: 'Vault', icon: 'folder_special' },
  { view: 'dante', path: '/dante', label: 'Ask Dante', icon: 'auto_awesome' },
] as const;

export const pathForView = (view: string) => ROUTES.find(r => r.view === view)?.path ?? '/';
export const routeForPath = (path: string) =>
  ROUTES.find(r => r.path === path) ?? ROUTES.find(r => r.path !== '/' && path.startsWith(r.path)) ?? ROUTES[0];

/** Billing return pages are account flows, not primary workspace navigation. */
export const BILLING_ROUTES = { upgrade: '/billing/upgrade', success: '/billing/success', cancel: '/billing/cancel' } as const;
