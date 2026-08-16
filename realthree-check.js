/* 真实 three.min.js 启动冒烟验证:
 * 用真实 Three.js r128 执行 game.js 的启动路径(buildWorld/buildGun/startLevel),
 * 仅将 WebGLRenderer 替换为桩,以在 Node 中捕获真实 API 误用。 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const THREE = require('./three.min.js');

const elements = {};
function makeEl(id) {
  return {
    id, style: {}, textContent: '', offsetWidth: 0, children: [],
    classList: { _set: new Set(), add(...cs) { cs.forEach((c) => this._set.add(c)); }, remove(...cs) { cs.forEach((c) => this._set.delete(c)); }, contains(c) { return this._set.has(c); } },
    appendChild() {}
  };
}
const canvasEl = { addEventListener() {}, requestPointerLock() {}, style: {} };
const ctx2d = {
  fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
  fillRect() {}, stroke() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
  fillText() {}, strokeText() {}, fill() {}, save() {}, restore() {}, translate() {}, scale() {},
  createRadialGradient() { return { addColorStop() {} }; },
  createLinearGradient() { return { addColorStop() {} }; }
};
const documentStub = {
  pointerLockElement: null,
  getElementById(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; },
  createElement(tag) {
    if (tag === 'canvas') return { width: 0, height: 0, style: {}, getContext() { return ctx2d; } };
    return { style: {} };
  },
  addEventListener() {}, exitPointerLock() {}
};
const windowStub = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  AudioContext: undefined, webkitAudioContext: undefined, addEventListener() {}
};
THREE.WebGLRenderer = function () {
  return { domElement: canvasEl, shadowMap: { enabled: false, type: 0, mapSize: { set() {} }, camera: { updateProjectionMatrix() {} }, bias: 0, normalBias: 0 }, setPixelRatio() {}, setSize() {}, render() {} };
};
const sandbox = {
  THREE, document: documentStub, window: windowStub,
  performance: { now() { return 0; } },
  requestAnimationFrame() {}, setTimeout, clearTimeout, console, Math
};
const code = fs.readFileSync('game.js', 'utf8');
try {
  vm.runInNewContext(code, sandbox, { timeout: 30000 });
  console.log('REAL-THREE STARTUP OK — buildWorld/buildGun/startLevel 无 API 错误');
} catch (e) {
  console.log('REAL-THREE STARTUP FAILED:', e.message);
  console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}
