import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadSkin, setSkin } from './skin.ts';
import { startTheme } from './theme.ts';
import { startMarkClock } from './mark-clock.ts';
import { startWindowZoom } from './window-zoom.ts';
import { startOtherWindowWrites } from './other-window.ts';
import { startWindowDropTarget } from './window-drop.ts';
import { platformMark } from './mac-window-model.ts';
import { startErrorStacks } from './error-stack.ts';
import './style.css';

// M9 fix 1023: a Mac window's <html> says so before the first paint, so
// the title row starts past the traffic lights; a Windows window's carries
// no new attribute.
const mark = platformMark(window.emerald.platform);
if (mark !== null) document.documentElement.dataset['platform'] = mark;
// M9 fix 1128: an uncaught error's stack reaches main.log as one note line, so the next xterm loadCell burst names its frame.
startErrorStacks();
// M9 fix 569: the skin is on <html> and main has heard it before React
// renders, so an Emerald window never paints a Classic frame.
setSkin(loadSkin());
// M9 fix 1032: the theme is on <html> before React renders too, so a light
// window never paints a dark frame.
startTheme();
// M9 fix 925: another window's writes to the keys this window follows.
startOtherWindowWrites();
// M9 fix 767: the working marks' one clock, started before the first
// paint so a working mark already has a frame, and alive as long as the
// window.
startMarkClock();
// M9 fix 900: the window's zoom from the profile, before the first paint.
startWindowZoom();
// M9 fix 927: this window as the target of another window's drag.
startWindowDropTarget();

// No StrictMode: its double-mounted effects would attach and detach the PTY
// twice in development, producing two replays.
createRoot(document.getElementById('root')!).render(<App />);
