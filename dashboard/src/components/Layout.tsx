import type { ReactNode } from 'react';

// No router yet — deliberately. This nav is a static placeholder marking
// where the other views slot in once they exist (each becomes a real
// route + link when built); for now only "Devices" does anything.
const NAV_ITEMS = [
  { label: 'Devices', active: true },
  { label: 'Timeline', active: false },
  { label: 'Stats', active: false },
  { label: 'Recent Activity', active: false },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <header className="layout-header">
        <h1 className="layout-title">Activity Analytics</h1>
        <nav className="layout-nav">
          {NAV_ITEMS.map((item) => (
            <span
              key={item.label}
              className={item.active ? 'nav-item nav-item--active' : 'nav-item nav-item--placeholder'}
              title={item.active ? undefined : 'Not built yet'}
            >
              {item.label}
            </span>
          ))}
        </nav>
      </header>
      <main className="layout-main">{children}</main>
    </div>
  );
}
