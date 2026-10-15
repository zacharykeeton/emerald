import type { DesignPick } from '@emerald/shared';

// Design Mode's half inside the page (M9 fix 674): the picker that runs in
// the browser pane's guest and the pure rules main applies to what it
// answers. No electron import, so node:test reaches it; index.ts runs the
// script with executeJavaScript and wires the rest.

// The pill's words, the same rule as designLabel in @emerald/shared. The
// page script cannot import, so it carries this copy, and the unit test
// runs it beside designLabel on the same cases.
export const DESIGN_LABEL_SOURCE = String.raw`function emeraldDesignLabel(p) {
  var label = p.tag;
  if (p.role !== null) label += ' role="' + p.role + '"';
  if (p.text !== '') label += ' "' + (p.text.length > 30 ? p.text.slice(0, 30) + '…' : p.text) + '"';
  return label + ' ' + p.rect.width + 'x' + p.rect.height;
}`;

// The picker, one plain-JavaScript IIFE run in the page's main world (a
// React fiber is a property the isolated world cannot see). It answers a
// promise of the pick on a left click and of null on a cancel, and leaves
// hovered, hide, show and cancel on the page's global for main. Hit
// testing is synchronous in the mousemove handler, never in a frame
// callback, since an off-screen or covered window may get no frames. The
// catcher sits in a closed shadow root, and every pointer event aimed at
// it is stopped at the window's capture phase, so the page sees no click.
export const DESIGN_GUEST_SCRIPT = String.raw`(function () {
  var KEY = Symbol.for('emerald.design');
  var existing = window[KEY];
  if (existing && existing.installed) return existing.promise;
  ` + DESIGN_LABEL_SOURCE + String.raw`
  var PROPS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'border', 'border-radius', 'box-shadow', 'gap'];
  var ALWAYS = { display: true, width: true, height: true };
  var SKIP = ['', 'none', 'normal', 'auto', 'static', '0px', 'rgba(0, 0, 0, 0)'];
  function fold(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function cut(s, n) { return s.length > n ? s.slice(0, n) : s; }
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s; }
  function uniqueId(el) {
    if (!el.id) return false;
    try { return document.querySelectorAll('#' + esc(el.id)).length === 1; } catch (e) { return false; }
  }
  function sameTagIndex(el) {
    var parent = el.parentElement;
    if (!parent) return { count: 1, index: 1 };
    var count = 0, index = 1;
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      if (c.tagName === el.tagName) { count++; if (c === el) index = count; }
    }
    return { count: count, index: index };
  }
  function stepOf(el) {
    var s = el.tagName.toLowerCase();
    var classes = Array.prototype.slice.call(el.classList || [], 0, 2);
    for (var i = 0; i < classes.length; i++) s += '.' + esc(classes[i]);
    var n = sameTagIndex(el);
    if (n.count > 1) s += ':nth-of-type(' + n.index + ')';
    return s;
  }
  function nthPath(el) {
    var parts = [];
    for (var cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      parts.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + sameTagIndex(cur).index + ')');
    }
    return parts.join(' > ');
  }
  function selectorOf(el) {
    if (uniqueId(el)) return '#' + esc(el.id);
    var parts = [];
    for (var cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (cur !== el && uniqueId(cur)) { parts.unshift('#' + esc(cur.id)); break; }
      if (cur.tagName.toLowerCase() === 'body') { parts.unshift('body'); break; }
      parts.unshift(stepOf(cur));
    }
    var sel = parts.join(' > ');
    try {
      var hits = document.querySelectorAll(sel);
      if (hits.length === 1 && hits[0] === el) return sel;
    } catch (e) {}
    return nthPath(el);
  }
  function roleOf(el) {
    var attr = el.getAttribute('role');
    if (attr) return attr;
    var tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return type;
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    return null;
  }
  function htmlOf(el) {
    var clone = el.cloneNode(true);
    var scripts = clone.querySelectorAll ? clone.querySelectorAll('script') : [];
    for (var i = 0; i < scripts.length; i++) scripts[i].remove();
    if (clone.tagName && clone.tagName.toLowerCase() === 'script') return '';
    var html = clone.outerHTML || '';
    return html.length > 4096 ? html.slice(0, 4096) + '\n… (cut at 4 KB)' : html;
  }
  function stylesOf(el) {
    var cs = getComputedStyle(el);
    var out = [];
    for (var i = 0; i < PROPS.length; i++) {
      var name = PROPS[i];
      var value = cs.getPropertyValue(name);
      if (!ALWAYS[name] && (SKIP.indexOf(value) >= 0 || value.indexOf('0px none') === 0)) continue;
      out.push([name, value]);
    }
    return out;
  }
  function sourceOf(el) {
    var keys = Object.keys(el);
    var fiber = null;
    for (var i = 0; i < keys.length; i++) if (keys[i].indexOf('__reactFiber$') === 0) { fiber = el[keys[i]]; break; }
    for (var step = 0; fiber && step < 10; step++, fiber = fiber.return) {
      var s = fiber._debugSource;
      if (s && s.fileName) return s.fileName + ':' + s.lineNumber + ':' + s.columnNumber;
    }
    return null;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }
  function pickOf(el) {
    var own = el.innerText || '';
    var parentText = el.parentElement ? el.parentElement.innerText || '' : '';
    var at = own === '' ? -1 : parentText.indexOf(own);
    var nearby = at < 0 ? parentText : parentText.slice(0, at) + ' ' + parentText.slice(at + own.length);
    return {
      url: location.origin + location.pathname,
      viewport: { width: innerWidth, height: innerHeight },
      dpr: devicePixelRatio,
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      text: cut(fold(own), 200),
      html: htmlOf(el),
      styles: stylesOf(el),
      rect: rectOf(el),
      nearby: cut(fold(nearby), 200),
      source: sourceOf(el),
    };
  }

  var host = document.createElement('div');
  host.setAttribute('data-emerald-design-host', '');
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; margin: 0; padding: 0; border: 0; background: transparent;';
  var root = host.attachShadow({ mode: 'closed' });
  var catcher = document.createElement('div');
  catcher.setAttribute('data-emerald-design', 'catcher');
  catcher.style.cssText = 'position: absolute; inset: 0; background: transparent; cursor: crosshair;';
  var outline = document.createElement('div');
  outline.setAttribute('data-emerald-design', 'outline');
  outline.style.cssText = 'position: absolute; display: none; border: 2px solid #10b981; box-sizing: border-box; pointer-events: none;';
  var label = document.createElement('div');
  label.setAttribute('data-emerald-design', 'label');
  label.style.cssText = 'position: absolute; display: none; padding: 2px 6px; border-radius: 4px; color: #ffffff; background: rgba(17, 24, 39, 0.92); font: 12px/18px system-ui, sans-serif; white-space: nowrap; pointer-events: none;';
  root.appendChild(catcher);
  root.appendChild(outline);
  root.appendChild(label);

  var hoveredEl = null;
  var settle;
  var promise = new Promise(function (resolve) { settle = resolve; });
  var state = { installed: true, promise: promise };

  function hitAt(x, y) {
    host.style.pointerEvents = 'none';
    catcher.style.pointerEvents = 'none';
    var el = document.elementFromPoint(x, y);
    host.style.pointerEvents = '';
    catcher.style.pointerEvents = '';
    if (!el || el === host || el === document.documentElement) return null;
    return el;
  }
  function place(el) {
    hoveredEl = el;
    if (!el) { outline.style.display = 'none'; label.style.display = 'none'; return; }
    var r = rectOf(el);
    outline.style.display = 'block';
    outline.style.left = r.x + 'px';
    outline.style.top = r.y + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
    label.textContent = emeraldDesignLabel({ tag: el.tagName.toLowerCase(), role: roleOf(el), text: cut(fold(el.innerText || ''), 200), rect: r });
    label.style.display = 'block';
    label.style.left = r.x + 'px';
    label.style.top = (r.y < 24 ? r.y + r.height + 2 : r.y - 22) + 'px';
  }
  function ours(e) {
    var path = e.composedPath ? e.composedPath() : [];
    return path.indexOf(host) >= 0;
  }
  var STOPPED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'dblclick', 'contextmenu'];
  function stop(e) {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function onMove(e) {
    if (!ours(e)) return;
    e.stopImmediatePropagation();
    place(hitAt(e.clientX, e.clientY));
  }
  function onClick(e) {
    if (!ours(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.button !== 0) return;
    var el = hitAt(e.clientX, e.clientY) || hoveredEl;
    if (!el) return;
    place(el);
    settle(pickOf(el));
  }
  function teardown() {
    for (var i = 0; i < STOPPED.length; i++) window.removeEventListener(STOPPED[i], stop, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    host.remove();
    state.installed = false;
  }
  for (var i = 0; i < STOPPED.length; i++) window.addEventListener(STOPPED[i], stop, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('click', onClick, true);

  state.hovered = function () { return hoveredEl && hoveredEl.isConnected ? pickOf(hoveredEl) : null; };
  state.hide = function () { host.style.display = 'none'; };
  state.show = function () { host.style.display = ''; };
  state.cancel = function () { settle(null); teardown(); };
  window[KEY] = state;
  document.documentElement.appendChild(host);
  return promise;
})()`;

