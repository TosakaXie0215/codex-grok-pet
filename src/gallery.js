/* Expression gallery — used for previews, screenshots and visual QA. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const staticMode = params.get('static') === '1';

  const CARDS = [
    { state: 'idle', name: '待机', note: '目光漫无目的地游走', settle: 1.5, gaze: { x: 0.18, y: -0.06 } },
    { state: 'curious', name: '好奇', note: '你一靠近，它就盯住你', settle: 1.2, gaze: { x: 0.3, y: -0.1 } },
    { state: 'thinking', name: '思考中', note: '目光向上，轨道慢慢转', settle: 1.6, gaze: { x: -0.3, y: -0.5 } },
    { state: 'working', name: '工作中', note: '左右扫视，像在读代码', settle: 1.15, gaze: { x: 0.4, y: -0.2 } },
    { state: 'done', name: '完成', note: '亮起一圈轨道，撒一点星', settle: 0.72, gaze: { x: 0.1, y: -0.2 } },
    { state: 'error', name: '出错', note: '眼睛垂下来，有点委屈', settle: 1.1, gaze: { x: -0.12, y: 0.2 } },
    { state: 'sleep', name: '睡着', note: '轻轻呼吸，飘出 z z z', settle: 1.4, gaze: { x: 0, y: 0 } },
    { state: 'happy', name: '开心', note: '被摸一下，眼睛弯起来', settle: 0.65, gaze: { x: 0.1, y: -0.12 } }
  ];

  const grid = document.getElementById('grid');
  const instances = [];

  CARDS.forEach((cfg, i) => {
    const card = document.createElement('section');
    card.className = 'card';
    const canvas = document.createElement('canvas');
    canvas.width = 260;
    canvas.height = 260;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div><div class="name">${cfg.name}</div><div class="note">${cfg.note}</div></div><div class="key">${cfg.state}</div>`;
    card.appendChild(canvas);
    card.appendChild(meta);
    grid.appendChild(card);

    const orb = new GrokOrb(canvas, { static: staticMode, seed: 100 + i * 31 });
    orb.setState(cfg.state);
    if (staticMode) {
      orb.settle(cfg.settle, cfg.gaze);
    } else {
      orb.setCursor(orb.w / 2 + cfg.gaze.x * 60, orb.h / 2 + cfg.gaze.y * 60);
      orb.start();
    }
    instances.push(orb);
  });

  const liveBtn = document.getElementById('live');
  let live = !staticMode;
  if (staticMode) liveBtn.style.display = 'none';

  function setLive(next) {
    live = next;
    liveBtn.dataset.on = next ? '1' : '0';
    liveBtn.textContent = next ? '暂停动画' : '播放动画';
    instances.forEach((orb, i) => {
      if (next) {
        orb.static = false;
        orb.start();
      } else {
        orb.stop();
        orb.static = true;
        orb.settle(0.9, CARDS[i].gaze);
      }
    });
  }

  if (!staticMode) {
    liveBtn.dataset.on = '1';
    liveBtn.textContent = '暂停动画';
    liveBtn.addEventListener('click', () => setLive(!live));
  }

  // stable hook for screenshot tooling
  window.__galleryReady = true;
  document.title = 'ready';
})();
