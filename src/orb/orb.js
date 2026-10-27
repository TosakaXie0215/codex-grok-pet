/*
 * Codex Pet — GrokBot-style orb
 * A glossy black sphere with two white "quote-tick" eyes.
 * Eyes are drawn as procedural, slightly tapered capsules that live on the
 * sphere surface: they gaze, blink, squint, scan and orbit.
 *
 * No dependencies. Works in any modern browser.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STATES = {
    idle: { label: '待机' },
    curious: { label: '好奇' },
    thinking: { label: '思考中' },
    working: { label: '工作中' },
    done: { label: '完成' },
    error: { label: '出错' },
    sleep: { label: '睡着' },
    happy: { label: '开心' },
    surprised: { label: '惊讶' }
  };

  const BASE_POSE = {
    len: 1,
    wid: 1,
    tilt: 14,
    curve: 0,
    open: 1,
    spread: 0.158,
    eyeY: -0.375,
    eyeX: 0,
    glow: 0.34,
    asym: 0,
    orbit: 0,
    sparkle: 0,
    zzz: 0,
    close: 0
  };

  const SPRING = {
    len: 520,
    wid: 520,
    tilt: 480,
    curve: 380,
    open: 720,
    spread: 420,
    eyeY: 440,
    eyeX: 380,
    glow: 260,
    asym: 380,
    orbit: 260,
    sparkle: 400,
    zzz: 260,
    close: 620
  };
  const DAMPING = 0.92;

  function springTo(cur, vel, target, k, dt) {
    // semi-implicit, sub-stepped for stability at any frame rate
    const steps = Math.max(1, Math.min(8, Math.ceil(dt / 0.006)));
    const h = dt / steps;
    const damping = 2 * Math.sqrt(k) * DAMPING;
    for (let i = 0; i < steps; i++) {
      const acc = (target - cur) * k - vel * damping;
      vel += acc * h;
      cur += vel * h;
    }
    return [cur, vel];
  }

  class GrokOrb {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.static = !!opts.static;
      this.interactive = opts.interactive !== false;
      this.state = 'idle';
      this.stateSince = 0;
      this.time = 0;
      this.hover = false;
      this.dragging = false;
      this.seed = opts.seed || 7;
      this.rand = mulberry32(this.seed);
      this.look = Object.assign({ len: 1, wid: 1, spread: 1, eyeY: 0, glow: 1 }, opts.look || {});
      this.clock = 0;

      this.pose = Object.assign({}, BASE_POSE);
      this.vel = {};
      for (const k in BASE_POSE) this.vel[k] = 0;

      this.gaze = { x: 0, y: -0.05, vx: 0, vy: 0 };
      this.cursor = null;
      this.lastCursorAt = -10;
      this.cursorSpeed = 0;
      this.wander = { x: 0, y: 0, tx: 0, ty: 0, next: 1.5 };
      this.saccade = { x: 0, y: 0, next: 2.2 };

      this.blink = { at: 2.2, dur: 0.17, value: 0, queue: [] };
      this.orbitPhase = 0;
      this.sparkles = [];
      this.rings = [];
      this.wobble = 0;
      this.bounce = 0;
      this.bounceVel = 0;

      this.dpr = Math.min(global.devicePixelRatio || 1, 3);
      this.w = 280;
      this.h = 280;

      this._bindResize();
      this.resize();
    }

    _bindResize() {
      if (typeof ResizeObserver !== 'undefined' && this.canvas) {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(this.canvas);
      }
      this._onWinResize = () => this.resize();
      global.addEventListener('resize', this._onWinResize);
    }

    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(60, Math.round(rect.width || this.canvas.clientWidth || this.w));
      const h = Math.max(60, Math.round(rect.height || this.canvas.clientHeight || this.h));
      this.w = w;
      this.h = h;
      const dpr = Math.min(global.devicePixelRatio || 1, 3);
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.render();
    }

    setState(name) {
      if (!STATES[name] || name === this.state) {
        if (STATES[name] && name === this.state) this.retrigger(name);
        return;
      }
      const prev = this.state;
      this.state = name;
      this.stateSince = this.time;
      this.retrigger(name, prev);
    }

    retrigger(name, prev) {
      if (name === 'done') {
        this.burst(1);
        this.pushRing(0.85);
      } else if (name === 'happy' || name === 'surprised') {
        this.burst(name === 'happy' ? 0.8 : 0.6);
        this.bounceVel = name === 'happy' ? -3.4 : -2.4;
      } else if (name === 'error') {
        this.wobble = 1;
      } else if (name === 'sleep') {
        this.rings.length = 0;
      }
      if (prev && name !== prev) {
        this.blink.queue.push({ at: this.time + 0.03, double: false });
      }
    }

    setHover(v) {
      this.hover = !!v;
    }

    setCursor(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const cx = this.w / 2;
      const cy = this.h / 2;
      const R = this.R();
      const nx = clamp((x - cx) / (R * 2.6), -1.6, 1.6);
      const ny = clamp((y - cy) / (R * 2.6), -1.6, 1.6);
      if (this.cursor) {
        const d = Math.hypot(nx - this.cursor.x, ny - this.cursor.y);
        this.cursorSpeed = mix(this.cursorSpeed, d * 60, 0.2);
      }
      this.cursor = { x: nx, y: ny };
      this.lastCursorAt = this.time;
    }

    clearCursor() {
      this.cursor = null;
    }

    poke() {
      this.setState('happy');
      this.bounceVel = -4.2;
      this.burst(0.9);
    }

    drop() {
      this.dragging = false;
      this.bounceVel = 1.6;
    }

    grab() {
      this.dragging = true;
      this.setState('surprised');
    }

    burst(power = 1) {
      const n = Math.round(10 + 8 * power);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * TAU;
        const r = 0.92 + this.rand() * 0.2;
        this.sparkles.push({
          a,
          r0: r,
          r1: r + 0.25 + this.rand() * 0.45,
          rot: this.rand() * TAU,
          spin: (this.rand() - 0.5) * 4,
          size: 1.4 + this.rand() * 2.6,
          life: 0.75 + this.rand() * 0.7,
          t: 0,
          tint: this.rand() < 0.22 ? 'cool' : 'white'
        });
      }
      if (this.sparkles.length > 60) this.sparkles.splice(0, this.sparkles.length - 60);
    }

    pushRing(power) {
      this.rings.push({ t: 0, life: 0.9, power });
    }

    R() {
      return Math.min(this.w, this.h) * 0.335;
    }

    /* ---------- pose ---------- */

    targetPose() {
      const t = this.time;
      const s = this.state;
      const p = Object.assign({}, BASE_POSE);
      const breathe = Math.sin(t * 1.25);
      p.eyeY += breathe * 0.007;
      p.tilt += Math.sin(t * 0.63) * 1.2;

      switch (s) {
        case 'curious':
          p.len = 1.1;
          p.wid = 1.05;
          p.tilt = 7;
          p.spread = 0.215;
          p.glow = 0.5;
          p.eyeY = -0.4 + breathe * 0.006;
          break;
        case 'thinking':
          p.eyeY = -0.415 + Math.sin(t * 1.4) * 0.022;
          p.tilt = -3 + Math.sin(t * 1.05) * 7;
          p.len = 0.94;
          p.wid = 0.97;
          p.glow = 0.4;
          p.orbit = 0.9;
          p.spread = 0.19;
          break;
        case 'working':
          p.len = 0.9;
          p.open = 0.7;
          p.tilt = 9;
          p.glow = 0.46;
          p.orbit = 0.22;
          break;
        case 'done':
          p.len = 1.08;
          p.wid = 1.02;
          p.open = 0.52;
          p.tilt = 24;
          p.eyeY = -0.35;
          p.spread = 0.21;
          p.glow = 0.68;
          p.orbit = 1;
          break;
        case 'error':
          p.len = 1.0;
          p.open = 0.78;
          p.tilt = 4;
          p.asym = 27;
          p.curve = 0.16;
          p.eyeY = -0.355;
          p.glow = 0.1;
          p.spread = 0.205;
          break;
        case 'sleep':
          p.open = 0.055;
          p.len = 0.62;
          p.wid = 0.95;
          p.tilt = 0;
          p.glow = 0.08;
          p.eyeY = -0.37;
          p.zzz = 1;
          break;
        case 'happy':
          p.len = 1.04;
          p.open = 0.5;
          p.tilt = 26;
          p.eyeY = -0.345;
          p.spread = 0.205;
          p.glow = 0.6;
          p.orbit = 0.5;
          break;
        case 'surprised':
          p.len = 1.5;
          p.wid = 1.32;
          p.tilt = 2;
          p.spread = 0.225;
          p.glow = 0.7;
          p.orbit = 0.3;
          break;
        default:
          break;
      }

      // a closed, smiling arc for the joyful states
      const joy = s === 'happy' ? 1 : s === 'done' ? 0.8 : 0;
      if (joy > 0) {
        p.tilt = mix(p.tilt, 92, joy);
        p.len = mix(p.len, 1.18, joy);
        p.wid = mix(p.wid, 1.04, joy);
        p.curve = mix(p.curve, -0.46, joy);
        p.eyeY = mix(p.eyeY, -0.31, joy);
        p.spread = mix(p.spread, 0.195, joy);
        p.open = mix(p.open, 1, joy);
        p.close = 0;
      }
      if (s === 'sleep') {
        p.close = 1;
        p.len = 1.0;
        p.wid = 1.5;
        p.tilt = 0;
        p.open = 1;
      }

      p.len *= this.look.len;
      p.wid *= this.look.wid;
      p.spread *= this.look.spread;
      p.eyeY += this.look.eyeY;
      p.glow *= this.look.glow;

      if (this.hover && s !== 'sleep' && s !== 'error') {
        p.len *= 1.04;
        p.wid *= 1.03;
        p.glow += 0.08;
        p.tilt -= 2.5;
      }
      if (this.poseOverride) Object.assign(p, this.poseOverride);
      return p;
    }

    /* ---------- gaze ---------- */

    updateGaze(dt) {
      const t = this.time;
      let tx = 0;
      let ty = -0.04;

      if (this.state === 'thinking') {
        tx = -0.34 + Math.sin(t * 0.33) * 0.22;
        ty = -0.42 + Math.sin(t * 0.51) * 0.08;
        if (t > this.saccade.next) {
          this.saccade.next = t + 1.6 + this.rand() * 1.8;
          this.saccade.x = (this.rand() - 0.5) * 0.5;
          this.saccade.y = (this.rand() - 0.5) * 0.25;
        }
        tx += this.saccade.x * 0.5;
        ty += this.saccade.y;
      } else if (this.state === 'working') {
        tx = Math.sin(t * 2.1) * 0.62 + Math.sin(t * 0.7) * 0.12;
        ty = -0.2 + Math.sin(t * 3.3) * 0.05;
      } else if (this.state === 'done') {
        tx = 0.06;
        ty = -0.24 + Math.sin(t * 2.4) * 0.03;
      } else if (this.state === 'error') {
        tx = -0.08;
        ty = 0.16;
      } else if (this.state === 'sleep') {
        tx = 0;
        ty = 0;
      } else {
        // follow the cursor, with a lazy wander when it sits still
        const idleFor = this.time - this.lastCursorAt;
        if (this.cursor) {
          tx = this.cursor.x * 0.95 + this.wander.x;
          ty = this.cursor.y * 0.95 + this.wander.y;
        }
        if (idleFor > 4.5) {
          if (t > this.wander.next) {
            this.wander.next = t + 1.8 + this.rand() * 2.8;
            this.wander.tx = (this.rand() - 0.5) * 0.5;
            this.wander.ty = (this.rand() - 0.5) * 0.34 - 0.04;
          }
          this.wander.x = mix(this.wander.x, this.wander.tx, Math.min(1, dt * 2.4));
          this.wander.y = mix(this.wander.y, this.wander.ty, Math.min(1, dt * 2.4));
          tx += this.wander.x;
          ty += this.wander.y;
        } else {
          this.wander.x = mix(this.wander.x, 0, Math.min(1, dt * 5));
          this.wander.y = mix(this.wander.y, 0, Math.min(1, dt * 5));
        }
        // micro-saccades keep the eyes alive even while staring
        if (t > this.saccade.next) {
          this.saccade.next = t + 1.1 + this.rand() * 2.2;
          this.saccade.x = (this.rand() - 0.5) * 0.16;
          this.saccade.y = (this.rand() - 0.5) * 0.1;
        }
        tx += this.saccade.x;
        ty += this.saccade.y;
      }

      tx = clamp(tx, -1, 1);
      ty = clamp(ty, -1, 0.9);

      const [nx, vx] = springTo(this.gaze.x, this.gaze.vx, tx, 110, dt);
      const [ny, vy] = springTo(this.gaze.y, this.gaze.vy, ty, 110, dt);
      this.gaze.x = nx;
      this.gaze.y = ny;
      this.gaze.vx = vx;
      this.gaze.vy = vy;
    }

    /* ---------- blink ---------- */

    updateBlink(dt) {
      const t = this.time;
      const b = this.blink;
      if (!this.static) {
        if (t > b.at && b.queue.length === 0) {
          b.queue.push({ at: t, double: this.rand() < 0.22 });
          const gap = this.state === 'sleep' ? 6 : 2.4 + this.rand() * 4.2;
          b.at = t + gap;
        }
        if (b.queue.length && t >= b.queue[0].at) {
          const q = b.queue.shift();
          b.start = t;
          if (q.double) b.queue.push({ at: t + 0.21, double: false });
        }
      }
      if (b.start != null) {
        const p = (t - b.start) / b.dur;
        b.value = p < 0 || p > 1 ? 0 : Math.pow(Math.sin(Math.PI * p), 0.62);
      } else {
        b.value = 0;
      }
    }

    /* ---------- update ---------- */

    update(dt) {
      dt = Math.min(dt, 1 / 20);
      this.time += dt;
      const target = this.targetPose();
      for (const k in SPRING) {
        const [v, vel] = springTo(this.pose[k], this.vel[k], target[k], SPRING[k], dt);
        this.pose[k] = v;
        this.vel[k] = vel;
      }
      this.updateGaze(dt);
      this.updateBlink(dt);

      this.bounceVel += (-this.bounce * 150 - this.bounceVel * 12) * dt;
      this.bounce += this.bounceVel * dt;
      this.wobble *= Math.exp(-3.2 * dt);

      const orbitSpeed =
        this.state === 'done' ? 2.1 : this.state === 'thinking' ? 0.85 : this.state === 'happy' ? 1.5 : 0.5;
      this.orbitPhase += dt * orbitSpeed;

      for (let i = this.sparkles.length - 1; i >= 0; i--) {
        const s = this.sparkles[i];
        s.t += dt;
        if (s.t > s.life) this.sparkles.splice(i, 1);
      }
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.t += dt;
        if (r.t > r.life) this.rings.splice(i, 1);
      }
    }

    /* ---------- drawing helpers ---------- */

    drawShadow(cx, cy, R) {
      const ctx = this.ctx;
      const y = cy + R * 1.09;
      ctx.save();
      ctx.translate(cx, y);
      ctx.scale(1, 0.2);
      const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.95);
      g.addColorStop(0, 'rgba(0,0,0,0.26)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.95, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawSphere(cx, cy, R) {
      const ctx = this.ctx;

      // body
      const g = ctx.createRadialGradient(
        cx - R * 0.36,
        cy - R * 0.42,
        R * 0.04,
        cx - R * 0.02,
        cy + R * 0.04,
        R * 1.06
      );
      g.addColorStop(0, '#3d4044');
      g.addColorStop(0.28, '#2f3235');
      g.addColorStop(0.58, '#222427');
      g.addColorStop(0.82, '#161719');
      g.addColorStop(0.95, '#0d0e0f');
      g.addColorStop(1, '#08090a');
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.clip();

      // cool bounce light from below
      const bounce = ctx.createRadialGradient(
        cx + R * 0.12,
        cy + R * 0.95,
        R * 0.02,
        cx + R * 0.12,
        cy + R * 0.95,
        R * 0.75
      );
      bounce.addColorStop(0, 'rgba(160,178,196,0.07)');
      bounce.addColorStop(0.55, 'rgba(160,178,196,0.02)');
      bounce.addColorStop(1, 'rgba(150,178,205,0)');
      ctx.fillStyle = bounce;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // occlusion near the bottom rim
      const occ = ctx.createRadialGradient(cx, cy + R * 0.2, R * 0.2, cx, cy + R * 0.2, R * 1.02);
      occ.addColorStop(0, 'rgba(0,0,0,0)');
      occ.addColorStop(0.78, 'rgba(0,0,0,0.12)');
      occ.addColorStop(1, 'rgba(0,0,0,0.42)');
      ctx.fillStyle = occ;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      ctx.restore();

      // crisp rim light so the ball reads on dark desktops
      ctx.beginPath();
      ctx.arc(cx, cy, R - 0.6, 0, TAU);
      ctx.strokeStyle = this.spriteMode ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.085)';
      ctx.lineWidth = this.spriteMode ? 1.6 : 1.2;
      ctx.stroke();

      // tiny pin-point glint
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const glint = ctx.createRadialGradient(
        cx - R * 0.36,
        cy - R * 0.47,
        0,
        cx - R * 0.36,
        cy - R * 0.47,
        R * 0.055
      );
      glint.addColorStop(0, 'rgba(255,255,255,0.26)');
      glint.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glint;
      ctx.beginPath();
      ctx.arc(cx - R * 0.38, cy - R * 0.48, R * 0.055, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    drawEye(cx, cy, R, side) {
      const ctx = this.ctx;
      const p = this.pose;
      const gz = this.gaze;
      const blink = this.blink.value;
      const closedness = clamp(p.close + blink * 1.05, 0, 1);
      const open = clamp(p.open * (1 - 0.7 * closedness), 0.08, 2);

      // A bar, not a capsule outline: one clean stroke with round caps.
      // totalL is the finished tip-to-tip length, independent of stroke width.
      const totalL = R * 0.27 * p.len * (1 - 0.18 * closedness);
      const W = Math.max(1.4, R * 0.108 * p.wid * open);
      const half = Math.max(0.5, totalL / 2 - W / 2);
      const tiltDeg = p.tilt + side * p.asym + gz.x * 5 + closedness * 82;
      const bow = p.curve * totalL * 0.55;
      const spread = p.spread * R;

      const ex = cx + side * spread + gz.x * R * 0.155 + p.eyeX * R;
      const ey = cy + p.eyeY * R + gz.y * R * 0.125;

      // gaze toward the edge compresses the tick a little (sphere perspective)
      const xScale = 1 - Math.min(0.3, Math.abs(gz.x) * 0.22);

      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(tiltDeg * DEG);
      ctx.scale(xScale, 1);

      ctx.beginPath();
      ctx.moveTo(0, -half);
      ctx.quadraticCurveTo(bow, 0, 0, half);
      ctx.lineWidth = W;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.97)';
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    /* ---------- orbit & particles ---------- */

    orbitPoint(a, R) {
      const rr = R * 1.185;
      const squash = 0.35;
      const tilt = -0.3;
      const x0 = Math.cos(a) * rr;
      const y0 = Math.sin(a) * rr * squash;
      return {
        x: x0 * Math.cos(tilt) - y0 * Math.sin(tilt),
        y: x0 * Math.sin(tilt) + y0 * Math.cos(tilt),
        z: Math.sin(a)
      };
    }

    drawOrbit(cx, cy, R, front) {
      const ctx = this.ctx;
      const lvl = this.pose.orbit;
      if (lvl < 0.02) return;
      const state = this.state;
      const count = state === 'done' ? 26 : state === 'thinking' ? 6 : 8;
      const phase = this.orbitPhase;

      if (front && lvl > 0.25) {
        // faint ring, clipped so it never cuts across the ball itself
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, this.w, this.h);
        ctx.arc(cx, cy, R + 1, 0, TAU, true);
        ctx.clip('evenodd');
        ctx.translate(cx, cy);
        ctx.rotate(-0.3);
        ctx.beginPath();
        ctx.ellipse(0, 0, R * 1.185, R * 1.185 * 0.35, 0, 0, TAU);
        ctx.strokeStyle = `rgba(255,255,255,${0.09 * lvl})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * TAU;
        const p = this.orbitPoint(a, R);
        const z = p.z;
        if (front ? z < 0 : z >= 0) continue;
        const depth = (z + 1) / 2;
        let alpha = (front ? 0.52 : 0.15) * lvl;
        let size = (state === 'done' ? 1.55 : 1.25) * (0.65 + 0.55 * depth);
        if (state === 'done') alpha *= 0.55 + 0.45 * depth;
        if (state === 'thinking') {
          alpha = (front ? 0.95 : 0.34) * lvl;
          alpha *= 0.8 + 0.2 * Math.sin(this.time * 2 + i);
          size *= 1.5;
        }
        if (alpha <= 0.01) continue;
        ctx.beginPath();
        ctx.arc(cx + p.x, cy + p.y, size, 0, TAU);
        ctx.fillStyle = `rgba(255,255,255,${clamp(alpha, 0, 1)})`;
        ctx.shadowColor = 'rgba(255,255,255,0.5)';
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      if (state === 'done' && front) {
        // leading comet
        const a = phase;
        const p = this.orbitPoint(a, R);
        if (p.z >= 0) {
          const g = ctx.createRadialGradient(cx + p.x, cy + p.y, 0, cx + p.x, cy + p.y, 9);
          g.addColorStop(0, 'rgba(255,255,255,0.95)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx + p.x, cy + p.y, 9, 0, TAU);
          ctx.fill();
        }
      }
    }

    drawSparkles(cx, cy, R) {
      const ctx = this.ctx;
      for (const s of this.sparkles) {
        const k = s.t / s.life;
        if (k > 1) continue;
        const r = mix(s.r0, s.r1, 1 - Math.pow(1 - k, 2)) * R;
        const x = cx + Math.cos(s.a) * r;
        const y = cy + Math.sin(s.a) * r * 0.96 - k * R * 0.1;
        const alpha = Math.sin(Math.PI * Math.min(1, k * 1.05)) * 0.9;
        const size = s.size * (0.6 + 0.6 * (1 - k));
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(s.rot + s.spin * s.t);
        ctx.fillStyle =
          s.tint === 'cool' ? `rgba(196,236,255,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.18, -size * 0.18, size, 0);
        ctx.quadraticCurveTo(size * 0.18, size * 0.18, 0, size);
        ctx.quadraticCurveTo(-size * 0.18, size * 0.18, -size, 0);
        ctx.quadraticCurveTo(-size * 0.18, -size * 0.18, 0, -size);
        ctx.fill();
        ctx.restore();
      }

      for (const r of this.rings) {
        const k = r.t / r.life;
        const rad = R * (1.02 + k * 0.5);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rad, rad, 0, 0, TAU);
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.22 * r.power})`;
        ctx.lineWidth = 1 + (1 - k) * 1.6;
        ctx.stroke();
      }
    }

    drawZzz(cx, cy, R) {
      const lvl = this.pose.zzz;
      if (lvl < 0.05) return;
      const ctx = this.ctx;
      ctx.save();
      ctx.font = '600 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 3; i++) {
        const k = ((this.time * 0.28 + i / 3) % 1);
        const alpha = Math.sin(Math.PI * k) * 0.78 * lvl;
        const x = cx + R * (0.44 + k * 0.34);
        const y = cy - R * (0.56 + k * 0.42) - i * 2;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-0.18);
        ctx.fillStyle = `rgba(235,242,250,${alpha})`;
        ctx.fillText('z', 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }

    /* ---------- main render ---------- */

    render() {
      const ctx = this.ctx;
      if (!ctx) return;
      const dpr = this.dpr;
      const w = this.w;
      const h = this.h;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const R = this.R();
      const bob = Math.sin(this.time * 1.35) * R * 0.014 + this.bounce;
      const cx = w / 2;
      const cy = h / 2 + bob;

      const press = this.dragging ? 1 : 0;
      const sx = 1 + press * 0.035;
      const sy = 1 - press * 0.045;

      this.drawShadow(cx, cy, R);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.wobble * Math.sin(this.time * 34) * 0.03);
      ctx.scale(sx, sy);
      ctx.translate(-cx, -cy);

      this.drawOrbit(cx, cy, R, false);
      this.drawSphere(cx, cy, R);
      this.drawEye(cx, cy, R, -1);
      this.drawEye(cx, cy, R, 1);
      this.drawOrbit(cx, cy, R, true);
      this.drawSparkles(cx, cy, R);
      this.drawZzz(cx, cy, R);

      ctx.restore();
    }


    /* ---------- Codex pet sprite frames ---------- */

    /**
     * Draw one 192x208-style pet cell with an explicit pose (no physics,
     * no contact shadow, no orbit, no sparkles). Used to bake the atlas.
     */
    renderSpriteFrame(ctx, cellW, cellH, spec = {}) {
      const prev = {
        ctx: this.ctx,
        pose: this.pose,
        gaze: this.gaze,
        blink: this.blink,
        sprite: this.spriteMode
      };

      const pose = Object.assign(
        {},
        BASE_POSE,
        { len: 1.1, wid: 1.1, spread: 0.16, eyeY: -0.375 },
        spec.pose || {}
      );
      const g = spec.gaze || [0, 0];
      const gazeX = clamp(Number(g[0]) || 0, -1, 1);
      const gazeY = clamp(Number(g[1]) || 0, -1, 1);

      this.ctx = ctx;
      this.pose = pose;
      this.gaze = { x: gazeX, y: gazeY, vx: 0, vy: 0 };
      this.blink = { value: Number(spec.blink) || 0 };
      this.spriteMode = true;

      ctx.clearRect(0, 0, cellW, cellH);

      const R = Math.min(cellW, cellH) * 0.406;
      const cx = cellW / 2 + (Number(spec.dx) || 0);
      const cy = cellH / 2 + (Number(spec.dy) || 0);
      const sx = spec.sx == null ? 1 : Number(spec.sx);
      const sy = spec.sy == null ? 1 : Number(spec.sy);
      const rot = (Number(spec.rot) || 0) * DEG;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.translate(-cx, -cy);

      this.drawSphere(cx, cy, R);

      const basePose = this.pose;
      for (const side of [-1, 1]) {
        const winked =
          (spec.wink === 'left' && side === -1) ||
          (spec.wink === 'right' && side === 1);
        this.pose = basePose;
        this.blink = { value: winked ? 1 : Number(spec.blink) || 0 };
        this.drawEye(cx, cy, R, side);
      }

      ctx.restore();

      this.ctx = prev.ctx;
      this.pose = prev.pose;
      this.gaze = prev.gaze;
      this.blink = prev.blink;
      this.spriteMode = prev.sprite;
    }

    /* ---------- loop ---------- */

    start() {
      if (this._raf) return;
      let last = performance.now();
      const tick = (now) => {
        const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
        last = now;
        if (!this.paused) {
          this.update(dt);
          this.render();
          this._frames = (this._frames || 0) + 1;
        }
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
    }

    pause() {
      this.paused = true;
    }

    resume() {
      this.paused = false;
      this.lastFrame = performance.now();
    }

    stop() {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    settle(seconds = 1.2, gaze) {
      if (gaze) {
        this.gaze.x = gaze.x || 0;
        this.gaze.y = gaze.y || 0;
      }
      const steps = Math.ceil(seconds / (1 / 60));
      this.static = true;
      for (let i = 0; i < steps; i++) this.update(1 / 60);
      this.render();
    }

    snapshotPng() {
      return this.canvas.toDataURL('image/png');
    }
  }

  GrokOrb.STATES = STATES;
  GrokOrb.mulberry32 = mulberry32;
  global.GrokOrb = GrokOrb;
})(typeof window !== 'undefined' ? window : globalThis);
