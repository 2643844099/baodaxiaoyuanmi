/* 冒烟测试:在 Node 中用桩对象模拟 THREE/DOM,真实驱动 game.js 运行
 * 覆盖流程:
 *  阶段1: 第1关,玩家静止等待敌人发现并击杀 → 游戏结束界面
 *  阶段2: 重试第1关,假命中(只打身体)+ 自动寻路机器人 → 击杀掉落战利品并拾取 → 过关界面
 *  阶段3: 进入第2关 → 杀够配额 → 过关
 *  阶段4: 进入第3关 → 杀够配额 → 全部通关结算
 */
const fs = require('fs');
const vm = require('vm');

/* ---------------- THREE 桩 ---------------- */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  normalize() { const l = this.length(); if (l > 0) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  project(camera) { return new V3(this.x, this.y, this.z); }
}

function Obj3() {
  this.position = new V3();
  this.rotation = { order: 'XYZ', x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; }, setScalar(s) { this.x = this.y = this.z = s; } };
  this.visible = true;
  this.castShadow = false;
  this.receiveShadow = false;
  this.userData = {};
  this.children = [];
}
Obj3.prototype.add = function (...c) { this.children.push(...c); };
Obj3.prototype.remove = function () {};
Obj3.prototype.lookAt = function () {};
Obj3.prototype.getWorldPosition = function () { return new V3(); };
Obj3.prototype.updateMatrixWorld = function () {};

const stats = { fakeHit: false, hitEvery: 1, hitRange: Infinity, losBlocked: false, rayCount: 0 };
let lastScene = null;
let lastCamera = null;
let rCount = 0;

function BoxGeometry(w = 1, h = 1, d = 1) { this.w = w; this.h = h; this.d = d; this.type = 'BoxGeometry'; }
function SphereGeometry(r = 1) { this.r = r; this.type = 'SphereGeometry'; }
function PlaneGeometry(w = 1, h = 1) { this.w = w; this.h = h; this.type = 'PlaneGeometry'; }
function CylinderGeometry() { this.type = 'CylinderGeometry'; }
function ConeGeometry() { this.type = 'ConeGeometry'; }
function TorusGeometry() { this.type = 'TorusGeometry'; }

function Mesh(geo, mat) {
  Obj3.call(this);
  this.geometry = geo;
  this.material = mat;
  this.type = geo.type + 'Mesh';
}
Mesh.prototype = Object.create(Obj3.prototype);

function Scene() {
  this.children = [];
  this.background = {};
  this.fog = {};
  lastScene = this;
}
Scene.prototype.add = function (o) { this.children.push(o); };
Scene.prototype.remove = function (o) {
  const i = this.children.indexOf(o);
  if (i >= 0) this.children.splice(i, 1);
};

// 最近的存活敌人身体部件(排除头部,保证伤害节奏确定:3/4/5 枪一杀)
// 可选 stats.hitRange:仅当敌人在该距离内才返回命中(用于保证击杀发生在贴脸距离)
// 可选 stats.hitRangeBoss:Boss 存活时所有子弹优先命中 Boss(远程可中)
function findEnemyMeshHit() {
  const cam = lastCamera ? lastCamera.position : new V3();
  let best = null, bd = Infinity;
  if (stats.hitRangeBoss) {
    for (const grp of lastScene.children) {
      if (!grp.children) continue;
      for (const m of grp.children) {
        if (m.userData && m.userData.boss && m.userData.boss.alive) {
          const wx = grp.position.x + m.position.x;
          const wz = grp.position.z + m.position.z;
          const d = Math.hypot(wx - cam.x, wz - cam.z);
          if (d < bd) { bd = d; best = m; }
        }
      }
    }
    if (best) return best;
  }
  for (const grp of lastScene.children) {
    if (!grp.children) continue;
    for (const m of grp.children) {
      if (m.userData && m.userData.enemy && m.userData.enemy.alive && !m.userData.head) {
        const wx = grp.position.x + m.position.x;
        const wz = grp.position.z + m.position.z;
        const d = Math.hypot(wx - cam.x, wz - cam.z);
        if (d < bd) { bd = d; best = m; }
      }
    }
  }
  if (best && stats.hitRange && bd > stats.hitRange) return null;
  return best;
}

