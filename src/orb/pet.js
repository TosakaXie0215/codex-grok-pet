/* Desktop-pet page controller: wires the orb to pointer + main process. */
(function () {
  'use strict';

  const canvas = document.getElementById('orb');
  const params = new URLSearchParams(location.search);
  const orb = new GrokOrb(canvas, { interactive: true, seed: 11 });
  window.__orb = orb;

  if (params.get('static') === '1') {
    const state = params.get('state') || 'idle';
    orb.setState(state);
    orb.settle(Number(params.get('t') || 1.2), {
      x: Number(params.get('gx') || 0.12),
      y: Number(params.get('gy') || -0.08)
    });
    document.title = 'ready';
    return;
  }

  if (params.get('state')) orb.setState(params.get('state'));
  orb.start();

  const native = window.pet;

  // ---- pointer ----------------------------------------------------------
  let down = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = true;
    document.body.classList.add('dragging');
    orb.grab();
    if (native) native.pointerDown({ x: e.clientX, y: e.clientY });
  });

  window.addEventListener('pointerup', (e) => {
    if (!down) return;
    down = false;
    document.body.classList.remove('dragging');
    orb.drop();
    if (native) native.pointerUp();
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (native) native.menu();
  });

  canvas.addEventListener('mouseenter', () => orb.setHover(true));
  canvas.addEventListener('mouseleave', () => {
    orb.setHover(false);
    if (!native) orb.setCursor(canvas.clientWidth / 2, canvas.clientHeight / 2 - 40);
  });

  if (!native) {
    // browser preview: the orb follows the local pointer
    window.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      orb.setCursor(e.clientX - r.left, e.clientY - r.top);
    });
    canvas.addEventListener('click', () => orb.poke());
  }

  // ---- main process events ---------------------------------------------
  if (native) {
    native.onState((state) => {
      if (state === 'happy') {
        orb.setState('happy');
      } else {
        orb.setState(state);
      }
    });

    native.onCursor((p) => {
      orb.setCursor(p.x, p.y);
    });

    native.onClicked(() => {
      orb.poke();
    });

    native.onGrabbed(() => {
      orb.grab();
    });

    native.onDrop(() => {
      orb.drop();
    });

    native.onScale(() => {
      orb.resize();
    });
  }

  // keep the canvas crisp when the window is moved between Retina screens
  window.addEventListener('resize', () => orb.resize());
})();