// Run in the page after the picker's answer or for a key, each through
// executeJavaScript in the main world.
export const DESIGN_CALL = {
  hovered: "(function () { var s = window[Symbol.for('emerald.design')]; return s && s.installed ? s.hovered() : null; })()",
  hide: "(function () { var s = window[Symbol.for('emerald.design')]; if (s && s.installed) s.hide(); })()",
  show: "(function () { var s = window[Symbol.for('emerald.design')]; if (s && s.installed) s.show(); })()",
  cancel: "(function () { var s = window[Symbol.for('emerald.design')]; if (s && s.installed) s.cancel(); })()",
  // Two frames for the hidden overlay to leave the compositor, or 100 ms
  // when the window gets no frames (off screen, covered), whichever first.
  settle: 'new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); setTimeout(r, 100); })',
} as const;

export type GrabKey = 'copy' | 'shot' | 'cancel';

// The three keys of a grab, read off the guest's before-input-event: C
// copies the hovered element as markdown, S its crop, Escape ends it.
// A keyUp answers too, so the handler can keep it from the page; a
// rawKeyDown is a keyDown, as guest-keys.ts reads it.
export function grabKey(input: { type: string; code: string; control: boolean; shift: boolean; alt: boolean; meta: boolean }): GrabKey | null {
  if (input.type !== 'keyDown' && input.type !== 'rawKeyDown' && input.type !== 'keyUp') return null;
  if (input.control || input.shift || input.alt || input.meta) return null;
  if (input.code === 'KeyC') return 'copy';
  if (input.code === 'KeyS') return 'shot';
  if (input.code === 'Escape') return 'cancel';
  return null;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The crop: the element's box inside the viewport, or null when none of
// it is on screen.
export function clipRect(rect: Rect, viewport: { width: number; height: number }): Rect | null {
  const left = Math.max(0, Math.round(rect.x));
  const top = Math.max(0, Math.round(rect.y));
  const right = Math.min(Math.round(viewport.width), Math.round(rect.x + rect.width));
  const bottom = Math.min(Math.round(viewport.height), Math.round(rect.y + rect.height));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

// The crop's file name, the local time to the millisecond so two crops a
// second apart never share a name.
export function shotName(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}.png`;
}

function isString(v: unknown, cap: number): v is string {
  return typeof v === 'string' && v.length <= cap;
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function rectOf(v: unknown, fields: readonly string[]): Record<string, number> | null {
  if (typeof v !== 'object' || v === null) return null;
  const out: Record<string, number> = {};
  for (const f of fields) {
    const n = (v as Record<string, unknown>)[f];
    if (!isNumber(n)) return null;
    out[f] = n;
  }
  return out;
}

// The page's answer, taken as untrusted: a page can reach the picker's
// global and resolve its promise with anything, so every field is typed
// and capped here before it is written into a paste.
export function readPick(value: unknown): DesignPick | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const viewport = rectOf(v.viewport, ['width', 'height']);
  const rect = rectOf(v.rect, ['x', 'y', 'width', 'height']);
  if (viewport === null || rect === null || !isNumber(v.dpr)) return null;
  if (!isString(v.url, 4096) || !isString(v.selector, 1024) || !isString(v.tag, 64)) return null;
  if (!(v.role === null || isString(v.role, 64))) return null;
  if (!isString(v.text, 200) || !isString(v.nearby, 200) || !isString(v.html, 4200)) return null;
  if (!(v.source === null || isString(v.source, 1024))) return null;
  if (!Array.isArray(v.styles) || v.styles.length > 16) return null;
  const styles: Array<[string, string]> = [];
  for (const pair of v.styles) {
    if (!Array.isArray(pair) || pair.length !== 2 || !isString(pair[0], 300) || !isString(pair[1], 300)) return null;
    styles.push([pair[0], pair[1]]);
  }
  return {
    url: v.url,
    viewport: { width: viewport.width!, height: viewport.height! },
    dpr: v.dpr,
    selector: v.selector,
    tag: v.tag,
    role: v.role,
    text: v.text,
    html: v.html,
    styles,
    rect: { x: rect.x!, y: rect.y!, width: rect.width!, height: rect.height! },
    nearby: v.nearby,
    source: v.source,
  };
}
