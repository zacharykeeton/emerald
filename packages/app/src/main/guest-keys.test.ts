import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuestKeys } from './guest-keys.ts';
import type { GuestChord, GuestInput } from './guest-keys.ts';

// M9 fix 670: which keys pressed in a browser pane's page are the app's.

const chord = (code: string, mods: Partial<Omit<GuestChord, 'code'>> = {}): GuestChord => ({ code, ctrl: false, shift: false, alt: false, meta: false, ...mods });
const SPLIT = chord('KeyE', { ctrl: true, shift: true });
const PREFIX = chord('KeyB', { ctrl: true });
const key = (code: string, mods: Partial<Omit<GuestInput, 'code' | 'type'>> = {}, type = 'keyDown'): GuestInput => ({ type, code, control: false, shift: false, alt: false, meta: false, ...mods });

const configured = () => {
  const g = new GuestKeys();
  g.configure([SPLIT, chord('ArrowLeft', { alt: true })], PREFIX);
  return g;
};

test('a configured chord is the window\'s and a key not in the list is the page\'s', () => {
  const g = configured();
  assert.equal(g.decide(key('KeyE', { control: true, shift: true })), 'window');
  assert.equal(g.decide(key('KeyA')), 'page');
  assert.equal(g.decide(key('ArrowLeft', { alt: true })), 'window');
});

test('Ctrl+W and Ctrl+S stay with the page', () => {
  const g = configured();
  assert.equal(g.decide(key('KeyW', { control: true })), 'page');
  assert.equal(g.decide(key('KeyS', { control: true })), 'page');
});

test('the prefix arms, the next key is the window\'s and disarms, a modifier between does not disarm', () => {
  const g = configured();
  assert.equal(g.decide(key('KeyB', { control: true })), 'window');
  assert.equal(g.decide(key('ShiftLeft', { shift: true })), 'page');
  assert.equal(g.decide(key('KeyW')), 'window');
  assert.equal(g.decide(key('KeyW')), 'page');
});

test('the prefix twice is both the window\'s and the page\'s', () => {
  const g = configured();
  assert.equal(g.decide(key('KeyB', { control: true })), 'window');
  assert.equal(g.decide(key('KeyB', { control: true })), 'window-and-page');
  assert.equal(g.decide(key('KeyA')), 'page');
});

test('armed from the renderer, the next key is the window\'s', () => {
  const g = configured();
  g.setArmed(true);
  assert.equal(g.decide(key('KeyQ')), 'window');
  assert.equal(g.decide(key('KeyQ')), 'page');
});

test('Ctrl+R reloads the page and Ctrl+Shift+R hard; Ctrl+Alt+R is the page\'s', () => {
  const g = configured();
  assert.equal(g.decide(key('KeyR', { control: true })), 'reload');
  assert.equal(g.decide(key('KeyR', { control: true, shift: true })), 'reload-hard');
  assert.equal(g.decide(key('KeyR', { control: true, alt: true })), 'page');
});

test('a keyUp is always the page\'s and a rawKeyDown decides as a keyDown', () => {
  const g = configured();
  assert.equal(g.decide(key('KeyE', { control: true, shift: true }, 'keyUp')), 'page');
  assert.equal(g.decide(key('KeyB', { control: true }, 'keyUp')), 'page');
  assert.equal(g.decide(key('KeyE', { control: true, shift: true }, 'rawKeyDown')), 'window');
  assert.equal(g.decide(key('KeyE', { control: true, shift: true }, 'char')), 'page');
});

test('a reconfigured prefix replaces the old one', () => {
  const g = configured();
  g.configure([SPLIT], chord('Space', { ctrl: true }));
  assert.equal(g.decide(key('KeyB', { control: true })), 'page');
  assert.equal(g.decide(key('Space', { control: true })), 'window');
  assert.equal(g.decide(key('KeyO')), 'window');
});

test('with nothing configured the default prefix still arms', () => {
  const g = new GuestKeys();
  assert.equal(g.decide(key('KeyB', { control: true })), 'window');
  assert.equal(g.decide(key('KeyE', { control: true, shift: true })), 'window');
});
