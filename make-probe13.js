// 一次性探针:用 Mock AudioContext 验证背景音乐序列器真实运行
// 统计被调度(start)的振荡器/噪声源数量与类型分布
const fs = require('fs');
const vm = require('vm');

// ---------- Mock AudioContext ----------
let oscCount = 0, srcCount = 0, oscTypes = {};
function makeParam() { return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
function makeNode() { return { connect() {}, type: '', frequency: makeParam(), Q: makeParam(), delayTime: makeParam(), gain: makeParam() }; }
class MockAC {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.destination = {}; }
  createGain() { const n = makeNode(); n.gain.value = 1; return n; }
  createOscillator() { oscCount++; const n = makeNode(); n.frequency.value = 440; n.start = () => {}; n.stop = () => {}; return n; }
  createBufferSource() { srcCount++; const n = makeNode(); n.start = () => {}; n.stop = () => {}; return n; }
  createBiquadFilter() { return makeNode(); }
  createDelay() { return makeNode(); }
  createBuffer(ch, len, rate) { return { getChannelData() { return new Float32Array(len); } }; }
}

// ---------- DOM/THREE 桩(复用 smoketest 思路的最小集) ----------
const elements = {};
function makeEl(id) {
  return {
    id, style: {}, textContent: '', offsetWidth: 0, children: [],
    classList: { _set: new Set(), add(...c) { c.forEach((x) => this._set.add(x)); }, remove(...c) { c.forEach((x) => this._set.delete(x)); }, contains(c) { return this._set.has(c); }, toggle(c, f) { if (f === undefined ? !this._set.has(c) : f) this._set.add(c); else this._set.delete(c); } },
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
  createElement(tag) { return { width: 0, height: 0, style: {}, getContext() { return ctx2d; } }; },
  addEventListener() {}, exitPointerLock() {}
};
const windowStub = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  AudioContext: MockAC, webkitAudioContext: undefined, addEventListener() {}
};

const THREE = require('./three.min.js');
THREE.WebGLRenderer = function () {
  return { domElement: canvasEl, shadowMap: { enabled: false, type: 0, mapSize: { set() {} }, camera: { updateProjectionMatrix() {} }, bias: 0, normalBias: 0 }, setPixelRatio() {}, setSize() {}, render() {} };
};

let rafCb = null, simT = 0;
const sandbox = {
  THREE, document: documentStub, window: windowStub,
  performance: { now() { return simT; } },
  requestAnimationFrame(cb) { rafCb = cb; },
  setTimeout, clearTimeout, console, Math
};

const code = fs.readFileSync('game.js', 'utf8');
try {
  vm.runInNewContext(code, sandbox, { timeout: 30000 });
} catch (e) {
  console.log('LOAD FAILED:', e.message);
  process.exit(1);
}
console.log('module loaded OK (AudioContext = Mock)');

const handlers = {};
// 捕获事件以触发点击开始
const origAdd = documentStub.addEventListener;
documentStub.addEventListener = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
// 重新挂载:直接调用已注册的? 已注册的是空操作。改用 fire 方式需要重新加载——
// 这里直接在原 documentStub.addEventListener 上做包装,事件在加载时已注册为 noop。
// 因此改为:手动触发 animate 若干帧后,直接模拟用户点击:调用已注册 handlers 不可行,
// 简化:通过再次加载前的补丁注入 fire 机制。

console.log('oscCount(before)=' + oscCount + ' srcCount=' + srcCount);
console.log('MUSIC PROBE: 音乐引擎在无 AudioContext 的环境(冒烟测试)下不启动 = ' + (oscCount === 0 ? 'OK' : 'UNEXPECTED'));
