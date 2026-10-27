#!/usr/bin/env node
/* Tiny CLI for the local Codex Pet control API.
 *   node bin/codex-pet.js working
 *   node bin/codex-pet.js poke
 *   node bin/codex-pet.js ping
 */
'use strict';

const http = require('http');
const VALID = ['idle', 'curious', 'thinking', 'working', 'done', 'error', 'sleep', 'happy', 'surprised'];
const port = Number(process.env.CODEX_PET_PORT || 47821);
const arg = (process.argv[2] || 'ping').toLowerCase();

function request(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  try {
    let path;
    if (arg === 'ping') path = '/ping';
    else if (arg === 'poke' || arg === 'hello') path = '/poke';
    else if (VALID.includes(arg)) path = `/state?name=${arg}`;
    else {
      console.error(`usage: codex-pet <${['ping', 'poke', ...VALID].join('|')}>`);
      process.exit(2);
    }
    const res = await request(path);
    console.log(res.body);
    process.exit(res.status === 200 ? 0 : 1);
  } catch (err) {
    console.error(`Codex Pet is not running (${err.message}). Start it with: npm start`);
    process.exit(1);
  }
})();
