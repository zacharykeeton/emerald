// The small inline SVG icons that more than one component draws, so a
// button and the thing it makes wear the same picture (M9 fix 94: the
// group heading's panes button and the panes tab). An icon a single
// component owns stays with that component; this module is for the
// shared ones, and a later feature adds its icon here when a second
// place needs it.

interface IconProps {
  size?: number;
  className?: string;
}

// A square split into three panes, for a tab that is a split view and
// for the button that opens a group as one.
export function PanesIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M2 2h12v12H2z M8 2v12 M2 8h6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// A document tab's icon (M54): a clock, the activity view being a day.
export function ClockIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.5v3.8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// The same outline the files rail uses.
export function FileIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// A folder review tab's icon (M9 fix 199): the folder outline the
// sidebar's groups and the files rail's header draw.
export function FolderIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// A commits document tab's icon (M61): a fork, the line splitting and
// joining back, the same picture the graph draws.
export function GraphIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M5 2.5v11 M5 6c0 3 6 2 6 5.5 M11 2.5v2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="5" cy="2.5" r="1.4" fill="currentColor" />
      <circle cx="11" cy="2.5" r="1.4" fill="currentColor" />
      <circle cx="5" cy="13.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

// A window shade (M63): the pane's rectangle with the blind drawn across
// its top third, for the title button that pulls one over the pane.
// The What's New tab (M9 fix 227): a four-point spark, the mark release
// notes wear elsewhere, at the tab icons' size.
export function NewsIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8 6.4 6.4Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// The Statistics tab's icon (M9 fix 837): three bars.
export function StatsIcon({ size = 14, className = 'tab-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M3.5 13.5v-4 M8 13.5v-9 M12.5 13.5v-6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ShadeIcon({ size = 13, className = 'pane-shade-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M2.5 2.5h11v11h-11z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2.5 2.5h11v4h-11z" fill="currentColor" stroke="none" />
      <path d="M8 6.5v2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// The rail's two open buttons (M9 fix 219): a page with a raised tab
// standing on the left of its top edge, the shape the tab strip's own
// tabs have over the content, for the button that opens a graph or a
// day as a tab.
export function TabIcon({ size = 12, className = 'open-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M1.5 6.5h13v7.5h-13z M1.5 6.5v-3.5h5.5v3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// A square split once down the middle: the pane opens beside the focused
// one (PanesIcon's three-way split is the group's whole layout, a
// different thing).
export function PaneIcon({ size = 12, className = 'open-icon' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M1.5 2.5h13v11h-13z M8 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// A terminal, a rounded box with a prompt and a cursor (M9 fix 719): the
// chat box's `/` menu marks the commands only the terminal can draw with
// it. The same two paths as the face button's terminal (Pane.tsx's
// FaceIcon), which moves onto this one the next time it is touched.
export function TerminalIcon({ size = 12, className = 'chat-menu-terminal' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 6l2 2-2 2M8 10.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
