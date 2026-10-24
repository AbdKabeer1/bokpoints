import { useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  ChevronDown,
  CreditCard,
  Gift,
  House,
  LifeBuoy,
  Menu,
  MoreHorizontal,
  MapPin,
  Megaphone,
  Percent,
  Printer,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Store,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Membership, Me } from './api';

/**
 * The one shell for the store dashboard (brief §3): brand, store and role
 * switcher, grouped navigation with counts, connection chip and a user menu
 * that always offers sign-out. The page header belongs to each screen.
 */

export type Tab =
  | 'home'
  | 'rules'
  | 'rewards'
  | 'discount'
  | 'campaigns'
  | 'customers'
  | 'profile'
  | 'branches'
  | 'people'
  | 'sign'
  | 'reports'
  | 'audit'
  | 'notifications'
  | 'billing'
  | 'settings'
  | 'support';

interface NavItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
}

export const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ id: 'home', label: 'Home', icon: House }],
  },
  {
    label: 'Program',
    items: [
      { id: 'rules', label: 'Rules', icon: SlidersHorizontal },
      { id: 'rewards', label: 'Rewards', icon: Gift },
      { id: 'discount', label: 'Discount', icon: Percent },
      { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
    ],
  },
  {
    label: 'Customers',
    items: [{ id: 'customers', label: 'Customers', icon: Users }],
  },
  {
    label: 'Store',
    items: [
      { id: 'profile', label: 'Store profile', icon: Store },
      { id: 'branches', label: 'Branches', icon: MapPin },
      { id: 'people', label: 'People', icon: UserCog },
      { id: 'sign', label: 'Counter sign', icon: Printer },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'audit', label: 'Audit log', icon: ScrollText },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'billing', label: 'Plan & billing', icon: CreditCard },
      { id: 'support', label: 'Support & FAQ', icon: LifeBuoy },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const TAB_LABEL: Record<Tab, string> = Object.fromEntries(
  NAV.flatMap((group) => group.items.map((item) => [item.id, item.label])),
) as Record<Tab, string>;

export const initials = (name: string): string =>
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
  membership: Membership;
  active: Tab;
  attention: number;
  campaigns: number;
  avatarColor: string;
  idleWarning: boolean;
  onNavigate: (tab: Tab) => void;
  onSwitchStore: (storeId: string) => void;
  onSignOut: () => void;
  children: ReactNode;
}

export function Shell({
  me,
  membership,
  active,
  attention,
  campaigns,
  avatarColor,
  idleWarning,
  onNavigate,
  onSwitchStore,
  onSignOut,
  children,
}: ShellProps) {
  const [menu, setMenu] = useState<'store' | 'user' | null>(null);
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

  const roleLabel =
    membership.role === 'owner' ? 'Owner' : membership.role === 'manager' ? 'Manager' : 'Cashier';

  return (
    <div className="shell">
      <aside className={navOpen ? 'sidebar open' : 'sidebar'} aria-label="Sections">
        <div className="sidebrand">
          <span className="mark">P</span>
          <div>
            <div className="name">Poket</div>
            <div className="sub">Merchant Platform</div>
          </div>
        </div>

        <button
          type="button"
          className="storeswitch"
          aria-haspopup="menu"
          aria-expanded={menu === 'store'}
          onClick={() => setMenu(menu === 'store' ? null : 'store')}
        >
          <span className="avatar" style={{ backgroundColor: avatarColor }}>
            {initials(membership.storeName)}
          </span>
          <span className="meta">
            <strong>{membership.storeName}</strong>
            <span>
              {roleLabel}
              {membership.locationName === null ? ' · all branches' : ` · ${membership.locationName}`}
            </span>
          </span>
          <ChevronDown size={15} strokeWidth={1.9} aria-hidden="true" />
        </button>

        {menu === 'store' && (
          <div className="popover" role="menu" aria-label="Switch store or role">
            <div className="pophead">
              <strong>Switch store or role</strong>
              <span>You work at {me.memberships.length} store(s).</span>
            </div>
            {me.memberships.map((entry) => (
              <button
                key={entry.storeId}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSwitchStore(entry.storeId);
                  setMenu(null);
                }}
              >
                {entry.storeName} · {entry.role === 'owner' ? 'Owner' : entry.role === 'manager' ? 'Manager' : 'Cashier'}
                {entry.storeId === membership.storeId ? ' ✓' : ''}
              </button>
            ))}
            <div className="sep" />
            <button type="button" role="menuitem" onClick={() => go('profile')}>
              Store profile and logo
            </button>
          </div>
        )}

        {NAV.map((group) => (
          <nav className="navgroup" key={group.label} aria-label={group.label}>
            <div className="navlabel">{group.label}</div>
            {group.items.map((item) => {
              const count =
                item.id === 'notifications' ? attention : item.id === 'campaigns' ? campaigns : 0;
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
                  {count > 0 && (
                    <span className={item.id === 'notifications' ? 'count alert' : 'count'}>
                      {count}
                    </span>
                  )}
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
            <span className="avatar round" style={{ backgroundColor: 'var(--green-deep)' }}>
              {initials(me.staff.name === '' ? me.staff.email : me.staff.name)}
            </span>
            <span className="meta">
              <strong>{me.staff.name === '' ? me.staff.email : me.staff.name}</strong>
              <span>
                {roleLabel} · {membership.storeName}
              </span>
            </span>
            <MoreHorizontal size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>

          {menu === 'user' && (
            <div className="popover" role="menu" aria-label="Account">
              <div className="pophead">
                <strong>{me.staff.name === '' ? me.staff.email : me.staff.name}</strong>
                <span>{me.staff.email}</span>
              </div>
              <button type="button" role="menuitem" onClick={() => go('profile')}>
                Store profile
              </button>
              <button type="button" role="menuitem" onClick={() => go('notifications')}>
                Notifications
              </button>
              <button type="button" role="menuitem" onClick={() => go('support')}>
                Support &amp; FAQ
              </button>
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
            <span>{membership.storeName}</span>
            <span className="sep" aria-hidden="true">
              /
            </span>
            <span className="here">{TAB_LABEL[active]}</span>
          </div>
          <div className="topactions">
            <span className="pill info">
              <span className="dot" aria-hidden="true" />
              {roleLabel}
            </span>
            <span className="pill">{membership.locationName ?? 'All branches'}</span>
          </div>
        </header>

        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
