import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { fileUrl, imageSrc, installImageSrc } from './markdown-url.ts';

const folder = 'C:\\docs\\notes';

test('a plain relative path resolves under the folder', () => {
  assert.equal(fileUrl(folder, 'images/a.png'), 'file:///C:/docs/notes/images/a.png');
  assert.equal(imageSrc(folder, 'images/a.png'), 'file:///C:/docs/notes/images/a.png');
});

test('a ../ path resolves the way a browser would', () => {
  assert.equal(fileUrl(folder, '../shared/b.png'), 'file:///C:/docs/shared/b.png');
});

test('the four scheme-relative spellings are refused', () => {
  for (const rel of ['//evil.example/share/a.png', '\\\\evil.example\\share\\a.png', '/\\evil.example/share/a.png', '\\/evil.example/share/a.png']) {
    assert.equal(fileUrl(folder, rel), '', rel);
    assert.equal(imageSrc(folder, rel), '', rel);
  }
});

test('http, https and data sources are left alone', () => {
  assert.equal(imageSrc(folder, 'https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(imageSrc(folder, 'data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

test('a relative src with no folder is left as written', () => {
  assert.equal(imageSrc(undefined, 'images/a.png'), 'images/a.png');
  assert.equal(imageSrc(undefined, '//evil.example/a.png'), '');
});

test('installImageSrc resolves a relative image against the env folder (M9 fix 716)', () => {
  const md = new MarkdownIt();
  installImageSrc(md);
  assert.ok(md.render('![x](a.png)', { folder: 'C:\\docs' }).includes('src="file:///C:/docs/a.png"'));
});
