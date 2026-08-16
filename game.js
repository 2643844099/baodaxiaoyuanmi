/* ============================================================================
 * NEO STRIKE 量子突击 — 科幻风 3D 第一人称射击 (Three.js 单文件小游戏)
 * 本文件为游戏逻辑,构建时会被内联到 index.html
 *
 * 特性:
 *  - 第一人称视角,WASD 移动 / 鼠标瞄准射击 / 空格跳跃 / Shift 疾跑
 *  - 科幻场景:星空穹顶、霓虹网格地面、全息塔、多层平台与坡道、能量屏障
 *  - 武器:等离子步枪(左键)+ 等离子炮(右键),青色能量弹道
 *  - 敌人:悬浮战斗机器人,巡逻 → 发现 → 追击 → 开火;死亡掉落能量电池/纳米医疗包
 *  - HUD:霓虹风准星、装甲、能量弹药、得分/击杀、关卡进度
 *  - 音效由 WebAudio 实时合成,无需外部资源
 * ==========================================================================*/
'use strict';

(function () {
  if (typeof THREE === 'undefined') {
    var loadErr = document.getElementById('load-error');
    if (loadErr) loadErr.style.display = 'block';
    return;
  }

  /* ------------------------------ 常量 ------------------------------ */
  var ARENA = 90;          // 战场半宽(内墙)—— 原版 45,地图面积扩大 4 倍
  var MAG_SIZE = 30;       // 弹匣容量
  var RESERVE = 120;       // 备弹(每关开始时补满)

  // 关卡配置:由易到难(enemies=枪手无人机,rushers=近战猎杀者,soldiers=未来士兵)
  var LEVELS = [
    { name: '训练协议', enemies: 4, rushers: 3, soldiers: 3, quota: 15, hp: 100, speed: 4.2, fireMin: 1.5, fireMax: 2.2, bulletSpeed: 24, dmgMin: 7,  dmgMax: 10, detect: 24, respawnMin: 5, respawnMax: 8 },
    { name: '突袭协议', enemies: 6, rushers: 4, soldiers: 5, quota: 20, hp: 130, speed: 5.2, fireMin: 1.2, fireMax: 1.9, bulletSpeed: 27, dmgMin: 8,  dmgMax: 13, detect: 28, respawnMin: 4, respawnMax: 7 },
    { name: '灭绝协议', enemies: 5, rushers: 5, soldiers: 5, quota: 25, hp: 160, speed: 6.2, fireMin: 0.9, fireMax: 1.5, bulletSpeed: 30, dmgMin: 10, dmgMax: 15, detect: 32, respawnMin: 3, respawnMax: 6 }
  ];

  // 猎杀者(近战高速型机器人):血量低、移速极快,贴近玩家后近战突刺
  var RUSHER = { hp: 70, speedMult: 1.7, dmg: 18, cooldown: 0.9, strikeRange: 1.9, chaseRange: 2.8, lungeTime: 0.3 };

  // 未来士兵(远程人形小兵):穿戴装甲防具、手持未来步枪,三连发点射
  var SOLDIER = { hpMult: 0.9, burst: 3 };

  // Boss「小圆咪」:独立建模的巨型机甲,数倍体积、十数倍血量、多管齐射
  var BOSS = {
    name: '小圆咪',
    hpMult: 13,             // 血量 = 本关小兵血量 × 13(十数倍)
    speed: 3.2,             // 移动速度(较原版更快,更具压迫感)
    radius: 1.6,
    attackRange: 30,        // 攻击范围(较原版更远,远程火力压制)
    volley: [3, 4, 5],      // 每关齐射弹数
    volleyDmg: 5,           // 每发伤害
    volleyInterval: [2.4, 2.6, 3.0],  // 每关齐射间隔(秒)
    bulletSpeed: 26,
    score: 500              // 击杀 Boss 奖励分
  };

  /* ------------------------------ DOM ------------------------------- */
  function $(id) { return document.getElementById(id); }

  var hud = $('hud'), menuEl = $('menu'), pauseEl = $('pause'), overEl = $('gameover');
  var scoreEl = $('score-val'), killsEl = $('kills-val'), enemiesEl = $('enemies-val');
  var ammoCurEl = $('ammo-cur'), ammoResEl = $('ammo-reserve'), reloadEl = $('reload-hint');
  var healthFillEl = $('health-fill'), healthNumEl = $('health-num');
  var vignetteEl = $('vignette'), hitmarkerEl = $('hitmarker'), crosshairEl = $('crosshair');
  var finalScoreEl = $('final-score'), finalKillsEl = $('final-kills'), finalAccEl = $('final-acc');
  var levelTitleEl = $('level-title'), levelProgressFillEl = $('level-progress-fill'), levelProgressTextEl = $('level-progress-text');
  var pickupMsgEl = $('pickup-msg');
  var levelClearEl = $('levelclear'), victoryEl = $('victory');
  var bossHudEl = $('boss-panel'), bossFillEl = $('boss-hp-fill');
  var scopeEl = $('scope'), bossMarkerEl = $('boss-marker');
  var lcLevelEl = $('lc-level'), lcTimeEl = $('lc-time'), lcBonusEl = $('lc-bonus'), lcScoreEl = $('lc-score'), lcNextEl = $('lc-next');
  var vicScoreEl = $('vic-score'), vicKillsEl = $('vic-kills'), vicAccEl = $('vic-acc');
  var goLevelEl = $('go-level');

  /* --------------------------- 渲染器/场景 --------------------------- */
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060e);
  scene.fog = new THREE.Fog(0x05070f, 60, 460);

  var camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  var canvas = renderer.domElement;
  $('game').appendChild(canvas);

  /* ------------------------------ 灯光 ------------------------------ */
  scene.add(new THREE.HemisphereLight(0x2a3a5c, 0x0c0a18, 0.75));
  scene.add(new THREE.AmbientLight(0x1a2540, 0.5));
  var sun = new THREE.DirectionalLight(0xcfe6ff, 1.2);
  sun.position.set(70, 110, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  // 霓虹氛围点光源(青色/品红)
  var ambLights = [
    { c: 0x33e0ff, x: 0, y: 14, z: 0, i: 1.7, d: 110 },
    { c: 0xff3df0, x: 88, y: 13, z: 88, i: 1.3, d: 90 },
    { c: 0xff3df0, x: -88, y: 13, z: -88, i: 1.3, d: 90 },
    { c: 0x33e0ff, x: 0, y: 10, z: 60, i: 0.9, d: 70 },
    { c: 0x33e0ff, x: -60, y: 10, z: 0, i: 0.9, d: 70 }
  ];
  for (var li = 0; li < ambLights.length; li++) {
    var al = ambLights[li];
    var pl = new THREE.PointLight(al.c, al.i, al.d, 2);
    pl.position.set(al.x, al.y, al.z);
    scene.add(pl);
  }

  /* ------------------------------ 工具 ------------------------------ */
  function clamp(v, a, b) { return Math.max(a, Math.min(v, b)); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------------------- 贴图生成 ---------------------------- */
  function makeGroundTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 512;
    var g = c.getContext('2d');
    // 深色金属底板
    g.fillStyle = '#0b101c';
    g.fillRect(0, 0, 512, 512);
    var i;
    // 金属噪点
    for (i = 0; i < 2600; i++) {
      g.fillStyle = 'rgba(' + (45 + Math.floor(Math.random() * 55)) + ',' +
        (70 + Math.floor(Math.random() * 80)) + ',' +
        (95 + Math.floor(Math.random() * 100)) + ',0.13)';
      g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // 暗色结构网格
    g.strokeStyle = 'rgba(30,55,85,0.55)';
    g.lineWidth = 2;
    for (i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke();
    }
    // 霓虹发光网格线
    g.strokeStyle = 'rgba(56,220,255,0.30)';
    g.lineWidth = 1;
    for (i = 0; i <= 16; i++) {
      g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 512); g.stroke();
      g.beginPath(); g.moveTo(0, i * 32); g.lineTo(512, i * 32); g.stroke();
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    return tex;
  }

  // 星空穹顶贴图:深空渐变 + 星云 + 行星环 + 繁星
  function makeStarfieldTexture() {
    var c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    var g = c.getContext('2d');
    var grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#02030a');
    grad.addColorStop(0.55, '#050814');
    grad.addColorStop(1, '#0a0c1c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    var i;
    // 星云
    for (i = 0; i < 26; i++) {
      var nx = Math.random() * 1024, ny = Math.random() * 512, nr = 30 + Math.random() * 130;
      var rg = g.createRadialGradient(nx, ny, 0, nx, ny, nr);
      var hue = Math.random() < 0.5 ? '0,190,255' : '255,70,225';
      rg.addColorStop(0, 'rgba(' + hue + ',0.10)');
      rg.addColorStop(1, 'rgba(' + hue + ',0)');
      g.fillStyle = rg;
      g.fillRect(nx - nr, ny - nr, nr * 2, nr * 2);
    }
    // 行星
    var px = 780, py = 140, pr = 64;
    var pg = g.createRadialGradient(px - 24, py - 24, 6, px, py, pr);
    pg.addColorStop(0, '#9fdcff');
    pg.addColorStop(0.45, '#2a6fa8');
    pg.addColorStop(1, '#0c2340');
    g.fillStyle = pg;
    g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    // 行星环
    g.save();
    g.translate(px, py);
    g.scale(1, 0.3);
    g.strokeStyle = 'rgba(140,225,255,0.6)';
    g.lineWidth = 11;
    g.beginPath(); g.arc(0, 0, pr + 26, 0, Math.PI * 2); g.stroke();
    g.restore();
    // 繁星
    for (i = 0; i < 750; i++) {
      var b = 0.3 + Math.random() * 0.7;
      g.fillStyle = 'rgba(255,255,255,' + b.toFixed(2) + ')';
      var s = Math.random() < 0.05 ? 2 : 1;
      g.fillRect(Math.random() * 1024, Math.random() * 512, s, s);
    }
    return new THREE.CanvasTexture(c);
  }

  function makeRadialTexture(inner, outer) {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, inner || 'rgba(255,244,214,1)');
    grad.addColorStop(1, outer || 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  function makeTextSprite(text, fill) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var g = c.getContext('2d');
    g.font = 'bold 96px Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(2,10,24,0.95)';
    g.lineWidth = 14;
    g.strokeText(text, 64, 64);
    g.fillStyle = fill || '#6ff0ff';
    g.fillText(text, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  }

  /* ---------------------------- 碰撞系统 ---------------------------- */
  var colliders = [];        // {minX,maxX,minZ,maxZ}
  var obstacleMeshes = [];   // 用于视线/子弹射线检测
  var shootTargets = [];     // 玩家子弹的检测目标(障碍物+敌人)

  function circleHitsCollider(pos, radius) {
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      var dx = pos.x - clamp(pos.x, c.minX, c.maxX);
      var dz = pos.z - clamp(pos.z, c.minZ, c.maxZ);
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  function resolveCircle(pos, radius) {
    for (var i = 0; i < colliders.length; i++) {
      var c = colliders[i];
      var cx = clamp(pos.x, c.minX, c.maxX);
      var cz = clamp(pos.z, c.minZ, c.maxZ);
      var dx = pos.x - cx, dz = pos.z - cz;
      var d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-9) {
          var d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          var pushL = pos.x - c.minX, pushR = c.maxX - pos.x;
          var pushT = pos.z - c.minZ, pushB = c.maxZ - pos.z;
          var m = Math.min(pushL, pushR, pushT, pushB);
          if (m === pushL) pos.x = c.minX - radius;
          else if (m === pushR) pos.x = c.maxX + radius;
          else if (m === pushT) pos.z = c.minZ - radius;
          else pos.z = c.maxZ + radius;
        }
      }
    }
  }

  function moveEntity(pos, dx, dz, radius) {
    pos.x += dx; resolveCircle(pos, radius);
    pos.z += dz; resolveCircle(pos, radius);
  }

  /* ------------------- 多层平台 / 坡道系统 ------------------- */
  var platforms = [];   // {minX,maxX,minZ,maxZ,h} 可站立的高台顶面
  var ramps = [];       // {axis,minX,maxX,minZ,maxZ,hMin,hMax} 坡道高度过渡

  // 查询某点地面高度(坡道优先于平台,平台优先于地面)
  // refY: 查询者当前高度。若表面明显高于查询者(>0.6m),视为处于其下方,
  //       可正常从桥底/坡下穿过,不会被传送到坡面上。
  function groundHeightAt(x, z, refY) {
    var i, r, p, h;
    for (i = 0; i < ramps.length; i++) {
      r = ramps[i];
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        h = r.axis === 'x'
          ? r.hMin + (x - r.minX) / (r.maxX - r.minX) * (r.hMax - r.hMin)
          : r.hMin + (z - r.minZ) / (r.maxZ - r.minZ) * (r.hMax - r.hMin);
        if (refY === undefined || refY >= h - 0.6) return h;
      }
    }
    for (i = 0; i < platforms.length; i++) {
      p = platforms[i];
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
        if (refY === undefined || refY >= p.h - 0.6) return p.h;
      }
    }
    return 0;
  }

  /* ------------------------------ 世界 ------------------------------ */
  function registerObstacle(mesh) {
    scene.add(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(mesh);
    colliders.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
    obstacleMeshes.push(mesh);
  }

  function buildWorld() {
    // 星空穹顶
    var sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.MeshBasicMaterial({ map: makeStarfieldTexture(), side: THREE.BackSide, fog: false })
    );
    sky.userData.decor = true;
    scene.add(sky);

    // 霓虹网格金属地板
    var ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshLambertMaterial({ map: makeGroundTexture() })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    /* ------------------------------ 材质 ------------------------------ */
    var wallMat = new THREE.MeshLambertMaterial({ color: 0x1a2233, emissive: 0x04070d });
    var platMat = new THREE.MeshLambertMaterial({ color: 0x1b2434, emissive: 0x050810 });
    var platWallMat = new THREE.MeshLambertMaterial({ color: 0x131a26 });
    var rampMat = new THREE.MeshLambertMaterial({ color: 0x20293c });
    var glowMat = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    var glowMagMat = new THREE.MeshBasicMaterial({ color: 0xff4de3, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });
    var crateMat = new THREE.MeshLambertMaterial({ color: 0x24344a, emissive: 0x081018 });
    var pillarMat = new THREE.MeshLambertMaterial({ color: 0x1c2533, emissive: 0x060a12 });
    var coreMat = new THREE.MeshLambertMaterial({ color: 0x0b2a33, emissive: 0x00b8e8 });
    var holoMat = new THREE.MeshBasicMaterial({ color: 0x57f0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    var orbMat = new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });

    // 霓虹灯条辅助
    function addGlowBox(w, h, d, x, y, z, mat) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || glowMat);
      m.position.set(x, y, z);
      scene.add(m);
      return m;
    }

    /* ------------------------------ 围墙 ------------------------------ */
    var L = ARENA * 2 + 7, wallH = 7, wall;
    wall = new THREE.Mesh(new THREE.BoxGeometry(2.5, wallH, L), wallMat);
    wall.position.set(-(ARENA + 1), wallH / 2, 0);
    registerObstacle(wall);
    wall = new THREE.Mesh(new THREE.BoxGeometry(2.5, wallH, L), wallMat);
    wall.position.set(ARENA + 1, wallH / 2, 0);
    registerObstacle(wall);
    wall = new THREE.Mesh(new THREE.BoxGeometry(L, wallH, 2.5), wallMat);
    wall.position.set(0, wallH / 2, -(ARENA + 1));
    registerObstacle(wall);
    wall = new THREE.Mesh(new THREE.BoxGeometry(L, wallH, 2.5), wallMat);
    wall.position.set(0, wallH / 2, ARENA + 1);
    registerObstacle(wall);

    // 围墙顶霓虹灯带
    addGlowBox(3.0, 0.22, L - 1, -(ARENA + 1), wallH - 0.12, 0);
    addGlowBox(3.0, 0.22, L - 1, ARENA + 1, wallH - 0.12, 0);
    addGlowBox(L - 1, 0.22, 3.0, 0, wallH - 0.12, -(ARENA + 1));
    addGlowBox(L - 1, 0.22, 3.0, 0, wallH - 0.12, ARENA + 1);

    // 四角哨戒塔
    var towers = [[-88, -88], [88, -88], [-88, 88], [88, 88]];
    for (var ti = 0; ti < towers.length; ti++) {
      var tw = new THREE.Mesh(new THREE.BoxGeometry(6, 14, 6), wallMat);
      tw.position.set(towers[ti][0], 7, towers[ti][1]);
      registerObstacle(tw);
      addGlowBox(2, 1.6, 2, towers[ti][0], 15, towers[ti][1], glowMagMat);
      addGlowBox(0.8, 0.3, 0.8, towers[ti][0], 14.4, towers[ti][1], glowMat);
    }

    /* ------------------- 多层平台 + 坡道 ------------------- */
    // 高台:顶板 + 霓虹边缘 + 侧墙(坡道处留缺口)
    function addPlatform(px, pz, pw, pd, ph, gaps) {
      platforms.push({ minX: px - pw / 2, maxX: px + pw / 2, minZ: pz - pd / 2, maxZ: pz + pd / 2, h: ph });
      var top = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.6, pd), platMat);
      top.position.set(px, ph - 0.3, pz);
      top.receiveShadow = true;
      scene.add(top);
      obstacleMeshes.push(top);
      addGlowBox(pw - 0.5, 0.12, 0.3, px, ph + 0.1, pz - pd / 2 + 0.35);
      addGlowBox(pw - 0.5, 0.12, 0.3, px, ph + 0.1, pz + pd / 2 - 0.35);
      addGlowBox(0.3, 0.12, pd - 0.5, px - pw / 2 + 0.35, ph + 0.1, pz);
      addGlowBox(0.3, 0.12, pd - 0.5, px + pw / 2 - 0.35, ph + 0.1, pz);
      // 侧墙分段
      var t = 0.5, wallH2 = ph + 0.6;
      function addSeg(alongX, a, b, fixed) {
        var seg;
        if (alongX) {
          seg = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(b - a), wallH2, t), platWallMat);
          seg.position.set((a + b) / 2, wallH2 / 2, fixed);
        } else {
          seg = new THREE.Mesh(new THREE.BoxGeometry(t, wallH2, Math.abs(b - a)), platWallMat);
          seg.position.set(fixed, wallH2 / 2, (a + b) / 2);
        }
        registerObstacle(seg);
      }
      function gapOn(axis, side) {
        for (var k = 0; k < gaps.length; k++) {
          if (gaps[k].axis === axis && gaps[k].side === side) return gaps[k];
        }
        return null;
      }
      var minX = px - pw / 2, maxX = px + pw / 2, minZ = pz - pd / 2, maxZ = pz + pd / 2;
      var s, g, segs, k;
      // 沿 Z 的边(x = minX / maxX)
      for (s = -1; s <= 1; s += 2) {
        var ex = s < 0 ? minX : maxX;
        g = gapOn('x', s);
        segs = g ? [[minZ, g.c - g.half], [g.c + g.half, maxZ]] : [[minZ, maxZ]];
        for (k = 0; k < segs.length; k++) if (segs[k][1] - segs[k][0] > 0.01) addSeg(false, segs[k][0], segs[k][1], ex);
      }
      // 沿 X 的边(z = minZ / maxZ)
      for (s = -1; s <= 1; s += 2) {
        var ez = s < 0 ? minZ : maxZ;
        g = gapOn('z', s);
        segs = g ? [[minX, g.c - g.half], [g.c + g.half, maxX]] : [[minX, maxX]];
        for (k = 0; k < segs.length; k++) if (segs[k][1] - segs[k][0] > 0.01) addSeg(true, segs[k][0], segs[k][1], ez);
      }
    }

    // 坡道:视觉网格 + 子弹/视线阻挡(不阻挡行走,高度由 groundHeightAt 计算)
    function addRampMesh(x0, z0, x1, z1, h0, h1, width) {
      var Lr, midH = (h0 + h1) / 2, a, m;
      if (x1 !== x0) {
        Lr = Math.abs(x1 - x0);
        // hMin = minX 端高度,hMax = maxX 端高度(与行走高度函数一致)
        var hMin = x0 < x1 ? h0 : h1, hMax = x0 < x1 ? h1 : h0;
        a = Math.asin((hMax - hMin) / Lr);
        ramps.push({ axis: 'x', minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: z0 - width / 2, maxZ: z0 + width / 2, hMin: hMin, hMax: hMax });
        m = new THREE.Mesh(new THREE.BoxGeometry(Lr, 0.5, width), rampMat);
        m.position.set((x0 + x1) / 2, midH - 0.25 * Math.cos(a), z0);
        m.rotation.z = a;
      } else {
        Lr = Math.abs(z1 - z0);
        // hMin = minZ 端高度,hMax = maxZ 端高度
        var hMin2 = z0 < z1 ? h0 : h1, hMax2 = z0 < z1 ? h1 : h0;
        a = Math.asin((hMin2 - hMax2) / Lr);
        ramps.push({ axis: 'z', minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1), minX: x0 - width / 2, maxX: x0 + width / 2, hMin: hMin2, hMax: hMax2 });
        m = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, Lr), rampMat);
        m.position.set(x0, midH - 0.25 * Math.cos(a), (z0 + z1) / 2);
        m.rotation.x = a;
      }
      m.castShadow = true;
      scene.add(m);
      obstacleMeshes.push(m);
    }

    // 中央高台(高 7,四面坡道)
    addPlatform(0, 0, 20, 20, 7, [
      { axis: 'x', side: -1, c: 0, half: 4 }, { axis: 'x', side: 1, c: 0, half: 4 },
      { axis: 'z', side: -1, c: 0, half: 4 }, { axis: 'z', side: 1, c: 0, half: 4 }
    ]);
    // 四座中部平台(高 3.5)
    addPlatform(0, -24, 14, 14, 3.5, [
      { axis: 'z', side: -1, c: 0, half: 4 }, { axis: 'z', side: 1, c: 0, half: 4 }
    ]);
    addPlatform(24, 0, 14, 14, 3.5, [
      { axis: 'x', side: -1, c: 0, half: 4 }, { axis: 'x', side: 1, c: 0, half: 4 }
    ]);
    addPlatform(0, 24, 14, 14, 3.5, [
      { axis: 'z', side: -1, c: 0, half: 4 }, { axis: 'z', side: 1, c: 0, half: 4 }
    ]);
    addPlatform(-24, 0, 14, 14, 3.5, [
      { axis: 'x', side: -1, c: 0, half: 4 }, { axis: 'x', side: 1, c: 0, half: 4 }
    ]);
    // 地面 → 中部平台
    addRampMesh(0, -43, 0, -31, 0, 3.5, 8);
    addRampMesh(43, 0, 31, 0, 0, 3.5, 8);
    addRampMesh(0, 43, 0, 31, 0, 3.5, 8);
    addRampMesh(-43, 0, -31, 0, 0, 3.5, 8);
    // 中部平台 → 高台
    addRampMesh(0, -17, 0, -10, 3.5, 7, 8);
    addRampMesh(17, 0, 10, 0, 3.5, 7, 8);
    addRampMesh(0, 17, 0, 10, 3.5, 7, 8);
    addRampMesh(-17, 0, -10, 0, 3.5, 7, 8);

    // 中央能量核心塔
    var core = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 13, 10), coreMat);
    core.position.set(0, 7 + 6.5, 0);
    scene.add(core);
    registerObstacle(core);
    // 全息旋转环(animate 中旋转)
    holos.length = 0;
    for (var hi = 0; hi < 3; hi++) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(4.6 + hi * 1.7, 0.12, 8, 40), holoMat);
      ring.position.y = 8.6 + hi * 1.9;
      ring.rotation.x = 0.35 + hi * 0.4;
      scene.add(ring);
      holos.push(ring);
    }
    // 塔顶能量球
    var orb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), orbMat);
    orb.position.set(0, 15.6, 0);
    orb.userData.decor = true;
    scene.add(orb);
    // 高台四角立柱
    var hc = [[-8, -8], [8, -8], [-8, 8], [8, 8]];
    for (var hci = 0; hci < hc.length; hci++) {
      var hp = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), pillarMat);
      hp.position.set(hc[hci][0], 7 + 4.5, hc[hci][1]);
      registerObstacle(hp);
      addGlowBox(0.5, 0.5, 0.5, hc[hci][0], 16, hc[hci][1], glowMat);
    }

    /* ------------------- 随机掩体 ------------------- */
    var rng = mulberry32(20240607);
    var placed = [];
    var i, t, j;

    // 科技货箱
    for (i = 0; i < 24; i++) {
      var w = 1.6 + rng() * 2.2, d = 1.6 + rng() * 2.2, h = 1.1 + rng() * 1.7;
      var x = 0, z = 0, ok = false;
      for (t = 0; t < 50 && !ok; t++) {
        x = (rng() * 2 - 1) * (ARENA - 8);
        z = (rng() * 2 - 1) * (ARENA - 8);
        if (Math.abs(x) < 46 && Math.abs(z) < 46) continue; // 避开中央建筑群
        ok = true;
        for (j = 0; j < placed.length; j++) {
          var p = placed[j];
          if (Math.abs(p.x - x) < (p.w + w) / 2 + 1.3 &&
              Math.abs(p.z - z) < (p.d + d) / 2 + 1.3) { ok = false; break; }
        }
      }
      if (!ok) continue;
      placed.push({ x: x, z: z, w: w, d: d });
      var crate = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), crateMat);
      crate.position.set(x, h / 2, z);
      registerObstacle(crate);
      addGlowBox(w - 0.3, 0.1, d - 0.3, x, h + 0.08, z, glowMat);
    }

    // 能量屏障(长条低墙)
    for (i = 0; i < 6; i++) {
      var horiz = rng() > 0.5;
      var bw = horiz ? 8 + rng() * 3 : 0.7;
      var bd = horiz ? 0.7 : 8 + rng() * 3;
      var bx = 0, bz = 0, bok = false;
      for (t = 0; t < 50 && !bok; t++) {
        bx = (rng() * 2 - 1) * (ARENA - 12);
        bz = (rng() * 2 - 1) * (ARENA - 12);
        if (Math.abs(bx) < 48 && Math.abs(bz) < 48) continue;
        bok = true;
        for (j = 0; j < placed.length; j++) {
          var q = placed[j];
          if (Math.abs(q.x - bx) < (q.w + bw) / 2 + 1.2 &&
              Math.abs(q.z - bz) < (q.d + bd) / 2 + 1.2) { bok = false; break; }
        }
      }
      if (!bok) continue;
      var bar = new THREE.Mesh(new THREE.BoxGeometry(bw, 1.2, bd), crateMat);
      bar.position.set(bx, 0.6, bz);
      registerObstacle(bar);
      addGlowBox(horiz ? bw - 0.4 : 0.3, 0.1, horiz ? 0.3 : bd - 0.4, bx, 1.28, bz, glowMat);
    }

    // 发光灯柱
    for (i = 0; i < 10; i++) {
      var px2 = 0, pz2 = 0, pok = false;
      for (t = 0; t < 50 && !pok; t++) {
        px2 = (rng() * 2 - 1) * (ARENA - 10);
        pz2 = (rng() * 2 - 1) * (ARENA - 10);
        if (Math.abs(px2) < 48 && Math.abs(pz2) < 48) continue;
        pok = true;
        for (j = 0; j < placed.length; j++) {
          var r2 = placed[j];
          if (Math.abs(r2.x - px2) < (r2.w + 1) / 2 + 1.4 &&
              Math.abs(r2.z - pz2) < (r2.d + 1) / 2 + 1.4) { pok = false; break; }
        }
      }
      if (!pok) continue;
      placed.push({ x: px2, z: pz2, w: 1, d: 1 });
      var pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5, 0.9), pillarMat);
      pil.position.set(px2, 2.5, pz2);
      registerObstacle(pil);
      addGlowBox(0.5, 0.6, 0.5, px2, 5.5, pz2, glowMat);
    }

    // 全息投影柱(装饰,可穿越)
    var holoTex = makeRadialTexture('rgba(120,240,255,0.9)', 'rgba(0,180,255,0)');
    for (i = 0; i < 8; i++) {
      var ha = i / 8 * Math.PI * 2 + 0.4;
      var hr = 55 + (i % 3) * 6;
      var hx = Math.cos(ha) * hr, hz = Math.sin(ha) * hr;
      var holo = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6, 0.35), holoMat);
      holo.position.set(hx, 3, hz);
      scene.add(holo);
      var hsp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: holoTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6
      }));
      hsp.scale.set(1.6, 1.6, 1);
      hsp.position.set(hx, 6.4, hz);
      scene.add(hsp);
    }

    // 四象限实验室建筑
    var bq = [[36, -36], [-36, -36], [36, 36], [-36, 36]];
    for (i = 0; i < bq.length; i++) {
      var bld = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 14), wallMat);
      bld.position.set(bq[i][0], 5, bq[i][1]);
      registerObstacle(bld);
      addGlowBox(12, 0.16, 12, bq[i][0], 10.1, bq[i][1], glowMat);
      addGlowBox(0.5, 3, 0.5, bq[i][0], 12.4, bq[i][1], glowMagMat);
      addGlowBox(13.2, 0.4, 0.5, bq[i][0], 6.5, bq[i][1] - 6.4, glowMat);
      addGlowBox(13.2, 0.4, 0.5, bq[i][0], 6.5, bq[i][1] + 6.4, glowMat);
      addGlowBox(0.5, 0.4, 13.2, bq[i][0] - 6.4, 6.5, bq[i][1], glowMat);
      addGlowBox(0.5, 0.4, 13.2, bq[i][0] + 6.4, 6.5, bq[i][1], glowMat);
    }

    // 场外悬浮岩块(装饰)
    for (i = 0; i < 10; i++) {
      var fa = rng() * Math.PI * 2;
      var fr = 135 + rng() * 60;
      var rock = new THREE.Mesh(new THREE.ConeGeometry(3 + rng() * 5, 6 + rng() * 8, 5), pillarMat);
      rock.position.set(Math.cos(fa) * fr, 20 + rng() * 30, Math.sin(fa) * fr);
      rock.rotation.z = rng() * 0.6 - 0.3;
      scene.add(rock);
    }
    // 远处全息环带(装饰)
    for (i = 0; i < 4; i++) {
      var ra = i / 4 * Math.PI * 2 + 0.7;
      var rr = 150 + i * 12;
      var farRing = new THREE.Mesh(new THREE.TorusGeometry(14, 0.5, 6, 30), holoMat);
      farRing.position.set(Math.cos(ra) * rr, 40 + i * 10, Math.sin(ra) * rr);
      scene.add(farRing);
    }
  }

  /* ------------------------------ 粒子 ------------------------------ */
  var particles = [];
  var holos = [];          // 全息旋转环
  var sparkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  var sparkMats = {
    yellow: new THREE.MeshBasicMaterial({ color: 0xffd75e }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3d5a }),
    gray: new THREE.MeshBasicMaterial({ color: 0x9fb4cc }),
    cyan: new THREE.MeshBasicMaterial({ color: 0x57f0ff }),
    magenta: new THREE.MeshBasicMaterial({ color: 0xff4de3 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff })
  };

  function spawnBurst(pos, colorKey, count, power) {
    for (var i = 0; i < count; i++) {
      if (particles.length > 300) break;
      var mesh = new THREE.Mesh(sparkGeo, sparkMats[colorKey]);
      mesh.position.copy(pos);
      var sc = 0.7 + Math.random() * 1.4;
      mesh.scale.setScalar(sc);
      var vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.4 + 0.4,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar((power || 5) * (0.5 + Math.random()));
      scene.add(mesh);
      particles.push({ mesh: mesh, vel: vel, life: 0.5 + Math.random() * 0.35, maxLife: 0.85, scale: sc });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); continue; }
      p.vel.y -= 16 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.04) {
        p.mesh.position.y = 0.04;
        p.vel.y *= -0.35; p.vel.x *= 0.7; p.vel.z *= 0.7;
      }
      p.mesh.scale.setScalar(p.scale * Math.max(0.15, p.life / p.maxLife));
    }
  }

  /* ------------------------------ 弹道 ------------------------------ */
  var tracers = [];
  var tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  var tracerMat = new THREE.MeshBasicMaterial({ color: 0x6ff0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });

  function spawnTracer(from, to) {
    var dir = to.clone().sub(from);
    var len = dir.length();
    if (len < 0.01) return;
    var mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.lookAt(to);
    mesh.scale.z = len;
    scene.add(mesh);
    tracers.push({ mesh: mesh, life: 0.07 });
  }

  function updateTracers(dt) {
    for (var i = tracers.length - 1; i >= 0; i--) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) { scene.remove(tracers[i].mesh); tracers.splice(i, 1); }
    }
  }

  /* --------------------------- 敌人子弹 --------------------------- */
  var enemyBullets = [];
  var enemyBulletGeo = new THREE.SphereGeometry(0.09, 8, 8);
  var enemyBulletMat = new THREE.MeshBasicMaterial({ color: 0xff4d6a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });

  function updateEnemyBullets(dt) {
    for (var i = enemyBullets.length - 1; i >= 0; i--) {
      var b = enemyBullets[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      var dead = b.life <= 0;
      if (!dead && circleHitsCollider(b.mesh.position, 0.1)) {
        dead = true;
        spawnBurst(b.mesh.position, 'cyan', 4, 3);
      }
      if (!dead && b.mesh.position.distanceTo(camera.position) < 0.55) {
        dead = true;
        damagePlayer(b.dmg);
        spawnBurst(b.mesh.position, 'red', 8, 4);
      }
      if (dead) { scene.remove(b.mesh); enemyBullets.splice(i, 1); }
    }
  }

  /* ---------------------------- 战利品 ---------------------------- */
  var lootItems = [];
  var lootBoxGeo = new THREE.BoxGeometry(0.3, 0.22, 0.3);
  var lootAmmoMat = new THREE.MeshLambertMaterial({ color: 0x0e2a38, emissive: 0x00c8ff });
  var lootHealthMat = new THREE.MeshLambertMaterial({ color: 0x0c2a1c, emissive: 0x00e07a });
  var ammoGlowTex = makeRadialTexture('rgba(120,240,255,1)', 'rgba(0,180,255,0)');
  var healthGlowTex = makeRadialTexture('rgba(120,255,190,1)', 'rgba(40,220,110,0)');

  function spawnLoot(x, z, type, refY) {
    var group = new THREE.Group();
    var box = new THREE.Mesh(lootBoxGeo, type === 'ammo' ? lootAmmoMat : lootHealthMat);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: type === 'ammo' ? ammoGlowTex : healthGlowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.85
    }));
    glow.scale.set(0.7, 0.7, 1);
    glow.position.y = -0.18;
    var letter = makeTextSprite(type === 'ammo' ? '弹' : '血', type === 'ammo' ? '#6ff0ff' : '#6dff9e');
    letter.scale.set(0.34, 0.34, 1);
    letter.position.y = 0.3;
    group.add(box);
    group.add(glow);
    group.add(letter);
    var landY = groundHeightAt(x, z, refY);
    group.position.set(x, landY + 1.1, z);
    scene.add(group);
    lootItems.push({
      group: group,
      type: type,
      vy: 2.6,
      grounded: false,
      baseY: landY + 0.3,
      life: 25,
      phase: Math.random() * Math.PI * 2,
      magnet: null
    });
  }

  // 敌人死亡掉落:85% 能量电池(+15~25 子弹),22% 纳米医疗包(+25 生命)
  function dropLoot(x, z, refY) {
    var ox = (Math.random() - 0.5) * 0.9;
    var oz = (Math.random() - 0.5) * 0.9;
    if (Math.random() < 0.85) spawnLoot(x + ox, z + oz, 'ammo', refY);
    if (Math.random() < 0.22) spawnLoot(x - ox, z - oz, 'health', refY);
  }

  function showPickupMsg(text, color) {
    pickupMsgEl.textContent = text;
    pickupMsgEl.style.color = color || '#ffd75e';
    pickupMsgEl.classList.add('show');
    clearTimeout(pickupMsgTimer);
    pickupMsgTimer = setTimeout(function () { pickupMsgEl.classList.remove('show'); }, 1200);
  }

  function collectLoot(l) {
    scene.remove(l.group);
    if (l.type === 'ammo') {
      var amt = 15 + Math.floor(Math.random() * 11);
      player.reserve = Math.min(999, player.reserve + amt);
      showPickupMsg('+' + amt + ' 子弹', '#ffd75e');
      AudioFX.ammoPickup();
    } else {
      player.health = Math.min(100, player.health + 25);
      showPickupMsg('+25 生命', '#8dffb0');
      AudioFX.healthPickup();
    }
    updateHUD();
  }

  function updateLoot(dt) {
    for (var i = lootItems.length - 1; i >= 0; i--) {
      var l = lootItems[i];
      l.life -= dt;
      if (l.life <= 0) {
        scene.remove(l.group);
        lootItems.splice(i, 1);
        continue;
      }
      // 到期前闪烁提示
      if (l.life < 3) {
        l.group.visible = (Math.floor(l.life * 6) % 2 === 0);
      } else {
        l.group.visible = true;
      }
      // 下落
      if (!l.grounded) {
        l.vy -= 22 * dt;
        l.group.position.y += l.vy * dt;
        if (l.group.position.y <= l.baseY) {
          l.group.position.y = l.baseY;
          l.grounded = true;
        }
      } else {
        l.group.rotation.y += dt * 2.2;
        l.group.position.y = l.baseY + Math.sin(gameTime * 2.4 + l.phase) * 0.07;
      }
      // 吸附拾取
      if (l.magnet) {
        var dir = l.magnet.clone().sub(l.group.position);
        var d = dir.length();
        if (d < 0.6) {
          collectLoot(l);
          lootItems.splice(i, 1);
          continue;
        }
        dir.normalize();
        l.group.position.addScaledVector(dir, 14 * dt);
      } else {
        var dx = player.pos.x - l.group.position.x;
        var dz = player.pos.z - l.group.position.z;
        if (dx * dx + dz * dz < 1.4 * 1.4) {
          l.magnet = player.pos.clone();
        }
      }
    }
  }

  /* --------------------------- 玩家武器 --------------------------- */
  var gunGroup, muzzleTip, flashSprite, flashLight, gunCoreMat;
  var GUN_X = 0.3, GUN_Y = -0.26, GUN_Z = -0.5;

  function buildGun() {
    gunGroup = new THREE.Group();
    var darkMat = new THREE.MeshLambertMaterial({ color: 0x14181f });
    var metalMat = new THREE.MeshLambertMaterial({ color: 0x2b3442 });
    gunCoreMat = new THREE.MeshLambertMaterial({ color: 0x0a2430, emissive: 0x00d8ff });
    var ringGeo = new THREE.TorusGeometry(0.045, 0.011, 6, 14);

    var body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.44), metalMat);
    var rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.34), darkMat);
    rail.position.set(0, 0.08, -0.02);
    var barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), darkMat);
    barrel.position.set(0, 0.02, -0.42);
    var ring1 = new THREE.Mesh(ringGeo, gunCoreMat);
    ring1.position.set(0, 0.02, -0.24);
    ring1.rotation.x = Math.PI / 2;
    var ring2 = new THREE.Mesh(ringGeo, gunCoreMat);
    ring2.position.set(0, 0.02, -0.38);
    ring2.rotation.x = Math.PI / 2;
    var ring3 = new THREE.Mesh(ringGeo, gunCoreMat);
    ring3.position.set(0, 0.02, -0.52);
    ring3.rotation.x = Math.PI / 2;
    var core = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), gunCoreMat);
    core.position.set(0, 0.0, -0.12);
    var grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.09), darkMat);
    grip.position.set(0, -0.12, 0.12);
    grip.rotation.x = 0.3;
    var stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.16), metalMat);
    stock.position.set(0, -0.01, 0.26);
    var finL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.2), gunCoreMat);
    finL.position.set(-0.055, 0.0, -0.08);
    var finR = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.2), gunCoreMat);
    finR.position.set(0.055, 0.0, -0.08);

    muzzleTip = new THREE.Object3D();
    muzzleTip.position.set(0, 0.02, -0.68);

    gunGroup.add(body);
    gunGroup.add(rail);
    gunGroup.add(barrel);
    gunGroup.add(ring1);
    gunGroup.add(ring2);
    gunGroup.add(ring3);
    gunGroup.add(core);
    gunGroup.add(grip);
    gunGroup.add(stock);
    gunGroup.add(finL);
    gunGroup.add(finR);
    gunGroup.add(muzzleTip);
    gunGroup.position.set(GUN_X, GUN_Y, GUN_Z);
    camera.add(gunGroup);

    // 枪口等离子闪光
    flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRadialTexture('rgba(190,250,255,1)', 'rgba(0,200,255,0)'),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true
    }));
    flashSprite.scale.set(0.26, 0.26, 1);
    flashSprite.visible = false;
    muzzleTip.add(flashSprite);

    flashLight = new THREE.PointLight(0x55e8ff, 0, 12, 2);
    flashLight.position.set(0.32, -0.18, -0.9);
    camera.add(flashLight);
  }

  /* --------------------------- 玩家状态 --------------------------- */
  var player = {
    pos: new THREE.Vector3(0, 0, 10),
    vel: new THREE.Vector3(),
    vy: 0,
    grounded: true,
    yaw: 0,
    pitch: 0,
    health: 100,
    ammo: MAG_SIZE,
    reserve: RESERVE
  };

  var raycaster = new THREE.Raycaster();
  var losRay = new THREE.Raycaster();
  var centerNdc = new THREE.Vector2(0, 0);

  /* ------------------------------ 敌人 ------------------------------ */
  class Enemy {
    constructor(spawn, kind) {
      this.cfg = LEVELS[currentLevel];
      this.kind = kind || 'gunner';          // 'gunner' 远程枪手 | 'rusher' 近战猎杀者
      this.speedMult = this.kind === 'rusher' ? RUSHER.speedMult : 1;
      this.pos = spawn.clone();
      this.pos.y = groundHeightAt(this.pos.x, this.pos.z, 0);
      this.radius = 0.45;
      this.phase = Math.random() * Math.PI * 2;
      this.health = this.kind === 'rusher' ? RUSHER.hp
        : this.kind === 'soldier' ? Math.round(this.cfg.hp * SOLDIER.hpMult)
        : this.cfg.hp;
      this.alive = true;
      // 第一时间追踪攻击:出生即进入追击状态,始终掌握玩家位置
      this.state = 'chase';
      this.speed = this.cfg.speed * this.speedMult;
      this.facing = 0;
      this.moving = false;
      this.walkT = 0;
      this.patrolTarget = null;
      this.idleTimer = 0;
      this.stuckT = 0;
      this.stuckRef = this.pos.clone();
      this.shootTimer = 0.8 + Math.random();
      this.lostSight = 0;
      this.lastSeen = new THREE.Vector3(player.pos.x, 0, player.pos.z);
      this.alertTimer = 1;
      this.hitFlash = 0;
      this.respawnTimer = 0;
      this.meleeTimer = 0;                   // 近战攻击冷却
      this.lungeT = 0;                       // 突刺动画计时
      this.lungeHit = false;                 // 本次突刺是否已判定伤害
      this.buildModel();
      this.newPatrolTarget();
    }

    buildModel() {
      if (this.kind === 'rusher') { this.buildRusherModel(); return; }
      if (this.kind === 'soldier') { this.buildSoldierModel(); return; }
      var g = new THREE.Group();
      var armorMat = new THREE.MeshLambertMaterial({ color: 0x4a6a8a, emissive: 0x0a1626 });   // 枪手:亮钢蓝(高可视)
      var armor2Mat = new THREE.MeshLambertMaterial({ color: 0x2a4058 });
      this.coreMat = new THREE.MeshLambertMaterial({ color: 0x06202a, emissive: 0x22e6ff });
      var visorMat = new THREE.MeshLambertMaterial({ color: 0x1a0508, emissive: 0xff2040 });
      this.bulletMat = new THREE.MeshBasicMaterial({ color: 0x66f0ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });

      // 悬浮环(反重力推进)
      var hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 18), armor2Mat);
      hoverRing.position.set(0, 0.38, 0);
      hoverRing.rotation.x = Math.PI / 2;
      // 底部推进光焰
      var thrusterTex = makeRadialTexture('rgba(120,240,255,1)', 'rgba(0,160,255,0)');
      this.thruster = new THREE.Sprite(new THREE.SpriteMaterial({
        map: thrusterTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55
      }));
      this.thruster.scale.set(0.62, 0.62, 1);
      this.thruster.position.set(0, 0.1, 0);

      // 加大的躯干与头部:头部位于"水平瞄准略偏上"的高度,容易爆头
      var torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.4), armorMat);
      torso.position.set(0, 1.15, 0);
      var chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.08), this.coreMat);
      chestCore.position.set(0, 1.25, 0.24);
      var shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.26), armor2Mat);
      shoulderL.position.set(-0.41, 1.42, 0);
      var shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.26), armor2Mat);
      shoulderR.position.set(0.41, 1.42, 0);

      var head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.32), armorMat);
      head.position.set(0, 1.72, 0.03);
      head.userData.head = true;
      var visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), visorMat);
      visor.position.set(0, 1.73, 0.21);
      head.add(visor);
      var antenna = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), armor2Mat);
      antenna.position.set(0, 1.96, 0);
      var antennaTip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.09), this.coreMat);
      antennaTip.position.set(0, 2.07, 0);

      // 双臂等离子炮
      var armGeo = new THREE.BoxGeometry(0.15, 0.18, 0.42);
      var armL = new THREE.Mesh(armGeo, armorMat);
      armL.position.set(-0.38, 1.38, 0.18);
      armL.rotation.x = -0.25;
      var armR = new THREE.Mesh(armGeo, armorMat);
      armR.position.set(0.38, 1.38, 0.18);
      armR.rotation.x = -0.25;
      var tipL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.coreMat);
      tipL.position.set(-0.38, 1.34, 0.42);
      var tipR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.coreMat);
      tipR.position.set(0.38, 1.34, 0.42);

      var self = this;
      var parts = [torso, chestCore, shoulderL, shoulderR, armL, armR, antenna, antennaTip, tipL, tipR];
      parts.forEach(function (m) { m.castShadow = true; m.userData.enemy = self; g.add(m); });
      head.castShadow = true;
      head.userData.enemy = self;
      g.add(head);
      g.add(hoverRing);
      g.add(this.thruster);

      this.alertSprite = makeTextSprite('!', '#ff4d6a');
      this.alertSprite.position.set(0, 2.55, 0);
      this.alertSprite.scale.set(0.55, 0.55, 1);
      this.alertSprite.visible = false;
      g.add(this.alertSprite);

      this.group = g;
      this.meshes = parts.concat([head]);
      this.mats = [armorMat, armor2Mat];
      scene.add(g);
    }

    // 猎杀者:低矮流线型近战机体,双刃 + 品红核心
    buildRusherModel() {
      var g = new THREE.Group();
      var armorMat = new THREE.MeshLambertMaterial({ color: 0x8a3a78, emissive: 0x1a0a1e });   // 猎杀者:亮品红(高可视)
      var armor2Mat = new THREE.MeshLambertMaterial({ color: 0x5a2850 });
      this.coreMat = new THREE.MeshLambertMaterial({ color: 0x2a062a, emissive: 0xff5de8 });
      var visorMat = new THREE.MeshLambertMaterial({ color: 0x1a0508, emissive: 0xff2040 });

      var hoverRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 8, 16), armor2Mat);
      hoverRing.position.set(0, 0.32, 0);
      hoverRing.rotation.x = Math.PI / 2;
      var thrusterTex = makeRadialTexture('rgba(255,120,235,1)', 'rgba(220,0,180,0)');
      this.thruster = new THREE.Sprite(new THREE.SpriteMaterial({
        map: thrusterTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55
      }));
      this.thruster.scale.set(0.55, 0.55, 1);
      this.thruster.position.set(0, 0.1, 0);

      // 加大的低矮机体:头部抬高,便于爆头
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.85), armorMat);
      body.position.set(0, 0.78, 0);
      var chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), this.coreMat);
      chestCore.position.set(0, 0.86, 0.42);
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), armorMat);
      head.position.set(0, 1.2, 0.18);
      head.userData.head = true;
      var visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), visorMat);
      visor.position.set(0, 1.21, 0.35);
      head.add(visor);
      // 前臂双刃
      var bladeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.7);
      var bladeL = new THREE.Mesh(bladeGeo, armor2Mat);
      bladeL.position.set(-0.35, 0.9, 0.55);
      bladeL.rotation.x = -0.35;
      var bladeR = new THREE.Mesh(bladeGeo, armor2Mat);
      bladeR.position.set(0.35, 0.9, 0.55);
      bladeR.rotation.x = -0.35;
      // 尾部稳定翼
      var tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.4), armor2Mat);
      tail.position.set(0, 0.76, -0.56);
      // 天线
      var antenna = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.04), armor2Mat);
      antenna.position.set(0, 1.38, 0);
      var antennaTip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), this.coreMat);
      antennaTip.position.set(0, 1.47, 0);

      var self = this;
      var parts = [body, chestCore, bladeL, bladeR, tail, antenna, antennaTip];
      parts.forEach(function (m) { m.castShadow = true; m.userData.enemy = self; g.add(m); });
      head.castShadow = true;
      head.userData.enemy = self;
      g.add(head);
      g.add(hoverRing);
      g.add(this.thruster);

      this.alertSprite = makeTextSprite('!', '#ff4d6a');
      this.alertSprite.position.set(0, 1.95, 0);
      this.alertSprite.scale.set(0.5, 0.5, 1);
      this.alertSprite.visible = false;
      g.add(this.alertSprite);

      this.group = g;
      this.meshes = parts.concat([head]);
      this.mats = [armorMat, armor2Mat];
      scene.add(g);
    }

    // 未来士兵:人形作战单位,装甲防具 + 未来步枪
    buildSoldierModel() {
      var g = new THREE.Group();
      var armorMat = new THREE.MeshLambertMaterial({ color: 0x9a6428, emissive: 0x1e1206 });   // 未来士兵:亮琥珀橙(高可视)
      var armor2Mat = new THREE.MeshLambertMaterial({ color: 0x6a4420 });
      this.coreMat = new THREE.MeshLambertMaterial({ color: 0x1e1206, emissive: 0xffa020 });
      var visorMat = new THREE.MeshLambertMaterial({ color: 0x1a0508, emissive: 0xff2040 });
      this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });

      // 双腿(行走摆动)
      var legGeo = new THREE.BoxGeometry(0.18, 0.7, 0.22);
      this.legL = new THREE.Mesh(legGeo, armor2Mat);
      this.legL.position.set(-0.17, 0.35, 0);
      this.legR = new THREE.Mesh(legGeo, armor2Mat);
      this.legR.position.set(0.17, 0.35, 0);

      // 装甲躯干 + 胸甲 + 发光能量条
      var torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.32), armorMat);
      torso.position.set(0, 1.0, 0);
      var chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.24, 0.36), armor2Mat);
      chestPlate.position.set(0, 1.12, 0);
      var chestGlow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.05), this.coreMat);
      chestGlow.position.set(0, 1.12, 0.2);
      // 肩甲
      var shoulderGeo = new THREE.BoxGeometry(0.16, 0.16, 0.24);
      var shoulderL = new THREE.Mesh(shoulderGeo, armor2Mat);
      shoulderL.position.set(-0.34, 1.3, 0);
      var shoulderR = new THREE.Mesh(shoulderGeo, armor2Mat);
      shoulderR.position.set(0.34, 1.3, 0);

      // 头盔(爆头判定)
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.3), armorMat);
      head.position.set(0, 1.62, 0.02);
      head.userData.head = true;
      var visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), visorMat);
      visor.position.set(0, 1.63, 0.19);
      head.add(visor);
      var antenna = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), armor2Mat);
      antenna.position.set(0, 1.82, 0);

      // 左臂(行走摆动)
      this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), armorMat);
      this.armL.position.set(-0.4, 1.1, 0);
      // 右臂持未来步枪(枪架可俯仰,呈现点射间的预备/换弹姿态)
      this.riflePivot = new THREE.Group();
      this.riflePivot.position.set(0.42, 1.2, 0.16);
      var armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.16), armorMat);
      armR.position.set(0, -0.18, -0.02);
      var rifle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), armor2Mat);
      rifle.position.set(0, 0, 0.32);
      var barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.34), armorMat);
      barrel.position.set(0, 0, 0.62);
      var muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), this.coreMat);
      muzzle.position.set(0, 0, 0.8);
      var scope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.14), armor2Mat);
      scope.position.set(0, 0.09, 0.3);
      var cell = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.16), this.coreMat);
      cell.position.set(0.06, -0.02, 0.2);
      this.riflePivot.add(armR);
      this.riflePivot.add(rifle);
      this.riflePivot.add(barrel);
      this.riflePivot.add(muzzle);
      this.riflePivot.add(scope);
      this.riflePivot.add(cell);

      var self = this;
      var parts = [this.legL, this.legR, torso, chestPlate, chestGlow, shoulderL, shoulderR, antenna, this.armL];
      parts.forEach(function (m) { m.castShadow = true; m.userData.enemy = self; g.add(m); });
      head.castShadow = true;
      head.userData.enemy = self;
      g.add(head);
      g.add(this.riflePivot);

      this.alertSprite = makeTextSprite('!', '#ff4d6a');
      this.alertSprite.position.set(0, 2.4, 0);
      this.alertSprite.scale.set(0.55, 0.55, 1);
      this.alertSprite.visible = false;
      g.add(this.alertSprite);

      this.group = g;
      this.meshes = parts.concat([head]);
      this.mats = [armorMat, armor2Mat];
      scene.add(g);
    }

    get eyePos() {
      return new THREE.Vector3(this.pos.x, this.pos.y + (this.kind === 'rusher' ? 1.25 : this.kind === 'soldier' ? 1.65 : 1.75), this.pos.z);
    }

    hasLOS() {
      var from = this.eyePos;
      var to = camera.position;
      var dir = to.clone().sub(from);
      var dist = dir.length();
      dir.normalize();
      losRay.set(from, dir);
      var hits = losRay.intersectObjects(obstacleMeshes, false);
      return hits.length === 0 || hits[0].distance > dist - 0.3;
    }

    newPatrolTarget(near) {
      for (var i = 0; i < 40; i++) {
        var x, z;
        var useNear = near && Math.random() < 0.7;
        if (useNear) {
          x = near.x + (Math.random() * 2 - 1) * 14;
          z = near.z + (Math.random() * 2 - 1) * 14;
        } else {
          var r = Math.random();
          if (r < 0.5) {
            // 围绕玩家当前位置巡逻,保证大图上仍有战斗密度
            x = player.pos.x + (Math.random() * 2 - 1) * 45;
            z = player.pos.z + (Math.random() * 2 - 1) * 45;
          } else if (r < 0.75) {
            // 战场中心区域
            x = (Math.random() * 2 - 1) * 40;
            z = (Math.random() * 2 - 1) * 40;
          } else {
            x = (Math.random() * 2 - 1) * (ARENA - 4);
            z = (Math.random() * 2 - 1) * (ARENA - 4);
          }
        }
        if (!circleHitsCollider(new THREE.Vector3(x, 0, z), 1.2)) {
          this.patrolTarget = new THREE.Vector3(x, 0, z);
          this.stuckT = 0;
          this.stuckRef.copy(this.pos);
          return this.patrolTarget;
        }
      }
      this.patrolTarget = near ? near.clone() : new THREE.Vector3(
        (Math.random() * 2 - 1) * (ARENA - 4), 0, (Math.random() * 2 - 1) * (ARENA - 4));
      this.stuckT = 0;
      this.stuckRef.copy(this.pos);
      return this.patrolTarget;
    }

    moveToward(x, z, speed, dt) {
      var dx = x - this.pos.x, dz = z - this.pos.z;
      var d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      var step = Math.min(Math.abs(speed) * dt, d);
      var s = speed >= 0 ? 1 : -1;
      this.facing = Math.atan2(dx, dz);
      this.pos.x += (dx / d) * step * s;
      resolveCircle(this.pos, this.radius);
      this.pos.z += (dz / d) * step * s;
      resolveCircle(this.pos, this.radius);
      this.moving = true;
    }

    enterChase() {
      if (this.state === 'chase' || this.state === 'attack') return;
      this.state = 'chase';
      this.speed = this.cfg.speed * this.speedMult;
      this.alertTimer = 1;
      this.lostSight = 0;
      this.lastSeen.copy(player.pos);
    }

    updatePatrol(dt, toPlayer) {
      if (toPlayer < this.cfg.detect && this.hasLOS()) { this.enterChase(); return; }
      if (!this.patrolTarget) this.newPatrolTarget();
      if (this.idleTimer > 0) { this.idleTimer -= dt; return; }
      var t = this.patrolTarget;
      var d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
      if (d < 1.2) {
        this.idleTimer = 0.5 + Math.random() * 1.6;
        this.patrolTarget = null;
        return;
      }
      this.moveToward(t.x, t.z, this.speed, dt);
      this.stuckT += dt;
      if (this.stuckT > 0.8) {
        if (Math.hypot(this.pos.x - this.stuckRef.x, this.pos.z - this.stuckRef.z) < 0.4) {
          this.newPatrolTarget();
        }
        this.stuckRef.copy(this.pos);
        this.stuckT = 0;
      }
    }

    updateChase(dt, toPlayer) {
      // 始终掌握玩家位置,永不脱战、永不放弃
      this.lastSeen.copy(player.pos);
      // 猎杀者近战攻击距离近,贴近后再切换攻击
      var attackRange = this.kind === 'rusher' ? RUSHER.chaseRange : 15;
      if (toPlayer < attackRange && this.hasLOS()) {
        this.state = 'attack';
        this.shootTimer = 0.35 + Math.random() * 0.5;
        return;
      }
      this.moveToward(this.lastSeen.x, this.lastSeen.z, this.speed, dt);
      // 追击被墙卡住时,改为绕向玩家附近(兼容多层平台)
      this.stuckT += dt;
      if (this.stuckT > 0.7) {
        if (Math.hypot(this.pos.x - this.stuckRef.x, this.pos.z - this.stuckRef.z) < 0.35) {
          this.patrolTarget = this.newPatrolTarget(this.lastSeen);
          this.state = 'patrol';
          this.speed = this.cfg.speed * 0.6 * this.speedMult;
        }
        this.stuckRef.copy(this.pos);
        this.stuckT = 0;
      }
    }

    updateAttack(dt, toPlayer) {
      this.facing = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      // 丢失视线超过 1.2 秒则继续追击逼近,直到能看到玩家
      if (this.hasLOS()) {
        this.lostSight = 0;
        this.lastSeen.copy(player.pos);
      } else {
        this.lostSight += dt;
        if (this.lostSight > 1.2) { this.state = 'chase'; return; }
      }
      if (toPlayer > 17) { this.state = 'chase'; return; }
      if (this.kind === 'rusher') {
        // —— 猎杀者:近战突刺,不发射子弹 ——
        if (toPlayer > 6) { this.state = 'chase'; return; }
        if (toPlayer > 1.15) this.moveToward(player.pos.x, player.pos.z, this.speed * 1.2, dt);
        this.meleeTimer -= dt;
        if (this.meleeTimer <= 0) {
          if (toPlayer < RUSHER.strikeRange) {
            this.meleeTimer = RUSHER.cooldown;
            this.lungeT = RUSHER.lungeTime;
            this.lungeHit = false;
            AudioFX.melee();
          } else {
            this.meleeTimer = 0.2;   // 还未贴近,稍后再试
          }
        }
        return;
      }
      if (toPlayer < 9) this.moveToward(player.pos.x, player.pos.z, -1.6, dt);
      this.shootTimer -= dt;
      if (this.shootTimer <= 0 && this.hasLOS()) {
        this.shootTimer = this.cfg.fireMin + Math.random() * (this.cfg.fireMax - this.cfg.fireMin);
        this.fireBullet();
      }
    }

    fireBullet() {
      var from = new THREE.Vector3(
        this.pos.x + Math.sin(this.facing) * 0.6,
        this.pos.y + (this.kind === 'soldier' ? 1.25 : 1.45),
        this.pos.z + Math.cos(this.facing) * 0.6
      );
      // 未来士兵三连发点射(单发伤害均分,总伤害与枪手相当)
      var burstN = this.kind === 'soldier' ? SOLDIER.burst : 1;
      for (var k = 0; k < burstN; k++) {
        var to = new THREE.Vector3(
          player.pos.x + (Math.random() - 0.5) * 0.9,
          player.pos.y + 1.6 + (Math.random() - 0.5) * 0.7,
          player.pos.z + (Math.random() - 0.5) * 0.9
        );
        var vel = to.sub(from).normalize().multiplyScalar(this.cfg.bulletSpeed);
        var mesh = new THREE.Mesh(enemyBulletGeo, this.bulletMat);
        mesh.position.copy(from);
        scene.add(mesh);
        enemyBullets.push({
          mesh: mesh, vel: vel, life: 4,
          dmg: (this.cfg.dmgMin + Math.random() * (this.cfg.dmgMax - this.cfg.dmgMin)) / burstN
        });
      }
      AudioFX.enemyShoot();
    }

    takeDamage(dmg, point, isHead) {
      if (!this.alive) return false;
      this.health -= dmg;
      this.hitFlash = 1;
      spawnBurst(point, 'cyan', 5, 4);
      if (this.health <= 0) {
        this.die(isHead);
        return true;
      }
      AudioFX.enemyHit();
      if (this.state === 'patrol') this.enterChase();
      return false;
    }

    die(isHead) {
      this.alive = false;
      this.state = 'dead';
      this.respawnTimer = this.cfg.respawnMin + Math.random() * (this.cfg.respawnMax - this.cfg.respawnMin);
      this.group.visible = false;
      score += isHead ? 150 : 100;
      kills++;
      levelKills++;
      var bx = this.pos.x, bz = this.pos.z;
      var boomPos = new THREE.Vector3(bx, this.pos.y + (this.kind === 'rusher' ? 0.9 : 1.2), bz);
      spawnBurst(boomPos, 'cyan', 16, 7);
      spawnBurst(boomPos, 'magenta', 10, 5);
      spawnBurst(boomPos, 'white', 6, 4);
      // 能量冲击波(扩散圆环)
      var shock = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24),
        new THREE.MeshBasicMaterial({ color: 0x57f0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
      );
      shock.position.set(bx, this.pos.y + 0.5, bz);
      scene.add(shock);
      shockwaves.push({ mesh: shock, life: 0.4, maxLife: 0.4 });
      AudioFX.kill();
      dropLoot(bx, bz, this.pos.y);
      updateHUD();
      // 达到击杀配额后召唤 Boss
      if (levelKills >= this.cfg.quota && !boss) spawnBoss();
    }

    respawn() {
      var p = findSpawnPoint(16, 5, 70);
      this.pos.copy(p);
      this.pos.y = groundHeightAt(this.pos.x, this.pos.z, 0);
      this.health = this.kind === 'rusher' ? RUSHER.hp
        : this.kind === 'soldier' ? Math.round(this.cfg.hp * SOLDIER.hpMult)
        : this.cfg.hp;
      this.alive = true;
      // 重生后第一时间继续追击玩家
      this.state = 'chase';
      this.speed = this.cfg.speed * this.speedMult;
      this.patrolTarget = null;
      this.idleTimer = 0;
      this.hitFlash = 0;
      this.lostSight = 0;
      this.lastSeen.set(player.pos.x, 0, player.pos.z);
      this.alertTimer = 1;
      this.shootTimer = 1 + Math.random();
      this.meleeTimer = 0;
      this.lungeT = 0;
      this.lungeHit = false;
      this.group.visible = true;
      for (var i = 0; i < this.mats.length; i++) this.mats[i].emissive.setRGB(0, 0, 0);
      this.newPatrolTarget();
      updateHUD();
    }

    update(dt) {
      if (!this.alive) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) this.respawn();
        return;
      }
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      var f = this.hitFlash;
      for (var i = 0; i < this.mats.length; i++) {
        this.mats[i].emissive.setRGB(f * 0.8, f * 0.15, f * 0.15);
      }
      this.alertTimer = Math.max(0, this.alertTimer - dt);
      this.alertSprite.visible = this.alertTimer > 0;
      if (this.alertSprite.visible) {
        this.alertSprite.position.y = 2.3 + Math.sin(gameTime * 6) * 0.08;
      }

      var toPlayer = Math.hypot(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
      this.moving = false;
      if (this.state === 'patrol') this.updatePatrol(dt, toPlayer);
      else if (this.state === 'chase') this.updateChase(dt, toPlayer);
      else if (this.state === 'attack') this.updateAttack(dt, toPlayer);

      // 贴地悬浮:跟随坡道/平台高度(低于表面则视为在桥底/坡下,不传送上坡)
      var ty = groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
      this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 12);

      // 核心指示灯:枪手青/红,猎杀者品红/亮红
      var alerted = (this.state === 'chase' || this.state === 'attack') ? 1 : 0;
      var pulse = 0.55 + 0.45 * Math.sin(gameTime * 8 + this.phase);
      if (this.kind === 'rusher') {
        this.coreMat.emissive.setRGB(
          pulse * (0.4 + 0.6 * alerted),
          pulse * 0.15,
          pulse * (0.95 - 0.85 * alerted)
        );
      } else {
        this.coreMat.emissive.setRGB(
          0.7 * pulse + 0.9 * alerted,
          0.9 * pulse * (1 - alerted),
          1.0 * pulse * (1 - alerted)
        );
      }

      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.group.rotation.y = this.facing;
      if (this.moving) {
        this.walkT += dt * (this.state === 'chase' ? (this.kind === 'rusher' ? 16 : 12) : (this.kind === 'rusher' ? 10 : 8));
      }
      if (this.kind === 'soldier') {
        // 未来士兵:双腿行走摆动 + 持枪预备姿态
        this.group.position.y += Math.abs(Math.sin(this.walkT)) * 0.06;
        var swing = Math.sin(this.walkT) * (this.moving ? 0.5 : 0);
        this.legL.rotation.x = swing;
        this.legR.rotation.x = -swing;
        this.armL.rotation.x = -swing * 0.7;
        // 点射间隙步枪下沉(预备/换弹姿态)
        var rd = this.shootTimer < 0.45 ? 0.3 : 0;
        this.riflePivot.rotation.x = -0.1 + rd;
      } else if (this.kind === 'rusher') {
        // 猎杀者:贴地俯冲姿态
        this.group.position.y += Math.abs(Math.sin(this.walkT)) * 0.1;
        this.group.rotation.x = this.moving ? -0.16 : 0;
      } else {
        this.group.position.y += Math.abs(Math.sin(this.walkT)) * 0.07;
        this.group.rotation.z = Math.sin(this.walkT) * 0.04;
      }
      if (this.thruster) {
        this.thruster.material.opacity = 0.35 + Math.abs(Math.sin(gameTime * 6 + this.walkT)) * 0.35;
      }

      // 近战突刺动画与命中判定(突刺中段判定伤害,玩家后退可躲开)
      if (this.lungeT > 0) {
        var prevLunge = this.lungeT;
        this.lungeT -= dt;
        var lp = Math.sin((1 - this.lungeT / RUSHER.lungeTime) * Math.PI);
        this.group.position.x += Math.sin(this.facing) * lp * 0.45;
        this.group.position.z += Math.cos(this.facing) * lp * 0.45;
        if (!this.lungeHit && prevLunge >= RUSHER.lungeTime * 0.5 && this.lungeT < RUSHER.lungeTime * 0.5) {
          this.lungeHit = true;
          var strikeDist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
          // 突刺命中必须与玩家之间有视线:高台顶板/侧墙会挡住下方近战兵的突刺
          if (strikeDist < 2.3 && this.hasLOS()) damagePlayer(RUSHER.dmg);
        }
      }
    }
  }

  /* ------------------------------ Boss 小圆咪 ------------------------------ */
  // 独立建模的巨型战斗机甲:数倍体积、十数倍血量、多管齐射强火力
  var bossBulletGeo = new THREE.SphereGeometry(0.16, 10, 10);
  var bossBulletMat = new THREE.MeshBasicMaterial({ color: 0xff5d3d, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending });

  class Boss {
    constructor(spawn) {
      this.cfg = LEVELS[currentLevel];
      this.kind = 'boss';
      this.isBoss = true;
      this.pos = spawn.clone();
      this.pos.y = groundHeightAt(this.pos.x, this.pos.z, 999);
      this.radius = BOSS.radius;
      this.maxHealth = Math.round(this.cfg.hp * BOSS.hpMult);
      this.health = this.maxHealth;
      this.alive = true;
      // Boss 同样第一时间追踪攻击玩家
      this.state = 'chase';
      this.speed = BOSS.speed;
      this.facing = 0;
      this.moving = false;
      this.walkT = 0;
      this.patrolTarget = null;
      this.idleTimer = 0;
      this.stuckT = 0;
      this.stuckRef = this.pos.clone();
      this.shootTimer = 1.5;
      this.lostSight = 0;
      this.lastSeen = new THREE.Vector3(player.pos.x, 0, player.pos.z);
      this.alertTimer = 1;
      this.hitFlash = 0;
      this.phase = Math.random() * Math.PI * 2;
      this.buildModel();
      this.newPatrolTarget();
    }

    buildModel() {
      var g = new THREE.Group();
      var armorMat = new THREE.MeshLambertMaterial({ color: 0x2e3d55, emissive: 0x080d16 });   // Boss:暗钢蓝(顶部有指示光标)
      var armor2Mat = new THREE.MeshLambertMaterial({ color: 0x1c2638 });
      this.coreMat = new THREE.MeshLambertMaterial({ color: 0x0a2028, emissive: 0x00e0ff });
      var visorMat = new THREE.MeshLambertMaterial({ color: 0x20050a, emissive: 0xff2038 });

      // 巨型反重力环
      var hoverRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.16, 10, 24), armor2Mat);
      hoverRing.position.set(0, 0.5, 0);
      hoverRing.rotation.x = Math.PI / 2;
      var thrusterTex = makeRadialTexture('rgba(120,240,255,1)', 'rgba(0,160,255,0)');
      this.thruster = new THREE.Sprite(new THREE.SpriteMaterial({
        map: thrusterTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6
      }));
      this.thruster.scale.set(1.4, 1.4, 1);
      this.thruster.position.set(0, 0.22, 0);

      // 两侧推进舱
      var podGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.8, 8);
      var podL = new THREE.Mesh(podGeo, armor2Mat);
      podL.position.set(-0.72, 0.78, 0.1);
      var podR = new THREE.Mesh(podGeo, armor2Mat);
      podR.position.set(0.72, 0.78, 0.1);

      // 厚重装甲躯干
      var torso = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 1.1), armorMat);
      torso.position.set(0, 1.8, 0);
      // 胸口巨型能量核心
      var chestCore = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), this.coreMat);
      chestCore.position.set(0, 1.9, 0.66);
      // 侧面装甲板
      var plateGeo = new THREE.BoxGeometry(0.5, 0.3, 1.0);
      var plateL = new THREE.Mesh(plateGeo, armor2Mat);
      plateL.position.set(-0.95, 1.7, 0.05);
      plateL.rotation.z = 0.28;
      var plateR = new THREE.Mesh(plateGeo, armor2Mat);
      plateR.position.set(0.95, 1.7, 0.05);
      plateR.rotation.z = -0.28;

      // 双肩重型等离子炮
      var cannonGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.4, 8);
      var cannonL = new THREE.Mesh(cannonGeo, armor2Mat);
      cannonL.position.set(-1.05, 2.35, 0.25);
      cannonL.rotation.x = -0.55;
      var cannonR = new THREE.Mesh(cannonGeo, armor2Mat);
      cannonR.position.set(1.05, 2.35, 0.25);
      cannonR.rotation.x = -0.55;
      var cannonTipL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.14), this.coreMat);
      cannonTipL.position.set(-1.05, 2.2, 0.95);
      var cannonTipR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.14), this.coreMat);
      cannonTipR.position.set(1.05, 2.2, 0.95);

      // 头部(不标记 head,Boss 免疫一击必杀)
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.6), armorMat);
      head.position.set(0, 2.85, 0.1);
      var visorL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.06), visorMat);
      visorL.position.set(-0.16, 2.87, 0.43);
      var visorR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.06), visorMat);
      visorR.position.set(0.16, 2.87, 0.43);
      head.add(visorL);
      head.add(visorR);
      // 顶部天线阵列 + 旋转雷达盘
      var fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), armor2Mat);
      fin.position.set(0, 3.3, 0);
      var finTip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), this.coreMat);
      finTip.position.set(0, 3.62, 0);
      this.dish = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.3, 12), armor2Mat);
      this.dish.position.set(0.3, 3.35, 0.25);
      this.dish.rotation.z = -0.4;

      // 躯干霓虹灯带
      var glowMat2 = new THREE.MeshBasicMaterial({ color: 0x39e6ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });
      var strip1 = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.12, 0.1), glowMat2);
      strip1.position.set(0, 2.42, 0.56);
      var strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 1.15), glowMat2);
      strip2.position.set(0.86, 2.0, 0);

      var self = this;
      var parts = [podL, podR, torso, chestCore, plateL, plateR, cannonL, cannonR, cannonTipL, cannonTipR, fin, finTip, strip1, strip2];
      parts.forEach(function (m) { m.castShadow = true; m.userData.enemy = self; m.userData.boss = self; g.add(m); });
      head.castShadow = true;
      head.userData.enemy = self;
      head.userData.boss = self;
      g.add(head);
      g.add(this.dish);
      g.add(hoverRing);
      g.add(this.thruster);

      this.alertSprite = makeTextSprite('!', '#ff5d8a');
      this.alertSprite.position.set(0, 4.1, 0);
      this.alertSprite.scale.set(0.9, 0.9, 1);
      this.alertSprite.visible = false;
      g.add(this.alertSprite);

      this.group = g;
      this.meshes = parts.concat([head]);
      this.mats = [armorMat, armor2Mat];
      scene.add(g);
    }

    get eyePos() {
      return new THREE.Vector3(this.pos.x, this.pos.y + 2.8, this.pos.z);
    }

    hasLOS() {
      var from = this.eyePos;
      var to = camera.position;
      var dir = to.clone().sub(from);
      var dist = dir.length();
      dir.normalize();
      losRay.set(from, dir);
      var hits = losRay.intersectObjects(obstacleMeshes, false);
      return hits.length === 0 || hits[0].distance > dist - 0.3;
    }

    newPatrolTarget(near) {
      for (var i = 0; i < 40; i++) {
        var x, z;
        var useNear = near && Math.random() < 0.7;
        if (useNear) {
          x = near.x + (Math.random() * 2 - 1) * 14;
          z = near.z + (Math.random() * 2 - 1) * 14;
        } else {
          var r = Math.random();
          if (r < 0.5) {
            x = player.pos.x + (Math.random() * 2 - 1) * 45;
            z = player.pos.z + (Math.random() * 2 - 1) * 45;
          } else if (r < 0.75) {
            x = (Math.random() * 2 - 1) * 40;
            z = (Math.random() * 2 - 1) * 40;
          } else {
            x = (Math.random() * 2 - 1) * (ARENA - 4);
            z = (Math.random() * 2 - 1) * (ARENA - 4);
          }
        }
        if (!circleHitsCollider(new THREE.Vector3(x, 0, z), this.radius + 0.5)) {
          this.patrolTarget = new THREE.Vector3(x, 0, z);
          this.stuckT = 0;
          this.stuckRef.copy(this.pos);
          return this.patrolTarget;
        }
      }
      this.patrolTarget = near ? near.clone() : new THREE.Vector3(
        (Math.random() * 2 - 1) * (ARENA - 4), 0, (Math.random() * 2 - 1) * (ARENA - 4));
      this.stuckT = 0;
      this.stuckRef.copy(this.pos);
      return this.patrolTarget;
    }

    moveToward(x, z, speed, dt) {
      var dx = x - this.pos.x, dz = z - this.pos.z;
      var d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      var step = Math.min(Math.abs(speed) * dt, d);
      var s = speed >= 0 ? 1 : -1;
      this.facing = Math.atan2(dx, dz);
      this.pos.x += (dx / d) * step * s;
      resolveCircle(this.pos, this.radius);
      this.pos.z += (dz / d) * step * s;
      resolveCircle(this.pos, this.radius);
      this.moving = true;
    }

    // 多管齐射
    fireVolley() {
      var volleyN = BOSS.volley[currentLevel] || 3;
      var from = new THREE.Vector3(this.pos.x, this.pos.y + 2.2, this.pos.z);
      for (var i = 0; i < volleyN; i++) {
        var to = new THREE.Vector3(
          player.pos.x + (Math.random() - 0.5) * 2.4,
          player.pos.y + 1.6 + (Math.random() - 0.5) * 1.4,
          player.pos.z + (Math.random() - 0.5) * 2.4
        );
        var vel = to.sub(from).normalize().multiplyScalar(BOSS.bulletSpeed);
        var mesh = new THREE.Mesh(bossBulletGeo, bossBulletMat);
        mesh.position.copy(from);
        scene.add(mesh);
        enemyBullets.push({ mesh: mesh, vel: vel, life: 4.5, dmg: BOSS.volleyDmg });
      }
      AudioFX.bossShoot();
    }

    update(dt) {
      if (!this.alive) return;
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
      var f = this.hitFlash;
      for (var i = 0; i < this.mats.length; i++) {
        this.mats[i].emissive.setRGB(f * 0.8, f * 0.15, f * 0.15);
      }
      this.alertTimer = Math.max(0, this.alertTimer - dt);
      this.alertSprite.visible = this.alertTimer > 0;

      var toPlayer = Math.hypot(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
      this.moving = false;
      if (this.state === 'patrol') {
        if (toPlayer < this.cfg.detect + 4 && this.hasLOS()) {
          this.state = 'chase';
          this.alertTimer = 1;
        }
        if (!this.patrolTarget) this.newPatrolTarget();
        if (this.idleTimer > 0) {
          this.idleTimer -= dt;
        } else {
          var t = this.patrolTarget;
          var d = Math.hypot(t.x - this.pos.x, t.z - this.pos.z);
          if (d < 2) { this.idleTimer = 0.5 + Math.random() * 1.6; this.patrolTarget = null; }
          else this.moveToward(t.x, t.z, this.speed, dt);
        }
      } else if (this.state === 'chase') {
        // 始终掌握玩家位置,永不放弃
        this.lastSeen.copy(player.pos);
        if (toPlayer < BOSS.attackRange && this.hasLOS()) {
          this.state = 'attack';
          this.shootTimer = 0.8;
          return;
        }
        this.moveToward(player.pos.x, player.pos.z, this.speed, dt);
        // 卡墙绕行(兼容多层平台)
        this.stuckT += dt;
        if (this.stuckT > 0.7) {
          if (Math.hypot(this.pos.x - this.stuckRef.x, this.pos.z - this.stuckRef.z) < 0.35) {
            this.patrolTarget = this.newPatrolTarget(this.lastSeen);
            this.state = 'patrol';
          }
          this.stuckRef.copy(this.pos);
          this.stuckT = 0;
        }
      } else if (this.state === 'attack') {
        this.facing = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
        // 丢失视线超过 1.2 秒则继续逼近
        if (this.hasLOS()) { this.lostSight = 0; this.lastSeen.copy(player.pos); }
        else {
          this.lostSight += dt;
          if (this.lostSight > 1.2) { this.state = 'chase'; return; }
        }
        if (toPlayer > BOSS.attackRange + 8) { this.state = 'chase'; return; }
        this.shootTimer -= dt;
        if (this.shootTimer <= 0 && this.hasLOS()) {
          this.shootTimer = BOSS.volleyInterval[currentLevel] || 2.4;
          this.fireVolley();
        }
      }

      // 贴地悬浮:跟随坡道/平台高度
      var ty = groundHeightAt(this.pos.x, this.pos.z, this.pos.y);
      this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 10);

      // 核心指示灯:待机青色 / 警戒亮红
      var alerted = (this.state === 'chase' || this.state === 'attack') ? 1 : 0;
      var pulse = 0.55 + 0.45 * Math.sin(gameTime * 6 + this.phase);
      this.coreMat.emissive.setRGB(0.1 * pulse + 0.9 * alerted, 0.9 * pulse, 1.0 * pulse);

      this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.group.rotation.y = this.facing;
      if (this.moving) this.walkT += dt * 5;
      this.group.position.y += Math.abs(Math.sin(this.walkT)) * 0.12;
      this.dish.rotation.y += dt * 1.5;
      this.thruster.material.opacity = 0.4 + Math.abs(Math.sin(gameTime * 4 + this.walkT)) * 0.3;
    }

    takeDamage(dmg, point, isHead) {
      if (!this.alive) return false;
      this.health -= dmg;
      this.hitFlash = 1;
      spawnBurst(point, 'cyan', 8, 5);
      if (this.health <= 0) { this.die(); return true; }
      AudioFX.enemyHit();
      if (this.state === 'patrol') { this.state = 'chase'; this.alertTimer = 1; }
      return false;
    }

    die() {
      this.alive = false;
      this.group.visible = false;
      score += BOSS.score;
      var bx = this.pos.x, bz = this.pos.z;
      var boomPos = new THREE.Vector3(bx, this.pos.y + 1.8, bz);
      spawnBurst(boomPos, 'cyan', 30, 9);
      spawnBurst(boomPos, 'magenta', 22, 7);
      spawnBurst(boomPos, 'white', 14, 6);
      for (var i = 0; i < 3; i++) {
        var shock = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.5, 0.12, 24),
          new THREE.MeshBasicMaterial({ color: 0x57f0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })
        );
        shock.position.set(bx, this.pos.y + 0.6 + i * 0.5, bz);
        scene.add(shock);
        shockwaves.push({ mesh: shock, life: 0.55 + i * 0.15, maxLife: 0.55 + i * 0.15 });
      }
      AudioFX.bossKill();
      updateHUD();
      levelFinished();
    }
  }

  // 达到击杀配额后召唤 Boss
  function spawnBoss() {
    boss = new Boss(findSpawnPoint(20, 10, 70));
    enemies.push(boss);
    for (var i = 0; i < boss.meshes.length; i++) shootTargets.push(boss.meshes[i]);
    showPickupMsg('警告:BOSS「' + BOSS.name + '」出现!', '#ff5d8a');
    AudioFX.bossWarn();
    updateHUD();
  }

  function separateEnemies() {
    for (var i = 0; i < enemies.length; i++) {
      var a = enemies[i];
      if (!a.alive) continue;
      for (var j = i + 1; j < enemies.length; j++) {
        var b = enemies[j];
        if (!b.alive) continue;
        var dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        var d = Math.hypot(dx, dz);
        var minD = a.radius + b.radius;
        if (d > 0.001 && d < minD) {
          var push = (minD - d) * 0.5;
          a.pos.x -= (dx / d) * push; a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push; b.pos.z += (dz / d) * push;
        }
      }
    }
  }

  /* ------------------------------ 音效 ------------------------------ */
  var AudioFX = (function () {
    var ctx = null, master = null, noiseBuf = null, muted = false;

    function init() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.35;
      master.connect(ctx.destination);
      var len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    function noise(dur, vol, freq, delay) {
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.05);
    }

    function tone(freq, dur, vol, type, delay) {
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator();
      o.type = type || 'square';
      o.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    // 频率扫描音(激光/能量音效)
    function sweep(f0, f1, dur, vol, type, delay) {
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator();
      o.type = type || 'square';
      o.frequency.setValueAtTime(Math.max(1, f0), t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    return {
      unlock: init,
      setMuted: function (m) { muted = m; if (master) master.gain.value = m ? 0 : 0.35; },
      shoot: function () { sweep(1500, 320, 0.09, 0.22, 'square'); noise(0.07, 0.18, 3200); },
      enemyShoot: function () { sweep(900, 260, 0.1, 0.09, 'sine'); },
      melee: function () { sweep(320, 70, 0.16, 0.22, 'sawtooth'); noise(0.1, 0.15, 900); },
      bossShoot: function () { sweep(500, 120, 0.2, 0.22, 'sawtooth'); noise(0.15, 0.18, 1500); },
      bossWarn: function () { sweep(160, 800, 0.7, 0.28, 'sawtooth'); tone(90, 0.6, 0.3, 'sawtooth', 0.12); },
      bossKill: function () { sweep(900, 50, 0.9, 0.4, 'sawtooth'); noise(0.8, 0.35, 1800); tone(55, 0.9, 0.3, 'sine', 0.1); },
      enemyHit: function () { tone(980, 0.05, 0.18, 'square'); },
      kill: function () { sweep(700, 90, 0.22, 0.28, 'sawtooth'); noise(0.25, 0.22, 2400); tone(1400, 0.06, 0.15, 'square', 0.02); },
      hurt: function () { tone(110, 0.24, 0.34, 'sawtooth'); noise(0.18, 0.22, 600); },
      reload: function () { tone(1500, 0.03, 0.14, 'square'); tone(900, 0.03, 0.14, 'square', 0.16); sweep(500, 200, 0.12, 0.12, 'square', 0.3); },
      empty: function () { tone(160, 0.05, 0.12, 'square'); },
      ammoPickup: function () { sweep(500, 1400, 0.12, 0.18, 'square'); },
      healthPickup: function () { sweep(400, 900, 0.16, 0.16, 'sine'); },
      levelClear: function () { sweep(400, 1200, 0.2, 0.2, 'square'); tone(1568, 0.18, 0.2, 'square', 0.15); tone(2093, 0.3, 0.22, 'square', 0.3); },
      victory: function () { sweep(400, 1400, 0.25, 0.22, 'square'); tone(1047, 0.15, 0.2, 'square', 0.2); tone(1319, 0.15, 0.2, 'square', 0.35); tone(1568, 0.5, 0.24, 'square', 0.5); }
    };
  })();

  /* --------------------------- 游戏状态变量 --------------------------- */
  var state = 'menu';               // menu | playing | paused | gameover | levelclear | victory
  var score = 0, kills = 0, shotsFired = 0, shotsHit = 0;
  var currentLevel = 0, levelKills = 0, levelStartTime = 0;
  var pickupMsgTimer = 0;
  var reloading = false, reloadTimer = 0;
  var damageFlash = 0, recoil = 0, shake = 0, flashTimer = 0;
  var lastDamageTime = -999, lastEmptyClick = -999;
  var gameTime = 0, bobT = 0;
  var nextFire = 0;
  var enemies = [];
  var boss = null;          // 当前关卡的 Boss(小圆咪)
  var shockwaves = [];    // 死亡冲击波
  var mouseDown = false;
  var aiming = false;       // 右键开镜瞄准
  var muted = false;
  var crosshairTimer = 0, hitmarkerTimer = 0;

  /* ------------------------------ 输入 ------------------------------ */
  var keys = {};

  document.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (e.code === 'KeyR' && state === 'playing' && document.pointerLockElement === canvas) {
      startReload();
    }
    if (e.code === 'KeyM') toggleMute();
  });
  document.addEventListener('keyup', function (e) { keys[e.code] = false; });
  window.addEventListener('blur', function () { keys = {}; mouseDown = false; aiming = false; });

  document.addEventListener('mousemove', function (e) {
    if (document.pointerLockElement !== canvas) return;
    // 开镜时降低灵敏度,便于精确瞄准
    var sens = aiming ? 0.0013 : 0.0022;
    player.yaw -= e.movementX * sens;
    player.pitch -= e.movementY * sens;
    player.pitch = clamp(player.pitch, -1.5, 1.5);
  });

  canvas.addEventListener('mousedown', function (e) {
    AudioFX.unlock();
    if (state !== 'playing' || document.pointerLockElement !== canvas) return;
    if (e.button === 0) {
      mouseDown = true;
      tryFire();
    } else if (e.button === 2) {
      aiming = true;   // 右键开镜放大
    }
  });
  document.addEventListener('mouseup', function (e) {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) aiming = false;
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* --------------------------- 指针锁定 --------------------------- */
  function requestLock() {
    try {
      var p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  document.addEventListener('pointerlockchange', function () {
    var locked = document.pointerLockElement === canvas;
    if (locked) {
      pauseEl.classList.remove('show');
      if (state === 'paused') state = 'playing';
    } else if (state === 'playing') {
      state = 'paused';
      pauseEl.classList.add('show');
      mouseDown = false;
      aiming = false;
    }
  });
  document.addEventListener('pointerlockerror', function () {
    if (state === 'playing') {
      state = 'paused';
      pauseEl.classList.add('show');
      mouseDown = false;
      aiming = false;
    }
  });

  document.addEventListener('click', function () {
    AudioFX.unlock();
    if (state === 'paused') {
      requestLock();
    } else if (state === 'menu') {
      startGame();
    } else if (state === 'gameover') {
      enterLevel(currentLevel);
    } else if (state === 'levelclear') {
      enterLevel(currentLevel + 1);
    } else if (state === 'victory') {
      startGame();
    }
  });

  /* ------------------------------ 射击 ------------------------------ */
  function crosshairFire() {
    crosshairEl.classList.add('fire');
    clearTimeout(crosshairTimer);
    crosshairTimer = setTimeout(function () { crosshairEl.classList.remove('fire'); }, 100);
  }

  function showHitmarker(kill) {
    hitmarkerEl.classList.remove('show', 'kill');
    void hitmarkerEl.offsetWidth;
    if (kill) hitmarkerEl.classList.add('kill');
    hitmarkerEl.classList.add('show');
    clearTimeout(hitmarkerTimer);
    hitmarkerTimer = setTimeout(function () { hitmarkerEl.classList.remove('show'); }, 130);
  }

  function fireShot() {
    if (reloading || player.ammo <= 0) {
      if (player.ammo <= 0) startReload();
      return;
    }
    var now = performance.now();
    if (now < nextFire) return;
    nextFire = now + 120;
    player.ammo--;
    shotsFired++;
    AudioFX.shoot();
    recoil = 1;
    flashTimer = 1;
    crosshairFire();

    raycaster.setFromCamera(centerNdc, camera);
    var hits = raycaster.intersectObjects(shootTargets, false);
    var hit = null;
    for (var i = 0; i < hits.length; i++) {
      var u = hits[i].object.userData;
      if (u.enemy && !u.enemy.alive) continue;
      hit = hits[i];
      break;
    }

    var tipPos = muzzleTip.getWorldPosition(new THREE.Vector3());
    var end = hit ? hit.point : raycaster.ray.at(200);
    spawnTracer(tipPos, end);

    if (hit) {
      var ud = hit.object.userData;
      if (ud.enemy) {
        shotsHit++;
        var isHead = !!ud.head;
        var died = ud.enemy.takeDamage(isHead ? ud.enemy.health : 34, hit.point, isHead);
        showHitmarker(died);
      } else {
        spawnBurst(hit.point, 'cyan', 6, 4);
      }
    }
    updateHUD();
    if (player.ammo === 0) startReload();
  }

  function tryFire() {
    fireShot();
  }

  function startReload() {
    if (reloading || player.ammo >= MAG_SIZE || player.reserve <= 0) {
      if (player.ammo === 0 && player.reserve === 0 && gameTime - lastEmptyClick > 0.3) {
        lastEmptyClick = gameTime;
        AudioFX.empty();
      }
      return;
    }
    reloading = true;
    reloadTimer = 1.5;
    AudioFX.reload();
    updateHUD();
  }

  function toggleMute() {
    muted = !muted;
    AudioFX.setMuted(muted);
  }

  /* ------------------------------ HUD ------------------------------ */
  function updateHUD() {
    var h = Math.max(0, player.health);
    healthFillEl.style.width = h + '%';
    healthFillEl.style.background = h > 60
      ? 'linear-gradient(90deg,#5fc95a,#a3dc5c)'
      : h > 30
        ? 'linear-gradient(90deg,#ffb84d,#ffd75e)'
        : 'linear-gradient(90deg,#ff4d4d,#ff7a4d)';
    healthNumEl.textContent = Math.ceil(h);
    ammoCurEl.textContent = player.ammo;
    ammoResEl.textContent = player.reserve;
    scoreEl.textContent = score;
    killsEl.textContent = kills;
    var alive = 0;
    for (var i = 0; i < enemies.length; i++) if (enemies[i].alive) alive++;
    enemiesEl.textContent = alive;
    levelTitleEl.textContent = '第 ' + (currentLevel + 1) + ' 关 · ' + LEVELS[currentLevel].name;
    var quota = LEVELS[currentLevel].quota;
    levelProgressFillEl.style.width = Math.min(100, (levelKills / quota) * 100) + '%';
    levelProgressTextEl.textContent = '击杀 ' + levelKills + ' / ' + quota;
    // Boss 血条
    if (boss && boss.alive) {
      bossHudEl.classList.remove('hidden');
      bossFillEl.style.width = Math.max(0, boss.health / boss.maxHealth * 100) + '%';
    } else {
      bossHudEl.classList.add('hidden');
    }
    if (reloading) {
      reloadEl.textContent = '充能中…';
      reloadEl.classList.add('on');
    } else if (player.ammo === 0 && player.reserve === 0) {
      reloadEl.textContent = '能量耗尽！';
      reloadEl.classList.add('on');
    } else {
      reloadEl.classList.remove('on');
    }
  }

  /* --------------------------- 游戏流程 --------------------------- */
  function findSpawnPoint(minPlayerDist, minEnemyDist, maxPlayerDist) {
    for (var i = 0; i < 80; i++) {
      var x = (Math.random() * 2 - 1) * (ARENA - 4);
      var z = (Math.random() * 2 - 1) * (ARENA - 4);
      var p = new THREE.Vector3(x, 0, z);
      if (circleHitsCollider(p, 1.6)) continue;
      if (groundHeightAt(x, z, 999) > 0.5) continue;   // 出生点仅限地面,避免困在平台顶
      var pd = p.distanceTo(player.pos);
      if (pd < minPlayerDist) continue;
      if (maxPlayerDist && pd > maxPlayerDist) continue;
      var ok = true;
      for (var j = 0; j < enemies.length; j++) {
        var e = enemies[j];
        if (e.alive && e.pos.distanceTo(p) < minEnemyDist) { ok = false; break; }
      }
      if (ok) return p;
    }
    return new THREE.Vector3((Math.random() * 2 - 1) * (ARENA - 6), 0, (Math.random() * 2 - 1) * (ARENA - 6));
  }

  function clearDynamic() {
    var i;
    for (i = 0; i < enemyBullets.length; i++) scene.remove(enemyBullets[i].mesh);
    enemyBullets.length = 0;
    for (i = 0; i < particles.length; i++) scene.remove(particles[i].mesh);
    particles.length = 0;
    for (i = 0; i < tracers.length; i++) scene.remove(tracers[i].mesh);
    tracers.length = 0;
    for (i = 0; i < lootItems.length; i++) scene.remove(lootItems[i].group);
    lootItems.length = 0;
    for (i = 0; i < enemies.length; i++) scene.remove(enemies[i].group);
    enemies.length = 0;
    for (i = 0; i < shockwaves.length; i++) scene.remove(shockwaves[i].mesh);
    shockwaves.length = 0;
    if (boss) { scene.remove(boss.group); boss = null; }
    aiming = false;
  }

  function startLevel(idx) {
    clearDynamic();
    currentLevel = idx;
    levelKills = 0;
    levelStartTime = gameTime;
    var cfg = LEVELS[idx];
    var rushersN = cfg.rushers || 0, soldiersN = cfg.soldiers || 0;
    var total = cfg.enemies + rushersN + soldiersN;
    for (var i = 0; i < total; i++) {
      var kind = i < rushersN ? 'rusher' : (i < rushersN + soldiersN ? 'soldier' : 'gunner');
      enemies.push(new Enemy(findSpawnPoint(16, 6, 70), kind));
    }
    shootTargets = obstacleMeshes.slice();
    for (var j = 0; j < enemies.length; j++) {
      shootTargets = shootTargets.concat(enemies[j].meshes);
    }

    // 玩家重置(每关开始满血满弹药);(0,0,45) 为南部开阔地面
    player.pos.set(0, 0, 45);
    player.pos.y = groundHeightAt(0, 45, 999);
    player.vel.set(0, 0, 0);
    player.vy = 0;
    player.grounded = true;
    player.yaw = 0;
    player.pitch = 0;
    player.health = 100;
    player.ammo = MAG_SIZE;
    player.reserve = RESERVE;

    reloading = false; reloadTimer = 0;
    damageFlash = 0; recoil = 0; shake = 0; flashTimer = 0;
    lastDamageTime = -999;
    gameTime = 0; bobT = 0;
    mouseDown = false;
    nextFire = 0;
    camera.fov = 74;
    camera.updateProjectionMatrix();
    vignetteEl.style.opacity = '0';
    updateHUD();
  }

  function enterLevel(idx) {
    startLevel(idx);
    state = 'playing';
    menuEl.classList.remove('show');
    pauseEl.classList.remove('show');
    overEl.classList.remove('show');
    levelClearEl.classList.remove('show');
    victoryEl.classList.remove('show');
    hud.classList.add('show');
    updateHUD();
    requestLock();
  }

  function startGame() {
    score = 0; kills = 0; shotsFired = 0; shotsHit = 0;
    enterLevel(0);
  }

  function damagePlayer(dmg) {
    if (state !== 'playing') return;
    player.health -= dmg;
    lastDamageTime = gameTime;
    damageFlash = Math.min(0.85, damageFlash + 0.45);
    shake = Math.min(1, shake + 0.5);
    AudioFX.hurt();
    if (player.health <= 0) {
      player.health = 0;
      updateHUD();
      gameOver();
    }
  }

  function gameOver() {
    state = 'gameover';
    mouseDown = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    hud.classList.remove('show');
    goLevelEl.textContent = '第 ' + (currentLevel + 1) + ' 关 · ' + LEVELS[currentLevel].name +
      ' · 击杀进度 ' + levelKills + ' / ' + LEVELS[currentLevel].quota;
    overEl.classList.add('show');
    finalScoreEl.textContent = score;
    finalKillsEl.textContent = kills;
    finalAccEl.textContent = shotsFired > 0
      ? Math.round((shotsHit / shotsFired) * 100) + '%'
      : '-';
  }

  function levelFinished() {
    var bonus = 300 * (currentLevel + 1);
    score += bonus;
    mouseDown = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    hud.classList.remove('show');
    if (currentLevel >= LEVELS.length - 1) {
      state = 'victory';
      AudioFX.victory();
      vicScoreEl.textContent = score;
      vicKillsEl.textContent = kills;
      vicAccEl.textContent = shotsFired > 0
        ? Math.round((shotsHit / shotsFired) * 100) + '%'
        : '-';
      victoryEl.classList.add('show');
    } else {
      state = 'levelclear';
      AudioFX.levelClear();
      lcLevelEl.textContent = '第 ' + (currentLevel + 1) + ' 关 · ' + LEVELS[currentLevel].name;
      lcTimeEl.textContent = Math.round(gameTime - levelStartTime);
      lcBonusEl.textContent = '+' + bonus;
      lcScoreEl.textContent = score;
      lcNextEl.textContent = '点击进入第 ' + (currentLevel + 2) + ' 关 · ' + LEVELS[currentLevel + 1].name;
      levelClearEl.classList.add('show');
    }
  }

  /* --------------------------- 主循环 --------------------------- */
  function updatePlayer(dt) {
    var f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    var s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    var mx = -Math.sin(player.yaw) * f + Math.cos(player.yaw) * s;
    var mz = -Math.cos(player.yaw) * f - Math.sin(player.yaw) * s;
    var len = Math.hypot(mx, mz);
    if (len > 1) len = 1;
    var sprinting = (keys.ShiftLeft || keys.ShiftRight) && len > 0;
    var spd = (sprinting ? 9.5 : 6) * len;
    player.vel.x = len > 0 ? (mx / len) * spd : 0;
    player.vel.z = len > 0 ? (mz / len) * spd : 0;

    if (keys.Space && player.grounded) {
      player.vy = 8.2;
      player.grounded = false;
    }
    player.vy -= 30 * dt;
    player.pos.y += player.vy * dt;
    // 贴合多层平台/坡道地面高度(桥底/坡下不传送上坡)
    var gh = groundHeightAt(player.pos.x, player.pos.z, player.pos.y);
    if (player.pos.y <= gh) {
      player.pos.y = gh; player.vy = 0; player.grounded = true;
    }

    moveEntity(player.pos, player.vel.x * dt, player.vel.z * dt, 0.5);

    // 与敌人碰撞推开
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      var dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      var d = Math.hypot(dx, dz);
      var minD = e.radius + 0.5;
      if (d < minD && d > 0.001) {
        player.pos.x += (dx / d) * (minD - d);
        player.pos.z += (dz / d) * (minD - d);
      }
    }

    // 走路头部摆动
    var speed2d = Math.hypot(player.vel.x, player.vel.z);
    var bob = 0;
    if (player.grounded && speed2d > 0.5) {
      bobT += dt * speed2d * 1.5;
      bob = Math.sin(bobT) * 0.045;
    }
    camera.position.set(player.pos.x, player.pos.y + 1.6 + bob, player.pos.z);

    // 武器后坐/摆动 + 换弹动作(枪身下沉-回位)+ 开镜收枪
    var reloadDip = 0;
    if (reloading) {
      var rp = 1 - reloadTimer / 1.5;       // 换弹进度 0→1
      reloadDip = Math.sin(rp * Math.PI);   // 平滑下沉再回位
    }
    var aimShift = aiming ? 1 : 0;
    gunGroup.position.x = GUN_X - aimShift * 0.1;
    gunGroup.position.z = GUN_Z + recoil * 0.1 + reloadDip * 0.17 - aimShift * 0.05;
    gunGroup.position.y = GUN_Y - recoil * 0.03 - reloadDip * 0.14 - aimShift * 0.08 +
      (player.grounded && speed2d > 0.5 ? Math.sin(bobT * 0.5) * 0.006 : 0);
    gunGroup.rotation.x = -recoil * 0.2 - reloadDip * 0.55 + aimShift * 0.1;
    gunGroup.rotation.z = reloadDip * 0.22;

    // 视场:开镜放大优先,其次疾跑
    var targetFov = aiming ? 45 : ((sprinting && len > 0) ? 80 : 74);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  function update(dt) {
    updatePlayer(dt);
    for (var i = 0; i < enemies.length; i++) enemies[i].update(dt);
    separateEnemies();
    updateEnemyBullets(dt);
    updateParticles(dt);
    updateTracers(dt);
    updateLoot(dt);
    if (mouseDown) tryFire();

    // 死亡冲击波扩散
    for (var si = shockwaves.length - 1; si >= 0; si--) {
      var sw = shockwaves[si];
      sw.life -= dt;
      if (sw.life <= 0) { scene.remove(sw.mesh); shockwaves.splice(si, 1); continue; }
      var sk = 1 - sw.life / sw.maxLife;
      sw.mesh.scale.set(1 + sk * 7, 1, 1 + sk * 7);
      sw.mesh.material.opacity = 0.9 * (1 - sk);
    }

    // 换弹
    if (reloading) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        var need = MAG_SIZE - player.ammo;
        var take = Math.min(need, player.reserve);
        player.ammo += take;
        player.reserve -= take;
        reloading = false;
        updateHUD();
      }
    }

    // 缓慢回血
    if (player.health < 100 && gameTime - lastDamageTime > 4) {
      player.health = Math.min(100, player.health + 10 * dt);
    }

    // 特效衰减
    damageFlash = Math.max(0, damageFlash - dt * 1.3);
    vignetteEl.style.opacity = (damageFlash * 0.9).toFixed(2);
    flashTimer = Math.max(0, flashTimer - dt * 22);
    flashSprite.visible = flashTimer > 0;
    flashLight.intensity = flashTimer > 0 ? 3.5 : 0;
    recoil = Math.max(0, recoil - dt * 7);
    shake = Math.max(0, shake - dt * 1.6);

    // 枪械能量核心脉动
    var gp = Math.max(flashTimer, 0.35 + 0.3 * Math.sin(gameTime * 5));
    gunCoreMat.emissive.setRGB(0.1 * gp, 0.85 * gp, gp);

    // 开镜遮罩
    scopeEl.classList.toggle('show', aiming);

    updateHUD();
  }

  // Boss 指示光标:全图可见,屏幕内显示在 Boss 头顶,屏幕外贴边指向
  function updateBossMarker() {
    if (!boss || !boss.alive || state !== 'playing') {
      bossMarkerEl.style.display = 'none';
      return;
    }
    var bv = new THREE.Vector3(boss.pos.x, boss.pos.y + 4.5, boss.pos.z).project(camera);
    var sx = (bv.x * 0.5 + 0.5) * window.innerWidth;
    var sy = (-bv.y * 0.5 + 0.5) * window.innerHeight;
    var onScreen = bv.z < 1 && sx >= -30 && sx <= window.innerWidth + 30 && sy >= -30 && sy <= window.innerHeight + 30;
    if (onScreen) {
      bossMarkerEl.style.display = 'block';
      bossMarkerEl.style.left = sx + 'px';
      bossMarkerEl.style.top = sy + 'px';
      bossMarkerEl.style.transform = 'translate(-50%, -100%)';
      bossMarkerEl.textContent = '▼ 小圆咪';
    } else {
      var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      var ang = Math.atan2(sy - cy, sx - cx);
      var mx = Math.max(30, Math.min(window.innerWidth - 30, cx + Math.cos(ang) * (window.innerWidth / 2 - 50)));
      var my = Math.max(30, Math.min(window.innerHeight - 30, cy + Math.sin(ang) * (window.innerHeight / 2 - 50)));
      bossMarkerEl.style.display = 'block';
      bossMarkerEl.style.left = mx + 'px';
      bossMarkerEl.style.top = my + 'px';
      bossMarkerEl.style.transform = 'translate(-50%, -50%) rotate(' + ang + 'rad)';
      bossMarkerEl.textContent = '▶';
    }
  }

  var lastT = performance.now();
  function animate() {
    requestAnimationFrame(animate);
    var now = performance.now();
    var dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;
    if (state === 'playing') {
      gameTime += dt;
      update(dt);
    }
    // 全息环旋转(任意状态持续)
    for (var hi = 0; hi < holos.length; hi++) {
      holos[hi].rotation.y += dt * 0.9;
    }
    var shx = (Math.random() - 0.5) * shake * 0.08;
    var shy = (Math.random() - 0.5) * shake * 0.08;
    camera.rotation.set(player.pitch + recoil * 0.045 + shx, player.yaw + shy, 0);
    renderer.render(scene, camera);
    updateBossMarker();
  }

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ------------------------------ 启动 ------------------------------ */
  buildWorld();
  buildGun();
  currentLevel = 0;
  startLevel(0);
  state = 'menu';
  updateHUD();
  camera.position.set(0, 1.6, 45);
  camera.rotation.set(0, 0, 0);
  menuEl.classList.add('show');
  hud.classList.remove('show');
  requestAnimationFrame(animate);
})();
