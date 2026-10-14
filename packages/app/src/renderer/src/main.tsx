import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadSkin, setSkin } from './skin.ts';
import './style.css';

// M9 fix 569: the skin is on <html> and main has heard it before React
// renders, so an Emerald window never paints a Classic frame.
setSkin(loadSkin());

// No StrictMode: its double-mounted effects would attach and detach the PTY
// twice in development, producing two replays.
createRoot(document.getElementById('root')!).render(<App />);
