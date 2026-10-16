import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadSkin, setSkin } from './skin.ts';
import { startMarkClock } from './mark-clock.ts';
import './style.css';

// M9 fix 569: the skin is on <html> and main has heard it before React
// renders, so an Emerald window never paints a Classic frame.
setSkin(loadSkin());
// M9 fix 767: the working marks' one clock, started before the first
// paint so a working mark already has a frame, and alive as long as the
// window.
startMarkClock();

// No StrictMode: its double-mounted effects would attach and detach the PTY
// twice in development, producing two replays.
createRoot(document.getElementById('root')!).render(<App />);
