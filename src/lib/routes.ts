import {tr} from '../i18n';
/** One place that maps the app's views to URLs. */
export const ROUTES = [
  { view:'workspaces',path:'/workspaces',get label(){return tr('Workspaces');},icon:'group' },
  { view: 'dashboard', path: '/', get label(){return tr('Home');}, icon: 'home' },
  { view: 'tasks', path: '/tasks', get label(){return tr('All tasks');}, icon: 'checklist' },
  { view: 'kanban', path: '/board', get label(){return tr('Board');}, icon: 'view_kanban' },
  { view: 'calendar', path: '/calendar', get label(){return tr('Calendar');}, icon: 'calendar_today' },
  { view: 'focus_rooms', path: '/focus-rooms', get label(){return tr('Focus Rooms');}, icon: 'groups' },
  { view: 'gallery', path: '/gallery', get label(){return tr('Gallery');}, icon: 'public' },
  { view: 'space', path: '/space', get label(){return tr('My Space');}, icon: 'dashboard_customize' },
  { view: 'search', path: '/search', get label(){return tr('Search');}, icon: 'search' },
  { view: 'lectures', path: '/lectures', get label(){return tr('Lectures');}, icon: 'school' },
  { view: 'meetings', path: '/meetings', get label(){return tr('Meetings');}, icon: 'videocam' },
  { view: 'analytics', path: '/analytics', get label(){return tr('Analytics');}, icon: 'monitoring' },
  { view: 'vault', path: '/vault', get label(){return tr('Vault');}, icon: 'folder_special' },
  { view: 'dante', path: '/dante', get label(){return tr('Ask Dante');}, icon: 'auto_awesome' },
] as const;

export const pathForView = (view: string) => ROUTES.find(r => r.view === view)?.path ?? '/';
export const routeForPath = (path: string) =>
  ROUTES.find(r => r.path === path) ?? ROUTES.find(r => r.path !== '/' && path.startsWith(r.path)) ?? ROUTES[0];

/** Billing return pages are account flows, not primary workspace navigation. */
export const BILLING_ROUTES = { upgrade: '/billing/upgrade', success: '/billing/success', cancel: '/billing/cancel' } as const;
