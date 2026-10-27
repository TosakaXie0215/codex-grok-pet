const fs = require('fs');
const path = require('path');
const { CodexWatcher } = require('../src/codex-watch');

const root = path.join(__dirname, '..', '.data', 'test-sessions');
fs.rmSync(root, { recursive: true, force: true });
const dir = path.join(root, '2026', '10', '27');
fs.mkdirSync(dir, { recursive: true });

const meta = (threadSource) => JSON.stringify({
  timestamp: new Date().toISOString(), type: 'session_meta',
  payload: { id: 'x', thread_source: threadSource || 'user', source: threadSource ? { subagent: { other: threadSource } } : undefined }
});

const primary = path.join(dir, 'rollout-primary.jsonl');
const guardian = path.join(dir, 'rollout-guardian.jsonl');
fs.writeFileSync(primary, meta('') + '\n');
fs.writeFileSync(guardian, meta('guardian_review') + '\n');
// guardian is newer
const now = Date.now() / 1000;
fs.utimesSync(guardian, now, now + 5);

const events = [];
const w = new CodexWatcher({ root, interval: 120 });
w.on('state', (s, meta) => { events.push(s); console.log('state ->', s, meta.reason); });
w.start();

const append = (obj) => fs.appendFileSync(primary, JSON.stringify(obj) + '\n');
setTimeout(() => {
  append({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_started' } });
}, 400);
setTimeout(() => {
  append({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution' } } });
}, 800);
setTimeout(() => {
  append({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'task_complete' } });
}, 1200);
setTimeout(() => {
  w.stop();
  const expected = ['thinking', 'working', 'done'];
  const ok = expected.every((e) => events.includes(e)) && !events.includes('idle');
  console.log(ok ? 'PASS' : 'FAIL', events);
  process.exit(ok ? 0 : 1);
}, 2200);
