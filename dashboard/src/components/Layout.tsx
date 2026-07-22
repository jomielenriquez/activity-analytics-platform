import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { label: 'Devices', to: '/' },
  { label: 'Stats', to: '/stats' },
  { label: 'Recent Activity', to: '/activity/recent' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <header className="layout-header">
        <h1 className="layout-title">Activity Analytics</h1>
        <nav className="layout-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-item nav-item--active' : 'nav-item')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="layout-main">{children}</main>
    </div>
  );
}
