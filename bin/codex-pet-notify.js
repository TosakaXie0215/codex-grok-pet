#!/usr/bin/env node
/* Optional Codex `notify` adapter.
 * Add to ~/.codex/config.toml:
 *   notify = ["/usr/bin/env", "node", "/absolute/path/to/bin/codex-pet-notify.js"]
 * Note: Codex only supports one notify program, and an existing one may already
 * be configured. The desktop pet tails session rollouts by itself, so this hook
 * is only for people who want an explicit push.
 */
'use strict';

const http = require('http');
const path = (() => {
  try {
    const arg = JSON.parse(process.argv[2] || '{}');
    const type = String(arg.type || '');
    if (type === 'agent-turn-complete') return '/state?name=done&ttl=7000';
    if (type === 'agent-turn-start' || type === 'agent-turn-begin') return '/state?name=thinking';
    return '/state?name=working&ttl=12000';
  } catch {
    return '/state?name=working&ttl=12000';
  }
})();

const req = http.request(
  { hostname: '127.0.0.1', port: Number(process.env.CODEX_PET_PORT || 47821), path, method: 'GET', timeout: 1000 },
  (res) => res.resume()
);
req.on('error', () => process.exit(0)); // never block Codex because of the pet
req.on('timeout', () => {
  req.destroy();
  process.exit(0);
});
req.end();
