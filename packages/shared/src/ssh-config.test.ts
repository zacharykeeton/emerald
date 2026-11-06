import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sshConfigHosts } from './ssh-config.ts';

const CONFIG = [
  '# the person\'s config',
  'Host *',
  '  ServerAliveInterval 30',
  '',
  'Host wfs-db',
  '  HostName 192.0.2.7',
  '  User zacha',
  '',
  'Host a b',
  '  Port 2222',
  'Host web-?',
  '  User nobody',
  'Match host x',
  '  Host not-a-host',
  '  HostName wrong',
  'Host c',
  '  hostname=h2',
  'Host wfs-db',
  '  HostName elsewhere',
  'Include more.conf',
].join('\r\n');

test('sshConfigHosts: wildcards and Match skipped, two-name lines split, the first wfs-db kept (M9 fix 1080)', () => {
  assert.deepEqual(sshConfigHosts(CONFIG), [
    { name: 'wfs-db', destination: 'zacha@192.0.2.7' },
    { name: 'a', destination: 'a' },
    { name: 'b', destination: 'b' },
    { name: 'c', destination: 'h2' },
  ]);
});

test('sshConfigHosts: an empty file is no hosts (M9 fix 1080)', () => {
  assert.deepEqual(sshConfigHosts(''), []);
});
