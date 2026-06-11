import { navItems, type DashboardSectionId } from "./DashboardShell";

interface LeftNavProps {
  activeSection: DashboardSectionId;
  onSelectSection: (sectionId: DashboardSectionId) => void;
}

export function LeftNav({ activeSection, onSelectSection }: LeftNavProps): JSX.Element {
  return (
    <nav className="left-rail" aria-label="Studio sections">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeSection;

        return (
          <button
            key={item.id}
            type="button"
            className="rail-button"
            data-active={active}
            aria-controls={`${item.id}-section`}
            aria-current={active ? "page" : undefined}
            onClick={() => onSelectSection(item.id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="rail-label">{item.label}</span>
            <span className="rail-meta">{item.meta}</span>
          </button>
        );
      })}
    </nav>
  );
}
