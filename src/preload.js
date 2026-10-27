'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  pointerDown: (offset) => ipcRenderer.send('pet:pointer-down', offset),
  pointerUp: () => ipcRenderer.send('pet:pointer-up'),
  menu: () => ipcRenderer.send('pet:menu'),

  onState: (cb) => {
    ipcRenderer.on('pet:state', (_event, state) => cb(state));
  },
  onCursor: (cb) => {
    ipcRenderer.on('pet:cursor', (_event, point) => cb(point));
  },
  onScale: (cb) => {
    ipcRenderer.on('pet:scale', (_event, size) => cb(size));
  },
  onClicked: (cb) => {
    ipcRenderer.on('pet:clicked', () => cb());
  },
  onGrabbed: (cb) => {
    ipcRenderer.on('pet:grabbed', () => cb());
  },
  onDrop: (cb) => {
    ipcRenderer.on('pet:dropped', () => cb());
  }
});
