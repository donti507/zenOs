import AccountControls from '../AccountControls';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useZenos } from '../../context/ZenosContext';
import { categoryTone } from '../../lib/utils';

const NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/board', label: 'Board', icon: 'view_kanban' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar_today' },
  { to: '/gallery', label: 'Gallery', icon: 'public' },
  { to: '/space', label: 'My Space', icon: 'dashboard_customize' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/lectures', label: 'Lectures', icon: 'school' },
  { to: '/meetings', label: 'Meetings', icon: 'videocam' },
  { to: '/analytics', label: 'Analytics', icon: 'monitoring' },
  { to: '/vault', label: 'Vault', icon: 'folder_special' },
];

const navClass = (collapsed: boolean) => ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 ${collapsed ? 'justify-center px-0' : 'px-4'} py-2 rounded-lg transition-colors ${
    isActive
      ? 'bg-primary-container text-on-primary-container font-medium'
      : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
  }`;

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { state, updateState, user, logOut, setShowModal, isOffline, spacePages } = useZenos();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const name: string = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'You';
  const initials = name.split(/\s+/).map((p: string) => p[0]).join('').slice(0, 2).toUpperCase();
  const openCount = (catId: string) => state.tasks.filter(t => t.cat === catId && t.status !== 'done').length;

  return (
    <aside
      className={`hidden md:flex fixed left-0 top-0 h-full ${collapsed ? 'w-[72px]' : 'w-60'} bg-surface-container-lowest z-50 flex-col justify-between shadow-soft transition-[width] duration-200`}
    >
      <div className="flex flex-col flex-1 overflow-y-auto overflow-x-hidden">
        {/* Logo */}
        <div className={`h-16 ${collapsed ? 'justify-center' : 'px-4'} flex items-center gap-2 shrink-0`}>
          <span className="w-8 h-8 rounded-xl bg-[conic-gradient(from_200deg,#5b5fef,#8b5cf6,#06b6d4,#5b5fef)] shadow-[0_0_16px_rgba(91,95,239,.35)]" aria-hidden="true" />
          {!collapsed && <span className="text-[16px] leading-6 font-semibold tracking-tight text-on-surface">ZEN OS</span>}
        </div>

        {/* Ask Dante */}
        <div className="px-2 mb-2">
          <NavLink
            to="/dante"
            title="Ask Dante"
            className={({ isActive }) =>
              `group relative flex items-center ${collapsed ? 'justify-center' : 'justify-between px-4'} py-2 rounded-lg transition-all ${
                isActive ? 'bg-surface-container ring-1 ring-primary/20' : 'bg-surface-container-low hover:bg-surface-container'
              }`
            }
          >
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center w-5 h-5">
                <span className="absolute w-4 h-4 rounded-full bg-primary-container blur-[3px]" style={{ animation: 'dante-breath 3s infinite ease-in-out' }} />
                <span className="relative material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
              </div>
              {!collapsed && <span className="font-medium text-on-surface">Ask Dante</span>}
            </div>
            {!collapsed && (
              <span className="text-[11px] leading-[14px] px-1.5 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-semibold tracking-wider">AI</span>
            )}
          </NavLink>
        </div>

        {/* Main nav */}
        <nav className="px-2 flex flex-col gap-1" aria-label="Main">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navClass(collapsed)} title={collapsed ? item.label : undefined}>
              <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {!collapsed&&!!spacePages?.length&&<nav className="mt-5 px-4 space-y-1" aria-label="My Space pages"><span className="block text-xs font-semibold text-on-surface-variant mb-2">Your pages</span>{spacePages.map(page=><NavLink key={page.id} to={`/space/${page.slug}`} className={({isActive})=>`block px-2 py-1.5 rounded-lg truncate text-sm ${isActive?'bg-primary-container text-on-primary-container':'text-on-surface-variant hover:bg-surface-container'}`} title={page.title}>{page.title}</NavLink>)}</nav>}
        {/* Categories */}
        {!collapsed && (
          <div className="mt-6 px-4">
            <div className="flex items-center justify-between pb-1">
              <span className="text-[12px] text-on-surface-variant font-semibold">Categories</span>
              <button className="text-on-surface-variant hover:text-on-surface cursor-pointer" type="button" onClick={() => setShowModal('addCategory')} aria-label="Add category">
                <span className="material-symbols-outlined text-[16px]">add</span>
              </button>
            </div>
            <div className="flex flex-col gap-1 mt-1">
              {state.categories.map(c => {
                const active = state.filterCat === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      updateState({ filterCat: active ? null : c.id });
                      navigate('/tasks');
                    }}
                    className={`flex items-center justify-between px-2 py-1.5 rounded-lg transition-colors cursor-pointer text-left ${active ? 'bg-surface-container text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${categoryTone(c).dot}`} />
                      <span className="truncate">{c.label}</span>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-medium">{openCount(c.id)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* User */}
      <div className={`relative p-2 bg-surface-container-low m-2 rounded-xl flex items-center ${collapsed ? 'flex-col gap-2' : 'justify-between'}`}>
        <button className="flex items-center gap-2 min-w-0 cursor-pointer text-left" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen} aria-label="Account menu">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center">
              <span className="text-[12px] font-semibold text-on-primary-container">{initials}</span>
            </div>
            <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface-container-low ${isOffline ? 'bg-warning' : 'bg-success'}`} />
          </div>
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-on-surface truncate leading-none">{name}</span>
              <span className="text-[11px] text-on-surface-variant mt-1 truncate">{isOffline ? 'Local mode' : 'Synced'}</span>
            </div>
          )}
        </button>
        <button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container transition-colors cursor-pointer" type="button" onClick={onToggle}>
          <span className="material-symbols-outlined text-[18px]">{collapsed ? 'left_panel_open' : 'left_panel_close'}</span>
        </button>

        {menuOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-52 bg-surface-container-lowest rounded-xl shadow-lg ring-1 ring-outline-variant py-1 z-50" role="menu">
            <div className="px-3 py-2 text-[12px] text-on-surface-variant truncate">{user?.email}</div>
            <AccountControls />
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-error hover:bg-surface-container cursor-pointer"
              role="menuitem"
              onClick={() => { setMenuOpen(false); logOut(); }}
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