const THREE = {
  Scene, Color: function () {}, Fog: function () {},
  PerspectiveCamera: function (fov) {
    const cam = {
      position: new V3(), fov, aspect: 1, children: [],
      rotation: { order: 'YXZ', x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      add() {}, updateProjectionMatrix() {}
    };
    lastCamera = cam;
    return cam;
  },
  WebGLRenderer: function () { return { domElement: canvasEl, shadowMap: {}, setPixelRatio() {}, setSize() {}, render() {} }; },
  HemisphereLight: function () { return new Obj3(); },
  AmbientLight: function () { return new Obj3(); },
  DirectionalLight: function () {
    const l = new Obj3();
    l.castShadow = false;
    l.shadow = { mapSize: { set() {} }, camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0, updateProjectionMatrix() {} }, bias: 0, normalBias: 0 };
    l.target = {};
    return l;
  },
  PointLight: function () { const l = new Obj3(); l.intensity = 0; return l; },
  Group: function () { return new Obj3(); },
  Object3D: function () { return new Obj3(); },
  Mesh, BoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, TorusGeometry,
  MeshLambertMaterial: function () { return { color: 0, emissive: { setRGB() {} } }; },
  MeshBasicMaterial: function () { return { color: 0, transparent: false, opacity: 1 }; },
  SpriteMaterial: function () { return { map: null, transparent: false, blending: 0, depthWrite: true }; },
  Sprite: function () { const s = new Obj3(); s.material = {}; s.type = 'Sprite'; return s; },
  CanvasTexture: function () { return { wrapS: 0, wrapT: 0, repeat: { set() {} } }; },
  Vector3: V3, Vector2: function () { return { x: 0, y: 0 }; },
  Raycaster: function () {
    const self = {
      far: 1e5,
      __isLos: (++rCount === 2),      // 游戏按顺序创建:第1个=玩家射击射线,第2个=敌人视线射线
      set() {},
      setFromCamera() {},
      intersectObjects() {
        if (self.__isLos) {
          // 敌人视线:losBlocked=true 时永远被遮挡(敌人不追击、不开火)
          return stats.losBlocked ? [{ distance: 0, point: new V3(), object: {} }] : [];
        }
        stats.rayCount++;
        if (!stats.fakeHit) return [];
        if (stats.rayCount % (stats.hitEvery || 1) !== 0) return [];
        const m = findEnemyMeshHit();
        if (!m) return [];
        return [{ distance: 99999, point: new V3(m.position.x, m.position.y, m.position.z), object: m }];
      },
      ray: { at(t) { return new V3(0, 0, -t); } }
    };
    return self;
  },
  Box3: function () {
    return {
      setFromObject(o) {
        const g = o.geometry || {};
        const p = o.position || new V3();
        const hw = (g.w || 0.5) / 2, hh = (g.h || 0.5) / 2, hd = (g.d || 0.5) / 2;
        return { min: new V3(p.x - hw, p.y - hh, p.z - hd), max: new V3(p.x + hw, p.y + hh, p.z + hd) };
      }
    };
  },
  PCFSoftShadowMap: 1, AdditiveBlending: 2, RepeatWrapping: 1000, BackSide: 3
};

/* ---------------- DOM 桩 ---------------- */
const handlers = {};
const canvasEl = {
  addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
  requestPointerLock() { documentStub.pointerLockElement = canvasEl; },
  style: {}
};
const elements = {};
function makeEl(id) {
  return {
    id,
    style: {},
    textContent: '',
    offsetWidth: 0,
    children: [],
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach((c) => this._set.add(c)); },
      remove(...cs) { cs.forEach((c) => this._set.delete(c)); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) { if (force === undefined ? !this._set.has(c) : force) this._set.add(c); else this._set.delete(c); }
    },
    appendChild() {}
  };
}
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
  addEventListener(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
  exitPointerLock() { this.pointerLockElement = null; }
};
const windowStub = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  AudioContext: undefined, webkitAudioContext: undefined,
  addEventListener() {}
};

/* ---------------- 运行 ---------------- */
let simT = 0;
let rafCb = null;
// 固定随机种子,保证冒烟测试可复现(可用环境变量 SEED 覆盖)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seededMath = Object.create(Math);
seededMath.random = mulberry32(Number(process.env.SEED) || 20240608);
const sandbox = {
  THREE, document: documentStub, window: windowStub,
  performance: { now() { return simT; } },
  requestAnimationFrame(cb) { rafCb = cb; },
  setTimeout, clearTimeout, console, Math: seededMath
};

