const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu');

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  const win = new BrowserWindow({
    width: 700,
    height: 700,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  win.webContents.on('console-message', (_e, _lvl, msg) => console.log('[atlas]', msg));
  await win.loadFile(path.join(root, 'src', 'orb', 'atlas.html'));

  let ready = false;
  for (let i = 0; i < 60; i++) {
    ready = await win.webContents.executeJavaScript('window.__ready === true');
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error('atlas did not finish rendering');

  const data = await win.webContents.executeJavaScript(
    'window.__atlas.toDataURL("image/png")'
  );
  const out = path.join(root, '.data', 'atlas@2x.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
  console.log('atlas saved', out, fs.statSync(out).size);
  app.exit(0);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
