/*
 * Zero-config Codex activity watcher.
 * Tails the newest rollout file under ~/.codex/sessions and turns its event
 * stream into a tiny state machine: thinking / working / done / error / idle.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const TOOL_ITEMS = new Set([
  'CommandExecution',
  'FileChange',
  'McpToolCall',
  'Extension',
  'ImageView'
]);

class CodexWatcher extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.root = opts.root || path.join(os.homedir(), '.codex', 'sessions');
    this.interval = opts.interval || 900;
    this.file = null;
    this.offset = 0;
    this.state = 'idle';
    this.enabled = true;
    this.timer = null;
    this.lastTs = 0;
    this.lastToolAt = 0;
    this.active = false;
    this.scanAt = 0;
    this.lastSize = 0;
    this.started = false;
    this.secondaryCache = new Map();
    this.includeSecondary = !!opts.includeSecondary;
  }

  start() {
    if (this.timer) return;
    this.poll(true);
    this.timer = setInterval(() => this.poll(false), this.interval);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) {
      this.scanAt = 0;
      this.poll(true);
    }
  }

  emitState(nextState, reason) {
    if (nextState === this.state) return;
    this.state = nextState;
    this.emit('state', nextState, { reason: reason || '', file: this.file });
  }

  /* ---------- file discovery ---------- */

  recentDirs() {
    const dirs = [];
    const now = new Date();
    for (let i = 0; i < 2; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const y = String(d.getFullYear());
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dirs.push(path.join(this.root, y, m, day));
    }
    return dirs;
  }

  findLatest() {
    const candidates = [];
    for (const dir of this.recentDirs()) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        try {
          const st = fs.statSync(file);
          candidates.push({ file, mtimeMs: st.mtimeMs });
        } catch {
          /* file disappeared */
        }
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const c of candidates.slice(0, 10)) {
      if (this.includeSecondary || !this.isSecondary(c.file)) return c.file;
    }
    return null;
  }

  /* Guardian reviews and subagents get their own rollout files; they would
     make the pet twitch while the user's real turn is idle. */
  isSecondary(file) {
    if (this.secondaryCache.has(file)) return this.secondaryCache.get(file);
    let secondary = false;
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(128 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const firstLine = buf.toString('utf8', 0, n).split('\n')[0];
      const meta = JSON.parse(firstLine);
      const p = meta.payload || {};
      const source = p.source || {};
      const threadSource = String(p.thread_source || '');
      secondary =
        !!source.subagent ||
        threadSource.includes('guardian') ||
        threadSource.includes('subagent') ||
        /guardian/i.test(String(source.other || ''));
    } catch {
      secondary = false;
    }
    this.secondaryCache.set(file, secondary);
    return secondary;
  }

  /* ---------- tailing ---------- */

  seekLineStart(file, offset) {
    let pos = Math.max(0, offset);
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(4096);
      let guard = 0;
      let done = false;
      while (!done && guard < 64) {
        const n = fs.readSync(fd, buf, 0, buf.length, pos);
        if (n === 0) break;
        const idx = buf.indexOf(10, 0);
        if (idx >= 0) {
          pos += idx + 1;
          done = true;
        } else {
          pos += n;
          guard++;
        }
      }
      fs.closeSync(fd);
    } catch {
      return 0;
    }
    return pos;
  }

  poll(initial) {
    if (!this.enabled) return;

    const now = Date.now();
    if (!this.file || initial || now > this.scanAt) {
      this.scanAt = now + 4000;
      const latest = this.findLatest();
      if (latest && latest !== this.file) {
        this.file = latest;
        try {
          const st = fs.statSync(latest);
          this.offset = this.seekLineStart(latest, Math.max(0, st.size - 160 * 1024));
          this.lastSize = st.size;
        } catch {
          return;
        }
      }
    }

    if (!this.file) return;

    let st;
    try {
      st = fs.statSync(this.file);
    } catch {
      this.file = null;
      return;
    }

    if (st.size < this.offset) this.offset = 0;
    if (st.size === this.offset) {
      if (this.active && now - this.lastTs > 45000) {
        this.active = false;
        this.emitState('idle', 'silence');
      }
      return;
    }

    let chunk;
    try {
      const fd = fs.openSync(this.file, 'r');
      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.offset);
      fs.closeSync(fd);
      this.offset = st.size;
      chunk = buf.toString('utf8');
    } catch {
      return;
    }

    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.parse(JSON.parse(line), initial);
      } catch {
        /* partial or non-JSON line */
      }
    }
    if (initial) this.settleInitial();
  }

  /* ---------- event interpretation ---------- */

  parse(obj, initial) {
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : Date.now();
    if (!Number.isFinite(ts)) return;
    this.lastTs = Math.max(this.lastTs, ts);

    if (obj.type === 'event_msg' && obj.payload) {
      const p = obj.payload;
      if (p.type === 'task_started') {
        this.active = true;
        this.emitState('thinking', 'turn-start');
        return;
      }
      if (p.type === 'task_complete') {
        this.active = false;
        this.emitState('done', 'turn-complete');
        return;
      }
      if (p.type === 'turn_aborted' || p.type === 'error') {
        this.active = false;
        this.emitState('error', 'aborted');
        return;
      }
      if (p.type === 'reasoning' || p.type === 'agent_reasoning') {
        if (Date.now() - this.lastToolAt > 9000) this.emitState('thinking', 'reasoning');
        return;
      }
      if (p.type === 'item_completed' && p.item) {
        const type = p.item.type;
        if (TOOL_ITEMS.has(type)) {
          this.active = true;
          this.lastToolAt = Date.now();
          this.emitState('working', type);
        } else if (type === 'Reasoning') {
          if (Date.now() - this.lastToolAt > 9000) this.emitState('thinking', 'reasoning');
        } else if (type === 'UserMessage') {
          this.active = true;
          this.emitState('thinking', 'user-message');
        }
        return;
      }
      if (p.type === 'token_count') return;
      if (p.type === 'message') return;
    }

    if (obj.type === 'response_item' && obj.payload) {
      const t = obj.payload.type;
      if (t === 'custom_tool_call' || t === 'function_call' || t === 'local_shell_call') {
        this.active = true;
        this.lastToolAt = Date.now();
        this.emitState('working', t);
      } else if (t === 'reasoning') {
        if (Date.now() - this.lastToolAt > 9000) this.emitState('thinking', 'reasoning');
      }
    }
  }

  settleInitial() {
    // Do not resurrect a stale "done"/"error"; only a genuinely live turn.
    const fresh = Date.now() - this.lastTs < 120000;
    if (!fresh) {
      this.active = false;
      this.emitState('idle', 'startup');
      return;
    }
    if (this.state === 'done' || this.state === 'error') {
      this.emitState('idle', 'startup');
    }
  }
}

module.exports = { CodexWatcher, TOOL_ITEMS };
