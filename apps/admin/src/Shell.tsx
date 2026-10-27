import { useEffect, useState, type ReactNode } from 'react';
import {
  CreditCard,
  FileText,
  LifeBuoy,
  Menu,
  MoreHorizontal,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { Me } from './api';

/**
 * The platform console shell. The same tokens and layout as the merchant
 * dashboard, with one deliberate difference: the role label is always
 * visible, in red, so this can never be mistaken for a store view.
 */

export type Tab = 'stores' | 'leads' | 'subscriptions' | 'support' | 'safety' | 'audit' | 'settings';

interface NavItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
}

export const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Platform',
    items: [
      { id: 'stores', label: 'Stores', icon: Store },
      { id: 'leads', label: 'Leads', icon: FileText },
      { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
      { id: 'support', label: 'Support', icon: LifeBuoy },
      { id: 'safety', label: 'Safety', icon: ShieldAlert },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'audit', label: 'Audit log', icon: ScrollText },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const TAB_LABEL: Record<Tab, string> = Object.fromEntries(
  NAV.flatMap((group) => group.items.map((item) => [item.id, item.label])),
) as Record<Tab, string>;

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

interface ShellProps {
  me: Me;
  active: Tab;
  badges: { subscriptions: number; safety: number };
  idleWarning: boolean;
  onNavigate: (tab: Tab) => void;
  onSignOut: () => void;
  children: ReactNode;
}

export function Shell({
  me,
  active,
  badges,
  idleWarning,
  onNavigate,
  onSignOut,
  children,
}: ShellProps) {
  const [menu, setMenu] = useState<'user' | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const online = useOnline();
  const clock = useClock();

  const go = (tab: Tab) => {
    onNavigate(tab);
    setMenu(null);
    setNavOpen(false);
  };

  useEffect(() => {
    if (menu === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);

  return (
    <div className="shell">
      <aside className={navOpen ? 'sidebar open' : 'sidebar'} aria-label="Platform sections">
        <div className="sidebrand">
          <span className="mark">O</span>
          <div>
            <div className="name">OmaPointii</div>
            <div className="sub">Platform Admin</div>
          </div>
        </div>

        <div className="storeswitch" aria-label="Scope: every store">
          <span className="avatar" style={{ backgroundColor: 'var(--danger)' }}>
            <ShieldCheck size={16} strokeWidth={2} />
          </span>
          <span className="meta">
            <strong>All stores</strong>
            <span>Platform scope</span>
          </span>
        </div>

        {NAV.map((group) => (
          <nav className="navgroup" key={group.label} aria-label={group.label}>
            <div className="navlabel">{group.label}</div>
            {group.items.map((item) => {
              const count =
                item.id === 'subscriptions'
                  ? badges.subscriptions
                  : item.id === 'safety'
                    ? badges.safety
                    : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === active ? 'navitem active' : 'navitem'}
                  aria-current={item.id === active ? 'page' : undefined}
                  onClick={() => go(item.id)}
                >
                  <span className="icon" aria-hidden="true">
                    <item.icon size={16} strokeWidth={1.9} />
                  </span>
                  {item.label}
                  {count > 0 && <span className="count alert">{count}</span>}
                </button>
              );
            })}
          </nav>
        ))}

        <div className="sidefoot">
          <span className={online ? 'statuschip' : 'statuschip offline'}>
            <span className="dot" aria-hidden="true" />
            {online ? `Online · ${clock}` : 'Offline · changes will fail'}
          </span>

          <button
            type="button"
            className="usermenu"
            aria-haspopup="menu"
            aria-expanded={menu === 'user'}
            onClick={() => setMenu(menu === 'user' ? null : 'user')}
          >
            <span className="avatar round" style={{ backgroundColor: 'var(--danger)' }}>
              {initials(me.staff.name === '' ? me.staff.email : me.staff.name)}
            </span>
            <span className="meta">
              <strong>{me.staff.name === '' ? me.staff.email : me.staff.name}</strong>
              <span>Platform admin</span>
            </span>
            <MoreHorizontal size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>

          {menu === 'user' && (
            <div className="popover" role="menu" aria-label="Account">
              <div className="pophead">
                <strong>{me.staff.name === '' ? me.staff.email : me.staff.name}</strong>
                <span>{me.staff.email}</span>
              </div>
              <button type="button" role="menuitem" onClick={() => go('settings')}>
                Settings
              </button>
              <div className="sep" />
              <button type="button" role="menuitem" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="main">
        {idleWarning && (
          <p className="idlewarn" role="status">
            Signing out in a minute — touch the screen to stay signed in.
          </p>
        )}
        <header className="topbar">
          <button
            type="button"
            className="menubtn"
            aria-label="Open sections"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="crumbs">
            <span>Platform</span>
            <span className="sep" aria-hidden="true">
              /
            </span>
            <span className="here">{TAB_LABEL[active]}</span>
          </div>
          <div className="topactions">
            <span className="pill danger">
              <ShieldCheck size={12} strokeWidth={2.2} aria-hidden="true" />
              Platform admin
            </span>
            <span className="pill">All stores</span>
          </div>
        </header>

        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