const code = fs.readFileSync('game.js', 'utf8');
let exceptions = 0;
try {
  vm.runInNewContext(code, sandbox, { timeout: 120000 });
} catch (e) {
  console.log('LOAD FAILED:', e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
console.log('module loaded OK');

function fire(ev, payload) {
  for (const h of handlers[ev] || []) {
    try { h(Object.assign({ preventDefault() {} }, payload || {})); }
    catch (e) { exceptions++; if (exceptions <= 5) console.log('EVENT ERR (' + ev + '):', e.message); }
  }
}

let maxBullets = 0;
function runFrames(n, onFrame) {
  for (let i = 0; i < n; i++) {
    simT += 16.7;
    // 排除装饰用球体(星空穹顶/塔顶能量球),只统计敌人子弹
    maxBullets = Math.max(maxBullets, lastScene.children.filter((c) => c.type === 'SphereGeometryMesh' && !c.userData.decor).length);
    if (onFrame) onFrame(i);
    const cb = rafCb;
    try { cb(); } catch (e) {
      exceptions++;
      if (exceptions <= 5) {
        console.log('FRAME ERR at t=' + (simT / 1000).toFixed(1) + 's:', e.message);
        console.log(e.stack.split('\n').slice(0, 5).join('\n'));
      }
    }
  }
}

function lootGroups() {
  const out = [];
  for (const grp of lastScene.children) {
    if (!grp.children || grp.children.length !== 3) continue;
    const types = grp.children.map((c) => c.type);
    if (types.includes('BoxGeometryMesh') && types.includes('Sprite')) out.push(grp);
  }
  return out;
}

/* ============ 阶段1: 第1关,玩家原地不动,等待敌人击杀 ============ */
fire('click', {});                       // 开始游戏
// 循环直到游戏结束,上限 150 秒
let gameOverReached = false;
let phase1Damage = false;                // 玩家是否曾受伤(枪击或近战)
for (let i = 0; i < 9000 && !gameOverReached; i++) {
  runFrames(1);
  if (Number(elements['health-num'].textContent) < 100) phase1Damage = true;
  gameOverReached = elements.gameover.classList.contains('show');
}
const health1 = elements['health-num'].textContent;
const goLevelText = elements['go-level'].textContent;
console.log('phase1: health=' + health1,
  '| gameOver=' + gameOverReached,
  '| go-level="' + goLevelText + '"',
  '| simSeconds=' + Math.round(simT / 1000),
  '| maxBullets=' + maxBullets);

/* ============ 阶段2: 重试第1关,假命中+寻路机器人,拾取战利品,15杀后击杀Boss过关 ============ */
stats.fakeHit = true;
stats.losBlocked = true;                 // 敌人看不到玩家 → 不追击不开火,长流程中玩家绝对安全
stats.hitEvery = 1;                      // 每枪必中
stats.hitRange = 3;                      // 但仅限 3 米内的敌人 → 击杀必发生在贴脸距离,掉落物就在脚下
stats.hitRangeBoss = true;               // Boss 存活时子弹优先命中 Boss(远程可中)
fire('click', {});                       // gameover → 重新挑战第 1 关
fire('keydown', { code: 'KeyW' });
let shooting = false;

let botYaw = 0;
let prevX = lastCamera.position.x, prevZ = lastCamera.position.z;
let pickupMsgFrames = 0, maxLootGroups = 0;
let detour = 0;                          // 卡住时垂直绕行方向(±1)
let detourFrom = null;                   // 本次绕行起点
let stuckPos = { x: prevX, z: prevZ };
const ammoValues = new Set();
function bossAliveCheck() {
  for (const grp of lastScene.children) {
    if (!grp.children) continue;
    for (const m of grp.children) {
      if (m.userData && m.userData.boss && m.userData.boss.alive) return true;
    }
  }
  return false;
}
// 阶段3/4 补给跑手:弹药不足时走向最近的地面战利品拾取(优先地面,避免爬坡卡死)
let runnerYaw = 0;
let runnerPrevX = lastCamera.position.x, runnerPrevZ = lastCamera.position.z;
function makeAmmoRunner() {
  return function (i) {
    const cam = lastCamera.position;
    const cur = Number(elements['ammo-cur'].textContent);
    const res = Number(elements['ammo-reserve'].textContent);
    if (cur + res > 60) { fire('keyup', { code: 'KeyW' }); return; }
    let target = null, bd = Infinity;
    for (const grp of lootGroups()) {
      const d = Math.hypot(grp.position.x - cam.x, grp.position.z - cam.z);
      if (grp.position.y < 2 && d < bd) { bd = d; target = { x: grp.position.x, z: grp.position.z }; }
    }
    if (!target) {
      for (const grp of lootGroups()) {
        const d = Math.hypot(grp.position.x - cam.x, grp.position.z - cam.z);
        if (d < bd) { bd = d; target = { x: grp.position.x, z: grp.position.z }; }
      }
    }
    if (!target) return;
    const dx = cam.x - runnerPrevX, dz = cam.z - runnerPrevZ;
    if (Math.hypot(dx, dz) > 0.02) runnerYaw = Math.atan2(-dx, -dz);
    runnerPrevX = cam.x; runnerPrevZ = cam.z;
    let d = Math.atan2(cam.x - target.x, cam.z - target.z) - runnerYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    fire('mousemove', { movementX: -d / 0.0022, movementY: 0 });
    fire('keydown', { code: 'KeyW' });
  };
}
const phase2 = {
  onFrame(i) {
    ammoValues.add(elements['ammo-cur'].textContent);
    if (elements['pickup-msg'].classList.contains('show')) pickupMsgFrames++;
    maxLootGroups = Math.max(maxLootGroups, lootGroups().length);
    // 机器人:优先 Boss;否则找最近战利品/存活敌人,朝向目标并保持 W 前进
    const cam = lastCamera.position;
    const dx = cam.x - prevX, dz = cam.z - prevZ;
    if (Math.hypot(dx, dz) > 0.02) botYaw = Math.atan2(-dx, -dz);
    prevX = cam.x; prevZ = cam.z;
    const bossAlive = bossAliveCheck();
    let target = null;
    let nearestEnemyDist = Infinity;
    if (bossAlive) {
      // 锁定 Boss 位置
      for (const grp of lastScene.children) {
        if (!grp.children) continue;
        let isBoss = false;
        for (const m of grp.children) if (m.userData && m.userData.boss) { isBoss = true; break; }
        if (isBoss) { target = { x: grp.position.x, z: grp.position.z }; break; }
      }
    } else {
      let nearestLootDist = Infinity, lootPos = null;
      let enemyPos = null;
      let nearestGroundDist = Infinity, groundPos = null;
      for (const grp of lootGroups()) {
        const d = Math.hypot(grp.position.x - cam.x, grp.position.z - cam.z);
        if (d < nearestLootDist) { nearestLootDist = d; lootPos = { x: grp.position.x, z: grp.position.z }; }
      }
      for (const grp of lastScene.children) {
        if (!grp.children) continue;
        let alive = false;
        for (const m of grp.children) {
          if (m.userData && m.userData.enemy && m.userData.enemy.alive) { alive = true; break; }
        }
        if (!alive) continue;
        const d = Math.hypot(grp.position.x - cam.x, grp.position.z - cam.z);
        nearestEnemyDist = Math.min(nearestEnemyDist, d);
        if (grp.position.y < 2) {
          // 地面敌人优先(高台敌人需要绕路爬坡,代价大)
          if (d < nearestGroundDist) { nearestGroundDist = d; groundPos = { x: grp.position.x, z: grp.position.z }; }
        } else if (d < nearestEnemyDist) {
          enemyPos = { x: grp.position.x, z: grp.position.z };
        }
      }
      const chosen = groundPos || enemyPos;
      // 大图策略:远处战利品不值得绕路,优先近处敌人(附近战利品经过时自动拾取)
      if (lootPos && (nearestLootDist < 12 || !chosen)) target = lootPos;
      else target = chosen;
    }
    // 贴脸才开火;Boss 存活时远程集火
    if (!shooting && (nearestEnemyDist < 3.5 || bossAlive)) { shooting = true; fire('mousedown', { button: 0 }); }
    else if (shooting && nearestEnemyDist > 5 && !bossAlive) { shooting = false; fire('mouseup', { button: 0 }); }
    // 卡住检测:每 90 帧位移 < 0.6m 且有目标 → 开启绕行;绕行满 12m 后再尝试直线
    if (i % 90 === 0) {
      const moved = Math.hypot(cam.x - stuckPos.x, cam.z - stuckPos.z);
      if (target && moved < 0.6) {
        if (detour === 0) { detour = 1; detourFrom = { x: cam.x, z: cam.z }; }
      } else if (detour !== 0) {
        const detourMoved = Math.hypot(cam.x - detourFrom.x, cam.z - detourFrom.z);
        if (detourMoved >= 12) detour = 0;
      }
      stuckPos = { x: cam.x, z: cam.z };
    }
    if (target) {
      let wx = target.x, wz = target.z;
      if (detour !== 0) {
        // 垂直绕行:绕目标顺时针/逆时针走,沿障碍物滑动脱困
        const tdx = target.x - cam.x, tdz = target.z - cam.z;
        wx = cam.x + (-tdz) * detour;
        wz = cam.z + (tdx) * detour;
      }
      // 玩家 yaw=0 朝向 -Z,与敌人模型(+Z)相反:atan2 参数取反
      let d = Math.atan2(cam.x - wx, cam.z - wz) - botYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      fire('mousemove', { movementX: -d / 0.0022, movementY: 0 });
    }
  }
};
runFrames(21000, phase2.onFrame);         // 350 秒(15 杀 + Boss + 大图移动 + 重生等待)
const levelClear1 = elements.levelclear.classList.contains('show');
const diedAgain = elements.gameover.classList.contains('show');
console.log('phase2: levelClear=' + levelClear1,
  '| diedAgain=' + diedAgain,
  '| pickupMsgFrames=' + pickupMsgFrames,
  '| maxLootGroups=' + maxLootGroups,
  '| distinctAmmo=' + ammoValues.size,
  '| score=' + elements['score-val'].textContent);

/* ============ 阶段3: 第2关,击杀配额(20杀)+Boss过关(敌人视线被屏蔽,玩家安全) ============ */
stats.losBlocked = true;                 // 敌人不开火
stats.hitEvery = 1;                      // 每枪必中
stats.hitRange = Infinity;               // 不限距离(玩家静止,敌人远距离击杀)
stats.hitRangeBoss = true;               // Boss 存活时集火 Boss
fire('click', {});                       // levelclear → 进入第 2 关
fire('mousedown', { button: 0 });
const title2 = elements['level-title'].textContent;
runFrames(7200, makeAmmoRunner());       // 120 秒(20 杀 + Boss + 重生等待 + 补给)
const levelClear2 = elements.levelclear.classList.contains('show');
console.log('phase3: title="' + title2 + '"',
  '| levelClear=' + levelClear2,
  '| kills=' + elements['kills-val'].textContent,
  '| score=' + elements['score-val'].textContent);

/* ============ 阶段4: 第3关,击杀配额(25杀)+Boss,全部通关 ============ */
stats.losBlocked = true;                 // 敌人不开火
stats.hitEvery = 1;                      // 每枪必中
stats.hitRange = Infinity;               // 不限距离
stats.hitRangeBoss = true;               // Boss 存活时集火 Boss
fire('click', {});                       // levelclear → 进入第 3 关
fire('mousedown', { button: 0 });
const title3 = elements['level-title'].textContent;
runFrames(9000, makeAmmoRunner());       // 150 秒(25 杀 + Boss + 重生等待 + 补给)
const victoryShown = elements.victory.classList.contains('show');
console.log('phase4: title="' + title3 + '"',
  '| victory=' + victoryShown,
  '| vic-kills=' + elements['vic-kills'].textContent,
  '| vic-score=' + elements['vic-score'].textContent);

/* ============ 断言 ============ */
const fails = [];
if (exceptions > 0) fails.push(exceptions + ' runtime exceptions');
if (!gameOverReached) fails.push('phase1: gameover never reached in 120s');
if (Number(health1) > 0) fails.push('phase1: player survived (expected death)');
if (!goLevelText.includes('第 1 关')) fails.push('phase1: go-level text wrong: ' + goLevelText);
if (maxBullets <= 0 && !phase1Damage) fails.push('phase1: enemies never engaged (no bullets, no melee)');
if (diedAgain) fails.push('phase2: player died again (should clear level first)');
if (!levelClear1) fails.push('phase2: level 1 not cleared');
if (pickupMsgFrames <= 0) fails.push('phase2: loot never picked up');
if (maxLootGroups <= 0) fails.push('phase2: no loot dropped');
if (ammoValues.size < 5) fails.push('phase2: shooting/reload path weak');
if (!title2.includes('第 2 关')) fails.push('phase3: wrong level title: ' + title2);
if (!levelClear2) fails.push('phase3: level 2 not cleared');
if (!title3.includes('第 3 关')) fails.push('phase4: wrong level title: ' + title3);
if (!victoryShown) fails.push('phase4: victory screen not shown');
if (String(elements['vic-kills'].textContent) !== '60') fails.push('phase4: total kills should be 60, got ' + elements['vic-kills'].textContent);
if (Number(elements['vic-score'].textContent) < 9300) fails.push('phase4: score too low: ' + elements['vic-score'].textContent);

console.log('exceptions:', exceptions);
if (fails.length) { console.log('FAILED:'); fails.forEach((f) => console.log(' -', f)); process.exit(1); }
console.log('SMOKE TEST PASSED — 关卡/战利品全流程无运行时错误');
