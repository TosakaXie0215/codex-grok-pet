/*
 * Bake a Codex v2 pet atlas from the orb.
 *
 * 8 columns x 11 rows, 192x208 cells, transparent.  Rows 0-8 are the standard
 * animation states; rows 9-10 are the 16 clockwise look directions.  The v2
 * contract also uses idle column 6 as the neutral/front cell.
 */
(function () {
  'use strict';

  const COLS = 8;
  const ROWS = 11;
  const CW = 192;
  const CH = 208;
  const SS = 2; // supersample, downsampled later

  const F = (o = {}) =>
    Object.assign(
      {
        pose: {},
        gaze: [0.02, -0.04],
        blink: 0,
        sx: 1,
        sy: 1,
        rot: 0,
        dx: 0,
        dy: 0
      },
      o
    );

  // Row 0 — idle (6 frames; column 6 is the neutral/front cell)
  const idle = [
    F({ gaze: [0.04, -0.05] }),
    F({ gaze: [0.02, -0.03], blink: 0.5, sy: 1.006 }),
    F({ gaze: [0, -0.02], blink: 1, sy: 0.997 }),
    F({ gaze: [-0.05, -0.03], blink: 0.25, sy: 1.006, dy: -1 }),
    F({ gaze: [0.02, -0.06] }),
    F({ gaze: [0, -0.03], sy: 0.995 })
  ];
  const neutral = F({ gaze: [0, 0] });

  // Row 1 — running right (8 frames, alternating squash cadence)
  const runningRight = [
    F({ sx: 1.04, sy: 0.95, rot: 5, dx: 1, dy: 2, gaze: [0.75, -0.05] }),
    F({ sx: 0.97, sy: 1.04, rot: 8, dx: 2, dy: -2, gaze: [0.85, -0.02], pose: { open: 0.92 } }),
    F({ sx: 1.02, sy: 0.97, rot: 4, dx: 1, dy: 0, gaze: [0.8, -0.05] }),
    F({ sx: 0.96, sy: 1.05, rot: 9, dx: 2, dy: -3, gaze: [0.85, -0.1], pose: { open: 0.9 } }),
    F({ sx: 1.04, sy: 0.95, rot: 5, dx: 1, dy: 2, gaze: [0.75, 0] }),
    F({ sx: 0.98, sy: 1.03, rot: 8, dx: 2, dy: -1, gaze: [0.8, -0.05] }),
    F({ sx: 1.02, sy: 0.98, rot: 4, dx: 1, dy: 0, gaze: [0.85, -0.02] }),
    F({ sx: 0.97, sy: 1.04, rot: 7, dx: 2, dy: -2, gaze: [0.8, -0.05] })
  ];

  // Row 3 — waving (4 frames): a friendly wiggle + closed smiling eyes
  const waving = [
    F({ gaze: [0.02, -0.03] }),
    F({
      rot: -7,
      dy: -3,
      sx: 1.02,
      sy: 1.01,
      gaze: [0.1, -0.1],
      pose: { open: 0.85, curve: -0.12 }
    }),
    F({
      rot: 7,
      dy: -6,
      sx: 1,
      sy: 1.03,
      gaze: [0.15, -0.05],
      pose: {
        tilt: 92,
        len: 1.18,
        wid: 1.04,
        curve: -0.46,
        eyeY: -0.31,
        open: 1,
        close: 0
      }
    }),
    F({ rot: 0, dy: -1, gaze: [0.05, 0], pose: { open: 0.92 } })
  ];

  // Row 4 — jumping (5 frames)
  const jumping = [
    F({ sx: 1.12, sy: 0.88, dy: 4, gaze: [0, 0.05], pose: { open: 0.55 } }),
    F({ sx: 0.94, sy: 1.1, dy: -6, gaze: [0, -0.1], pose: { open: 1.1, wid: 1.05 } }),
    F({ sx: 1.0, sy: 1.02, dy: -16, gaze: [0, -0.15], pose: { open: 1.15, wid: 1.06 } }),
    F({ sx: 0.96, sy: 1.07, dy: -9, gaze: [0, -0.1] }),
    F({ sx: 1.1, sy: 0.91, dy: 3, gaze: [0, 0.05], pose: { open: 0.62 } })
  ];

  // Row 5 — failed (8 frames): deflated, droopy eyes, no detached effects
  const sad = { open: 0.7, asym: 27, eyeY: -0.34, glow: 0.1 };
  const failed = [
    F({ gaze: [-0.1, 0.15], pose: sad, sy: 0.98, dy: 2 }),
    F({ gaze: [0.05, 0.18], pose: sad, dy: 3, rot: -2, blink: 0.2 }),
    F({ gaze: [0.1, 0.2], pose: sad, dy: 3, rot: 2, blink: 0.4 }),
    F({ gaze: [0, 0.2], pose: { open: 0.55, asym: 30, eyeY: -0.33 }, dy: 4, blink: 0.6 }),
    F({ gaze: [-0.05, 0.18], pose: sad, dy: 3, rot: -1 }),
    F({ gaze: [0, 0.15], pose: sad, dy: 2, rot: 0, blink: 1 }),
    F({ gaze: [0.05, 0.18], pose: sad, dy: 3, rot: 1 }),
    F({ gaze: [-0.05, 0.15], pose: sad, dy: 2, rot: -1 })
  ];

  // Row 6 — waiting (6 frames): expectant look + a blink
  const waiting = [
    F({ gaze: [0, 0.1] }),
    F({ gaze: [0.05, 0.08], dy: -1, pose: { len: 1.06 } }),
    F({ gaze: [0, 0.08], blink: 0.5 }),
    F({ gaze: [0, 0.08], blink: 1 }),
    F({ gaze: [-0.05, 0.08], dy: -1, rot: -1.5 }),
    F({ gaze: [0, 0.1], rot: 0 })
  ];

  // Row 7 — running (6 frames): scanning, processing
  const running = [
    F({ gaze: [-0.7, -0.05], pose: { open: 0.8 }, rot: -2, sy: 0.99 }),
    F({ gaze: [-0.2, -0.12], pose: { open: 0.75 }, sy: 1.015, dy: -1 }),
    F({ gaze: [0.35, -0.05], pose: { open: 0.8 }, rot: 2, sy: 0.99 }),
    F({ gaze: [0.75, 0], pose: { open: 0.8 }, rot: 3, sy: 1.01, dy: -1 }),
    F({ gaze: [0.2, -0.1], pose: { open: 0.75 }, rot: 0, sy: 0.995 }),
    F({ gaze: [-0.4, -0.02], pose: { open: 0.8 }, rot: -1, sy: 1.005 })
  ];

  // Row 8 — review (6 frames): focused squint + slow look
  const review = [
    F({ gaze: [-0.4, 0.25], pose: { open: 0.65, len: 0.98 }, rot: -3, dy: 1 }),
    F({ gaze: [-0.2, 0.3], pose: { open: 0.6, len: 0.95 }, rot: -2, dy: 1 }),
    F({ gaze: [0.1, 0.3], pose: { open: 0.55, len: 0.92 }, rot: 0, sy: 0.995, dy: 2 }),
    F({ gaze: [0.4, 0.25], pose: { open: 0.6, len: 0.95 }, rot: 2, dy: 1 }),
    F({ gaze: [0.2, 0.2], pose: { open: 0.75 }, rot: 1 }),
    F({ gaze: [0, 0.1], pose: { open: 0.8 }, blink: 0.5, rot: 0 })
  ];

  const look = (angle) => {
    const rad = (angle * Math.PI) / 180;
    const sx = Math.sin(rad);
    const cy = Math.cos(rad);
    return F({
      gaze: [sx * 0.9, -cy * 0.9],
      rot: sx * 4,
      dx: sx * 2,
      dy: -cy * 2,
      pose: {
        len: 1.06,
        wid: 1.04,
        eyeX: sx * 0.035,
        eyeY: -0.375 - cy * 0.05
      }
    });
  };

  const lookA = [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5].map(look);
  const lookB = [180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5].map(look);

  const atlas = document.getElementById('atlas');
  atlas.width = COLS * CW * SS;
  atlas.height = ROWS * CH * SS;
  const actx = atlas.getContext('2d');

  const temp = document.createElement('canvas');
  temp.width = CW * SS;
  temp.height = CH * SS;
  const tctx = temp.getContext('2d');

  const orb = new GrokOrb(document.createElement('canvas'), { static: true });

  function cell(spec, row, col, mirror) {
    tctx.setTransform(SS, 0, 0, SS, 0, 0);
    orb.renderSpriteFrame(tctx, CW, CH, spec);
    actx.save();
    if (mirror) {
      actx.translate((col + 1) * CW * SS, row * CH * SS);
      actx.scale(-1, 1);
      actx.drawImage(temp, 0, 0);
    } else {
      actx.drawImage(temp, col * CW * SS, row * CH * SS);
    }
    actx.restore();
  }

  // row 0: idle + neutral (col 6)
  idle.forEach((spec, col) => cell(spec, 0, col, false));
  cell(neutral, 0, 6, false);

  // row 1: running right; row 2: its mirror
  runningRight.forEach((spec, col) => {
    cell(spec, 1, col, false);
    cell(spec, 2, col, true);
  });

  waving.forEach((spec, col) => cell(spec, 3, col, false));
  jumping.forEach((spec, col) => cell(spec, 4, col, false));
  failed.forEach((spec, col) => cell(spec, 5, col, false));
  waiting.forEach((spec, col) => cell(spec, 6, col, false));
  running.forEach((spec, col) => cell(spec, 7, col, false));
  review.forEach((spec, col) => cell(spec, 8, col, false));
  lookA.forEach((spec, col) => cell(spec, 9, col, false));
  lookB.forEach((spec, col) => cell(spec, 10, col, false));

  window.__atlas = atlas;
  window.__ready = true;
  document.title = 'ready';
})();
