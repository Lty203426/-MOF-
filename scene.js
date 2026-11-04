/* MOF Studio - procedural Three.js laboratory. No external models or textures. */

/** 分数坐标 -> 笛卡尔坐标（与 Crys 中一致：a 沿 x，b 在 xy 平面） */
function fracToCart(f, M) {
  return [f[0] * M[0][0] + f[1] * M[1][0] + f[2] * M[2][0],
    f[0] * M[0][1] + f[1] * M[1][1] + f[2] * M[2][1],
    f[0] * M[0][2] + f[1] * M[1][2] + f[2] * M[2][2]];
}

/** 角度差（弧度，归一到 -π..π），用于朝向的平滑转向 */
function angleDelta(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

/** 数值夹取 */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/** 球棍模型中原子的显示半径（Å） */
function displayRadius(symbol) {
  const s = (symbol || '').trim();
  const key = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const map = { H: 0.30, C: 0.46, N: 0.46, O: 0.46, F: 0.42, S: 0.52, Cl: 0.55, Br: 0.58, Cu: 0.62, Zn: 0.62, Zr: 0.70 };
  return map[key] || 0.5;
}

class VirtualLab {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.devices = new Map();
    this.interactive = [];
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8ecef);
    this.scene.fog = new THREE.Fog(0xe8ecef, 24, 60);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    this.camera.position.set(8.8, 5.1, 11.0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.pixelCap = 1.75;                 // 高 DPI / 4K 屏下的像素比上限，避免填充率与显存压力
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelCap));
    this.contextLost = false;             // WebGL 上下文丢失标记（GPU 崩溃或驱动重置时置位）
    this.autoDegraded = false;            // 是否已触发自动降级
    this.slowWindows = 0;                 // 连续低帧率窗口计数
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.45, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 23;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minPolarAngle = 0.18;
    this.controls.panSpeed = 0.65;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.labRoot = new THREE.Group();
    this.scene.add(this.labRoot);
    this.crystalRoot = new THREE.Group();
    this.crystalRoot.visible = false;
    this.scene.add(this.crystalRoot);
    this.cifRoot = new THREE.Group();
    this.cifRoot.visible = false;
    this.scene.add(this.cifRoot);
    this.growth = 0;
    this.crystalMode = false;
    this.structureMode = 'cif';        // 'cif' = 真实 CIF 结构；'model' = 教学概念模型
    this.stirring = false;
    this.centrifuging = false;
    this.activating = false;
    this.sonicating = false;
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.cameraTween = null;
    this.lowQuality = false;
    this.airflows = [];
    this.pourAnim = null;                // 3D 直接操作：进行中的取瓶倾倒动画
    this.bubbles = [];
    this.ripples = [];
    this.steam = [];                     // 反应釜蒸汽粒子
    this.sfx = new Sfx();                // 程序化音效引擎（WebAudio 合成，无外部音频文件）
    this._snd = {};                      // 循环音效状态缓存（避免每帧重复启停）
    this._sway = { A: 0, B: 0 };         // 倾倒后液面晃动强度
    this.rotorWobble = 0;                // 离心配平检查后的转子抖动
    this.lidScrewing = false;            // 反应釜拧盖动画进行中（暂停 updateDevices 的釜盖控制）
    this.vacuumOn = false;               // 真空系统开启（烘箱真空表 / 泵音效）
    this._tubeCount = 0; this._tubesDrained = false;   // 离心管装载状态
    this._powTarget = 0.001;             // 称量舟粉末堆目标高度
    this._liqTarget = { A: { s: 0.02, y: 0.03 }, B: { s: 0.02, y: 0.03 }, reactor: 0.5 };   // 液位平滑目标
    // 悬停设备高亮环（不修改共享材质，用独立网格避免污染）
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 40),
      new THREE.MeshBasicMaterial({ color: 0x53e0c8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    this.hoverRing.rotation.x = -Math.PI / 2; this.hoverRing.visible = false; this.hoverRing.renderOrder = 15;
    this.scene.add(this.hoverRing);
    // 物理反馈扩展：液滴 / 粉尘粒子与镜头震动
    this.drops = []; this.dusts = []; this._shake = 0;
    // 3D 实验员（同步演示 · 无障碍辅助）
    this.assistOn = true;
    this.assist = { mode: 'idle', tx: 0, tz: 2.8, faceV: null, gesture: 0, gestureType: 'point', phase: 0, stepT: 0, bubble: null, bubbleT: 0, bubbleDur: 5, speak: 0, speed: 0, lean: 0, fidget: null, nextFidget: 4, look: null, lookT: 6, stepSide: 0 };
    // 操作失误时助手摇头摊手（包装 sfx.error 作为单点挂钩）
    const origErr = this.sfx.error.bind(this.sfx);
    this.sfx.error = (...args) => { origErr(...args); this.assistantDisapprove?.(); };
    this.anim = {
      balanceDoor: 0, balanceWobble: 0, boatDrop: 0,
      stirSpeed: 0, vortex: 0,
      lidLift: 0, lidSpin: 0,
      spinLid: 0, rotorSpeed: 0,
      ovenDoor: 0, gauge: 0,
      pxrdArm: 0, betDewar: 0, semScan: 0,
      sash: 0, bottlePour: 0
    };
    this.thermalAmp = 0;               // 热振动动画幅度（由 U_iso 推出）
    this.materials();
    this.buildEnvironment();
    this.buildStudioEnvironment();
    this.batchStatic(this.labRoot);
    this.buildFurniture();
    this.buildEquipment();
    this.optimizeStaticEquipment();
    this.buildCrystal();
    this.addContactLighting();
    this.bindEvents();
    this.resize();
    this.animate();
    this.initCIF();
  }

  materials() {
    this.mat = {
      bench: new THREE.MeshStandardMaterial({ color: 0xe9ebec, roughness: 0.5, metalness: 0.04 }),
      benchTop: new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.25, metalness: 0 }),
      cabinet: new THREE.MeshStandardMaterial({ color: 0xf1f2f3, roughness: 0.55, metalness: 0.05 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf7f8f9, roughness: 0.38, metalness: 0.04 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b3238, roughness: 0.46, metalness: 0.2 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xb8c2c8, roughness: 0.24, metalness: 0.9 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd9e0e4, roughness: 0.18, metalness: 0.9 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0xeaf6f8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false }),
      blueLiquid: new THREE.MeshPhysicalMaterial({ color: 0x2277cc, transparent: true, opacity: 0.78, roughness: 0.1, metalness: 0.05 }),
      purpleLiquid: new THREE.MeshPhysicalMaterial({ color: 0x7b3fd4, transparent: true, opacity: 0.72, roughness: 0.1 }),
      clearLiquid: new THREE.MeshPhysicalMaterial({ color: 0xd9eef2, transparent: true, opacity: 0.4, roughness: 0.08 }),
      crystal: new THREE.MeshStandardMaterial({ color: 0x345fc6, roughness: 0.3, metalness: 0.05, emissive: 0x06344c, emissiveIntensity: 0.25 }),
      copper: new THREE.MeshStandardMaterial({ color: 0x18a3c9, roughness: 0.22, metalness: 0.58, emissive: 0x0a5b6e, emissiveIntensity: 0.75 }),
      linker: new THREE.MeshStandardMaterial({ color: 0xc0d2cf, roughness: 0.38, metalness: 0.18 }),
      oxygen: new THREE.MeshStandardMaterial({ color: 0xd26c62, roughness: 0.44 }),
      amber: new THREE.MeshPhysicalMaterial({ color: 0x8a4a10, transparent: true, opacity: 0.86, roughness: 0.14 }),
      blueSolid: new THREE.MeshStandardMaterial({ color: 0x2a6fc2, roughness: 0.95 }),
      whiteSolid: new THREE.MeshStandardMaterial({ color: 0xeee9dc, roughness: 0.95 }),
      black: new THREE.MeshStandardMaterial({ color: 0x181d22, roughness: 0.44 }),
      screen: new THREE.MeshStandardMaterial({ color: 0x0b2028, emissive: 0x2fb8ae, emissiveIntensity: 0.5, roughness: 0.22 }),
      red: new THREE.MeshStandardMaterial({ color: 0xcf4640, roughness: 0.5 }),
      capRed: new THREE.MeshStandardMaterial({ color: 0xc9403a, roughness: 0.55 }),
      capBlue: new THREE.MeshStandardMaterial({ color: 0x2f6fd2, roughness: 0.55 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe0af3e, roughness: 0.48 }),
      hazard: new THREE.MeshStandardMaterial({ color: 0xe0af3e, roughness: 0.6 }),
      green: new THREE.MeshStandardMaterial({ color: 0x2f8f75, roughness: 0.45 }),
      hotplate: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.4, metalness: 0.3, emissive: 0xff5a1e, emissiveIntensity: 0 })
    };
    // r128 有 transmission，但没有后续版本的 thickness / ior。
    this.mat.opticalGlass = new THREE.MeshPhysicalMaterial({color:0xdfeef0, transmission:1, transparent:true, opacity:1, roughness:0.055, metalness:0, clearcoat:1, clearcoatRoughness:0.04, side:THREE.DoubleSide});
    this.mat.opticalAmber = new THREE.MeshPhysicalMaterial({color:0x5a3a12, transmission:0.85, transparent:true, opacity:1, roughness:0.08, clearcoat:1});
    const c=document.createElement('canvas'); c.width=c.height=128;
    const x=c.getContext('2d'); x.fillStyle='#808080';x.fillRect(0,0,128,128);
    for(let y=0;y<128;y++){x.fillStyle='rgb('+[110+y%17,110+y%17,110+y%17].join(',')+')';x.fillRect(0,y,128,1);}
    const rough=new THREE.CanvasTexture(c);rough.wrapS=rough.wrapT=THREE.RepeatWrapping;rough.repeat.set(3,1);
    this.mat.steel.roughnessMap=rough;
    const n=document.createElement('canvas');n.width=n.height=64;const nx=n.getContext('2d'),data=nx.createImageData(64,64);
    for(let i=0;i<data.data.length;i+=4){const v=100+((i*13+(i>>6)*17)%80);data.data[i]=data.data[i+1]=data.data[i+2]=v;data.data[i+3]=255;}nx.putImageData(data,0,0);
    const bump=new THREE.CanvasTexture(n);this.mat.blueSolid.bumpMap=this.mat.whiteSolid.bumpMap=bump;this.mat.blueSolid.bumpScale=this.mat.whiteSolid.bumpScale=0.005;
  }

  mesh(geometry, material, parent = this.labRoot, shadow = true) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    parent.add(m);
    return m;
  }
  box(w, h, d, mat, x, y, z, parent) {
    this._boxCache=this._boxCache||new Map();const key=[w,h,d].join('/');let geom=this._boxCache.get(key);
    if(!geom){
      const r=Math.min(w,h,d)*0.14, shape=new THREE.Shape(),a=-w/2,b=-h/2;
      shape.moveTo(a+r,b);shape.lineTo(a+w-r,b);shape.quadraticCurveTo(a+w,b,a+w,b+r);shape.lineTo(a+w,b+h-r);shape.quadraticCurveTo(a+w,b+h,a+w-r,b+h);shape.lineTo(a+r,b+h);shape.quadraticCurveTo(a,b+h,a,b+h-r);shape.lineTo(a,b+r);shape.quadraticCurveTo(a,b,a+r,b);
      geom=new THREE.ExtrudeGeometry(shape,{depth:Math.max(0.0001,d-2*r),bevelEnabled:true,bevelThickness:r,bevelSize:r*0.45,bevelSegments:1,steps:1,curveSegments:2});geom.translate(0,0,-d/2+r);this._boxCache.set(key,geom);
    }
    const m=this.mesh(geom,mat,parent);m.position.set(x,y,z);return m;
  }
  cyl(rt, rb, h, mat, x, y, z, parent, seg = 32) { const m = this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, parent); m.position.set(x, y, z); return m; }
  sphere(r, mat, x, y, z, parent, seg = 20) { const m = this.mesh(new THREE.SphereGeometry(r, seg, Math.max(12, Math.round(seg / 2))), mat, parent); m.position.set(x, y, z); return m; }
  torus(r, tube, mat, x, y, z, parent) { const m = this.mesh(new THREE.TorusGeometry(r, tube, 10, 40), mat, parent); m.position.set(x, y, z); m.rotation.x = Math.PI / 2; return m; }

  roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  label(text, sub = '', scale = 1, dark = false) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 144;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = dark ? 'rgba(7,30,37,.9)' : 'rgba(252,253,254,.96)';
    this.roundRectPath(ctx, 6, 6, 500, 132, 18); ctx.fill();
    ctx.strokeStyle = dark ? 'rgba(93,214,201,.42)' : 'rgba(30,90,98,.3)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = dark ? '#e8ffff' : '#0f3a44'; ctx.font = '600 34px "Microsoft YaHei"'; ctx.textAlign = 'center'; ctx.fillText(text, 256, 61);
    ctx.fillStyle = dark ? '#79c4c2' : '#4a7c85'; ctx.font = '22px Inter, sans-serif'; ctx.fillText(sub, 256, 106);
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(1.72 * scale, 0.483 * scale, 1); sprite.renderOrder = 20;
    return sprite;
  }

  screenTexture(lines, color = '#8ff0dc') {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const x = c.getContext('2d'); x.fillStyle = '#04191f'; x.fillRect(0, 0, 512, 256);
    x.strokeStyle = 'rgba(85,196,190,.16)'; x.lineWidth = 1;
    for (let i = 0; i <= 512; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); }
    for (let i = 0; i <= 256; i += 32) { x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke(); }
    x.fillStyle = color; x.font = 'bold 30px monospace';
    lines.forEach((t, i) => x.fillText(t, 30, 56 + i * 50));
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; return tex;
  }

  register(group, id, name, hint, focusOffset = [3, 2.4, 4]) {
    group.userData.device = id; group.userData.name = name; group.userData.hint = hint;
    group.traverse(o => { if (o.isMesh) { o.userData.deviceRoot = group; this.interactive.push(o); } });
    this.devices.set(id, { group, name, hint, focusOffset });
    return group;
  }

  buildEnvironment() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0xd0d6da, 0.95); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.45); sun.position.set(6, 12, 7); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -13; sun.shadow.camera.right = 13; sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -13; sun.shadow.bias = -0.0005; this.scene.add(sun);
    const fill = new THREE.PointLight(0xffffff, 0.4, 20); fill.position.set(-7, 5.5, 4); this.scene.add(fill);
    // 浅灰色地砖（程序化贴图）
    const tc = document.createElement('canvas'); tc.width = 256; tc.height = 256;
    const tx = tc.getContext('2d');
    tx.fillStyle = '#d8dbdd'; tx.fillRect(0, 0, 256, 256);
    tx.strokeStyle = '#c3c8cc'; tx.lineWidth = 4; tx.strokeRect(0, 0, 256, 256);
    tx.strokeStyle = 'rgba(255,255,255,.35)'; tx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { tx.beginPath(); tx.moveTo(0, i * 64 + 32); tx.lineTo(256, i * 64 + 32); tx.stroke(); }
    const tileTex = new THREE.CanvasTexture(tc); tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping; tileTex.repeat.set(13, 12); tileTex.encoding = THREE.sRGBEncoding;
    const floorMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.5, metalness: 0.04 });
    const floor = this.mesh(new THREE.PlaneGeometry(34, 30), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    // 白色墙面 + 深灰踢脚线
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.92, metalness: 0 });
    this.box(26, 8, 0.25, wallMat, 0, 4, -7);
    this.box(26, 0.14, 0.3, new THREE.MeshStandardMaterial({ color: 0x3d4348, roughness: 0.7 }), 0, 0.07, -6.96);
    this.box(0.25, 8, 22, wallMat, -11.5, 4, 0);
    this.box(0.3, 0.14, 22, new THREE.MeshStandardMaterial({ color: 0x3d4348, roughness: 0.7 }), -11.46, 0.07, 0);
    // Windows
    for (let i = 0; i < 3; i++) {
      this.box(3.2, 2.25, 0.05, new THREE.MeshStandardMaterial({ color: 0xdff0fc, emissive: 0xcfe6f8, emissiveIntensity: 0.6, roughness: 0.1 }), 2.8 + i * 3.5, 4.7, -6.86);
      this.box(0.07, 2.3, 0.08, this.mat.white, 2.8 + i * 3.5, 4.7, -6.79);
      this.box(3.25, 0.07, 0.08, this.mat.white, 2.8 + i * 3.5, 4.7, -6.79);
    }
    // 吊顶
    this.box(26, 0.12, 22, new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.9 }), 0, 7.3, 0, this.labRoot, false);
    // Ceiling luminaires
    for (let x = -7; x <= 7; x += 7) {
      this.box(3.6, 0.09, 0.7, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85 }), x, 6.75, -0.8);
      const light = new THREE.PointLight(0xffffff, 0.55, 14); light.position.set(x, 6.3, -0.8); /* 环境贴图提供面光反射，不重复添加点光。 */
      this.box(3.6, 0.09, 0.7, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85 }), x, 6.75, 1.6);
      const light2 = new THREE.PointLight(0xffffff, 0.4, 14); light2.position.set(x, 6.3, 1.6); /* 同上。 */
    }
    // HVAC vents
    [-4, 4].forEach(x => this.box(1.1, 0.08, 1.1, this.mat.steel, x, 6.82, 2.2, this.labRoot, false));
    // 主实验台（白色柜体 + 白色环氧台面）——所有 y=1.31 台面设备的载体
    const benchBody = new THREE.MeshStandardMaterial({ color: 0xeceef0, roughness: 0.58, metalness: 0.04 });
    this.box(11.4, 0.07, 3.3, this.mat.benchTop, 0, 1.275, 0.25);
    this.box(11.3, 1.22, 3.12, benchBody, 0, 0.63, 0.25);
    this.box(11.3, 0.1, 0.06, new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.7 }), 0, 0.05, 1.79);
    for (let x = -5.2; x <= 5.2; x += 1.3) {
      this.box(0.015, 1.0, 0.02, new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.8 }), x, 0.72, 1.822);
      this.box(0.26, 0.03, 0.035, this.mat.chrome, x, 0.98, 1.825);
    }
    // 后墙实验台（表征仪器与烘箱的载体，台面高度 1.2）
    this.box(9.2, 0.07, 1.7, this.mat.benchTop, 1.9, 1.165, -5.3);
    this.box(9.1, 1.1, 1.6, benchBody, 1.9, 0.58, -5.3);
    this.box(9.1, 0.1, 0.06, new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.7 }), 1.9, 0.05, -4.52);
    for (let x = -2.2; x <= 5.8; x += 1.3) {
      this.box(0.015, 0.9, 0.02, new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.8 }), x, 0.62, -4.522);
      this.box(0.24, 0.03, 0.035, this.mat.chrome, x, 0.84, -4.525);
    }
    this.buildFloorMarkings();
    this.buildPosters();
  }

  buildStudioEnvironment() {
    const env=new THREE.Scene();env.background=new THREE.Color(0xc8ced3);
    const room=new THREE.Mesh(new THREE.BoxGeometry(22,14,22),new THREE.MeshBasicMaterial({color:0xe6e9ec,side:THREE.BackSide}));room.position.y=4;env.add(room);
    [[0,10,0,12,0.1,5,0xffffff,3.2],[-8,4,0,0.1,6,7,0xe7f2ff,2.1],[8,4,-3,0.1,5,6,0xfff2dd,1.8],[0,-2,0,20,0.1,20,0x858b92,1]].forEach(p=>{
      const m=new THREE.Mesh(new THREE.BoxGeometry(p[3],p[4],p[5]),new THREE.MeshBasicMaterial({color:p[6]}));m.material.color.multiplyScalar(p[7]);m.position.set(p[0],p[1],p[2]);env.add(m);
    });
    const pmrem=new THREE.PMREMGenerator(this.renderer);this.studioEnvironment=pmrem.fromScene(env,0.06,0.1,100);this.scene.environment=this.studioEnvironment.texture;pmrem.dispose();env.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
  }

  batchStatic(parent, protectedMeshes) {
    // 仅合并已构建的静态环境；交互仪器、动画部件、标签不参与。
    const bins=new Map();parent.updateMatrixWorld(true);
    for(const o of [...parent.children]){
      if(!o.isMesh||(!protectedMeshes&&o.userData.deviceRoot)||(protectedMeshes&&protectedMeshes.has(o))||Array.isArray(o.material)||o.material.transparent||Object.keys(o.userData).some(k=>k!=='deviceRoot')||!o.geometry.attributes.normal||!o.geometry.attributes.uv)continue;
      const key=o.material.uuid+'/'+o.castShadow+'/'+o.receiveShadow;
      if(!bins.has(key))bins.set(key,[]);bins.get(key).push(o);
    }
    for(const objects of bins.values()){
      if(objects.length<2)continue;const pos=[],norm=[],uv=[];
      for(const o of objects){const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(o.matrix);pos.push(...geo.attributes.position.array);norm.push(...geo.attributes.normal.array);uv.push(...geo.attributes.uv.array);geo.dispose();parent.remove(o);}
      const merged=new THREE.BufferGeometry();merged.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));merged.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));merged.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      const m=new THREE.Mesh(merged,objects[0].material);m.castShadow=objects[0].castShadow;m.receiveShadow=objects[0].receiveShadow;
      if(objects[0].userData.deviceRoot){m.userData.deviceRoot=objects[0].userData.deviceRoot;this.interactive=this.interactive.filter(o=>!objects.includes(o));this.interactive.push(m);}
      parent.add(m);
    }
  }

  optimizeStaticEquipment() {
    // 保留所有被动画对象引用的网格；只合并同一父节点下的不透明静态部件。
    const protectedMeshes=new Set(),seen=new Set();
    const visit=(value,depth)=>{
      if(!value||typeof value!=='object'||depth>4||seen.has(value))return;seen.add(value);
      if(value.isObject3D){if(value.isMesh)protectedMeshes.add(value);return;}
      if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return;}
      if(value.constructor===Object)Object.values(value).forEach(v=>visit(v,depth+1));
    };
    for(const [key,value] of Object.entries(this))if(!['interactive','scene','labRoot','crystalRoot','cifRoot','devices','mat','_boxCache'].includes(key))visit(value,0);
    const materialPool=new Map(),groups=[];
    this.labRoot.traverse(o=>{
      if(o.isGroup)groups.push(o);
      if(!o.isMesh||protectedMeshes.has(o)||Array.isArray(o.material)||o.material.transparent||Object.keys(o.userData).some(k=>k!=='deviceRoot'))return;
      const m=o.material;
      const key=[m.type,m.color&&m.color.getHex(),m.emissive&&m.emissive.getHex(),m.emissiveIntensity,m.roughness,m.metalness,m.clearcoat,m.side,m.opacity,m.alphaTest,m.depthWrite,m.depthTest,m.blending,
        ...['map','normalMap','roughnessMap','metalnessMap','bumpMap','envMap'].map(k=>m[k]&&m[k].uuid),m.bumpScale].join('/');
      if(materialPool.has(key))o.material=materialPool.get(key);else materialPool.set(key,o.material);
    });
    groups.reverse().forEach(g=>this.batchStatic(g,protectedMeshes));
  }

  reagentLabel(name,formula,id) {
    const c=document.createElement('canvas');c.width=512;c.height=384;const x=c.getContext('2d');x.fillStyle='#f7f5ed';x.fillRect(0,0,512,384);x.fillStyle='#183d62';x.fillRect(0,0,512,18);x.fillStyle='#172f42';x.font='bold 43px "Microsoft YaHei",sans-serif';x.fillText(name,20,85);x.font='29px sans-serif';x.fillText(formula,20,140);
    const cas={cu:'10031-43-3',btc:'554-95-0',water:'7732-18-5',ethanol:'64-17-5',dmf:'68-12-2'};x.font='23px monospace';x.fillText('CAS '+(cas[id]||'—'),20,198);x.font='22px sans-serif';x.fillText(id==='water'?'去离子 · 实验级':id==='ethanol'?'≥99.7% · 分析纯':'分析纯 · 教学试剂',20,244);x.fillStyle='#536574';x.fillText('MOF STUDIO / LAB REAGENT',20,345);
    if(id!=='water'){x.save();x.translate(438,226);x.rotate(Math.PI/4);x.strokeStyle='#cc363b';x.lineWidth=8;x.strokeRect(-37,-37,74,74);x.restore();x.fillStyle='#20272d';x.font='bold 56px sans-serif';x.fillText('!',428,246);}
    const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;
  }

  addContactLighting() {
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');const g=x.createRadialGradient(64,64,4,64,64,64);g.addColorStop(0,'rgba(23,35,44,.35)');g.addColorStop(0.5,'rgba(23,35,44,.12)');g.addColorStop(1,'rgba(23,35,44,0)');x.fillStyle=g;x.fillRect(0,0,128,128);const t=new THREE.CanvasTexture(c);
    const ca=document.createElement('canvas');ca.width=ca.height=128;const cx=ca.getContext('2d'),gr=cx.createRadialGradient(64,64,20,64,64,58);gr.addColorStop(0,'rgba(195,231,255,0)');gr.addColorStop(.65,'rgba(195,231,255,.6)');gr.addColorStop(1,'rgba(195,231,255,0)');cx.fillStyle=gr;cx.fillRect(0,0,128,128);const ct=new THREE.CanvasTexture(ca);
    for(const id of ['balance','beakerA','beakerB','reactor','centrifuge','water','ethanol']){
      const d=this.devices.get(id);if(!d)continue;const p=d.group.position;
      const ao=new THREE.Mesh(new THREE.PlaneGeometry(1.2,0.9),new THREE.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));ao.rotation.x=-Math.PI/2;ao.position.set(p.x,1.314,p.z);this.labRoot.add(ao);
      if(id.startsWith('beaker')){const caustic=new THREE.Mesh(new THREE.PlaneGeometry(0.85,0.7),new THREE.MeshBasicMaterial({map:ct,transparent:true,opacity:0.1,depthWrite:false,blending:THREE.AdditiveBlending}));caustic.rotation.x=-Math.PI/2;caustic.position.set(p.x+0.15,1.316,p.z+0.18);this.labRoot.add(caustic);}
    }
  }

  updateStudioDetails(dt,now) {
    for(const b of [this.beakerA,this.beakerB]){if(!b||!b.surface)continue;b.surface.visible=b.liquid.visible;b.surface.position.y=b.liquid.position.y+0.25*b.liquid.scale.y+0.003;b.surface.material.color.lerp(b.liquid.material.color,Math.min(1,dt*3));b.surface.rotation.z=Math.sin(now/400)*0.008*this.anim.stirSpeed;}
    if(this._replay){const p=this._replay;p.t+=dt;const d=this.devices.get(p.id);if(d){d.group.rotation.z=p.base+Math.sin(p.t*Math.PI*2)*0.025*(1-Math.min(1,p.t/2));if(p.t>=2){d.group.rotation.z=p.base;this._replay=null;}}}
  }

  replayOperation(id) { if(this._replay){const prev=this.devices.get(this._replay.id);if(prev)prev.group.rotation.z=this._replay.base;}const d=this.devices.get(id);if(!d)return;this.flash(id);if(['pxrd','bet','sem'].includes(id))this.runInstrument(id);else if(id.startsWith('beaker'))this.pour(id);this._replay={id,t:0,base:d.group.rotation.z}; }

  buildFloorMarkings() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#d8ab3c'; x.fillRect(0, 0, 256, 32);
    x.fillStyle = '#20292c';
    for (let i = -32; i < 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 16, 0); x.lineTo(i + 32, 32); x.lineTo(i + 16, 32); x.closePath(); x.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 1);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, transparent: true, opacity: 0.55 });
    // hazard strips near fume hood, sink, and main bench working area
    this.box(3.4, 0.012, 0.16, m, -5.1, 0.014, -4.25, this.labRoot, false);
    this.box(1.9, 0.012, 0.16, m, -6.3, 0.014, -4.4, this.labRoot, false);
    this.box(0.16, 0.012, 3.9, m, 5.3, 0.014, 0, this.labRoot, false);
  }

  buildPosters() {
    // MOF structure chart on back wall
    const c1 = document.createElement('canvas'); c1.width = 512; c1.height = 320;
    const x1 = c1.getContext('2d');
    x1.fillStyle = '#ffffff'; x1.fillRect(0, 0, 512, 320);
    x1.strokeStyle = '#2f6fb3'; x1.lineWidth = 3; x1.strokeRect(12, 12, 488, 296);
    x1.fillStyle = '#1c4e86'; x1.font = 'bold 30px "Microsoft YaHei"'; x1.fillText('MOF 结构示意', 40, 60);
    x1.font = '20px monospace'; x1.fillStyle = '#456b8f';
    x1.fillText('Cu2(COO)4 paddle wheel', 40, 106);
    x1.fillText('BTC linker  C9H3O6', 40, 140);
    x1.fillText('cubic Fm-3m  pore ~9 A', 40, 174);
    // small 2D lattice drawing
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      x1.fillStyle = i % 2 ? '#2f8fc4' : '#8fb6cf';
      x1.fillRect(60 + i * 80, 210 + j * 24, 14, 14);
    }
    const tex1 = new THREE.CanvasTexture(c1); tex1.encoding = THREE.sRGBEncoding;
    const poster1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.375), new THREE.MeshStandardMaterial({ map: tex1, roughness: 0.6 }));
    poster1.position.set(8.4, 3.1, -6.84); poster1.receiveShadow = true; this.labRoot.add(poster1);

    // safety regulation poster on left wall
    const c2 = document.createElement('canvas'); c2.width = 512; c2.height = 320;
    const x2 = c2.getContext('2d');
    x2.fillStyle = '#ffffff'; x2.fillRect(0, 0, 512, 320);
    x2.strokeStyle = '#d09a2c'; x2.lineWidth = 3; x2.strokeRect(12, 12, 488, 296);
    x2.fillStyle = '#8a6210'; x2.font = 'bold 28px "Microsoft YaHei"'; x2.fillText('实验室安全规程', 40, 58);
    x2.font = '18px "Microsoft YaHei"'; x2.fillStyle = '#3f4a52';
    ['1. 实验服 / 护目镜 / 手套必戴', '2. 挥发性操作在通风橱内进行', '3. 含重金属废液单独分类回收', '4. 密闭反应釜冷却后方可开启', '5. 熟悉洗眼器与淋浴器位置'].forEach((t, i) => x2.fillText(t, 40, 100 + i * 34));
    const tex2 = new THREE.CanvasTexture(c2); tex2.encoding = THREE.sRGBEncoding;
    const poster2 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.375), new THREE.MeshStandardMaterial({ map: tex2, roughness: 0.6 }));
    poster2.position.set(-11.1, 3.1, 0.6); poster2.rotation.y = Math.PI / 2; poster2.receiveShadow = true; this.labRoot.add(poster2);
  }

  buildFurniture() {
    this.buildStorage(); this.buildFlammables(); this.buildGasRack(); this.buildUltrasonicBath(); this.buildPhMeter(); this.buildDesiccator();
  }

  buildStorage() {
    const g = new THREE.Group(); g.position.set(-8.4, 0, -5.6); this.labRoot.add(g);
    this.box(2.1, 2.3, 1.2, this.mat.cabinet, 0, 1.15, 0, g);
    this.box(0.95, 2.1, 0.08, this.mat.white, -0.52, 1.15, 0.62, g);
    this.box(0.95, 2.1, 0.08, this.mat.white, 0.52, 1.15, 0.62, g);
    this.box(0.12, 0.34, 0.07, this.mat.chrome, -0.12, 1.2, 0.68, g);
    this.box(0.12, 0.34, 0.07, this.mat.chrome, 0.12, 1.2, 0.68, g);
    const warn = this.label('试剂储存柜', '腐蚀品 / 氧化剂 分开存放', 0.5, false); warn.position.set(0, 2.55, 0.2); g.add(warn);
    this.register(g, 'storage', '试剂储存柜', '腐蚀品与氧化剂分区存放，避免混放', [3.4, 2.4, 4.2]);
  }

  buildFlammables() {
    const g = new THREE.Group(); g.position.set(9.3, 0, -2.4); this.labRoot.add(g);
    this.box(1.7, 1.9, 1.1, new THREE.MeshStandardMaterial({ color: 0xd8ab3c, roughness: 0.55 }), 0, 0.95, 0, g);
    this.box(1.6, 1.7, 0.08, new THREE.MeshStandardMaterial({ color: 0xb8912f, roughness: 0.6 }), 0, 0.95, 0.56, g);
    this.box(0.9, 0.9, 0.06, this.mat.white, 0, 1.0, 0.62, g);
    const l = this.label('易燃品安全柜', 'FLAMMABLES · 远离热源', 0.48, false); l.position.set(0, 2.15, 0.2); g.add(l);
    this.register(g, 'flammable', '易燃品安全柜', '易燃溶剂专柜存放，远离明火与热源', [3, 2.2, 3.8]);
  }

  buildGasRack() {
    const g = new THREE.Group(); g.position.set(7.4, 0, 3.4); this.labRoot.add(g);
    this.box(1.9, 0.2, 0.9, this.mat.dark, 0, 0.1, 0, g);
    ['Ar', 'N₂'].forEach((gas, i) => {
      const x = -0.45 + i * 0.9;
      this.cyl(0.19, 0.19, 1.7, new THREE.MeshStandardMaterial({ color: i ? 0x2b6f7d : 0x3a5460, roughness: 0.42, metalness: 0.6 }), x, 1.0, 0, g);
      this.cyl(0.09, 0.13, 0.22, this.mat.steel, x, 1.95, 0, g);
      this.cyl(0.05, 0.05, 0.16, this.mat.chrome, x, 2.1, 0, g, 10);
    });
    const chain = this.torus(0.95, 0.025, this.mat.chrome, 0, 1.25, 0, g); chain.rotation.x = Math.PI / 2; chain.rotation.z = Math.PI / 2;
    const l = this.label('气体钢瓶架', '固定存放 · 防止倾倒', 0.46, false); l.position.set(0, 2.5, 0.2); g.add(l);
    this.register(g, 'gas', '气体钢瓶架', '钢瓶必须固定，使用时保持通风', [3, 2.2, 4]);
  }

  buildUltrasonicBath() {
    const g = new THREE.Group(); g.position.set(2.6, 1.31, 1.55); this.labRoot.add(g);
    this.box(1.35, 0.62, 1.05, this.mat.white, 0, 0.31, 0, g);
    this.box(1.15, 0.1, 0.88, this.mat.steel, 0, 0.66, 0, g);
    const tank = this.box(1.0, 0.34, 0.75, new THREE.MeshPhysicalMaterial({ color: 0x1f8fa8, transparent: true, opacity: 0.6, roughness: 0.1 }), 0, 0.5, 0, g, false);
    this.ultrasonicTank = tank;
    const panel = this.box(0.95, 0.2, 0.03, this.mat.screen, 0, 0.28, 0.53, g, false); panel.userData.isScreen = true;
    const lid = this.box(1.3, 0.06, 0.98, this.mat.glass, 0, 0.78, 0, g, false);
    this.ultrasonicLid = lid;
    // 水面涟漪环
    for (let i = 0; i < 3; i++) {
      const ring = this.mesh(new THREE.RingGeometry(0.16, 0.2, 32), new THREE.MeshBasicMaterial({
        color: 0x9ff0e6, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false
      }), g, false);
      ring.position.y = 0.63; ring.rotation.x = -Math.PI / 2;
      ring.userData.k = i / 3; ring.visible = false;
      this.ripples.push(ring);
    }
    const l = this.label('超声波分散仪', '40 kHz · 10 min', 0.44, false); l.position.set(0, 1.12, 0); g.add(l);
    this.register(g, 'ultrasonic', '超声波分散仪', '用于前驱体溶液的超声分散与融合', [2.4, 1.8, 3]);
  }

  buildPhMeter() {
    const g = new THREE.Group(); g.position.set(-2.35, 1.31, 1.5); this.labRoot.add(g);
    this.box(0.6, 0.72, 0.5, this.mat.white, 0, 0.36, 0, g);
    this.box(0.45, 0.28, 0.03, this.mat.screen, 0, 0.52, 0.27, g, false).userData.isScreen = true;
    this.box(0.5, 0.16, 0.06, this.mat.dark, 0, 0.14, 0.27, g);
    const rod = this.cyl(0.02, 0.02, 0.9, this.mat.chrome, 0.35, 0.5, 0.32, g, 10); rod.rotation.x = Math.PI / 2.6;
    const probe = this.cyl(0.055, 0.04, 0.26, this.mat.glass, 0.72, 0.2, 0.42, g, 12);
    const l = this.label('pH 计', '可选：监控体系 pH 0.7—1.6', 0.42, false); l.position.set(0, 1.0, 0); g.add(l);
    this.register(g, 'phmeter', 'pH 计', '优化方案中会监控 pH，影响晶相与结晶性', [2.2, 1.7, 3]);
  }

  buildDesiccator() {
    const g = new THREE.Group(); g.position.set(4.35, 1.31, -0.75); this.labRoot.add(g);
    this.cyl(0.46, 0.5, 0.14, this.mat.dark, 0, 0.07, 0, g);
    this.cyl(0.42, 0.46, 0.5, new THREE.MeshPhysicalMaterial({ color: 0xcfe9ea, transparent: true, opacity: 0.28, roughness: 0.06, side: THREE.DoubleSide, depthWrite: false }), 0, 0.4, 0, g, 40);
    this.cyl(0.43, 0.43, 0.06, this.mat.steel, 0, 0.68, 0, g);
    this.sphere(0.12, this.mat.blueSolid, 0, 0.3, 0, g, 12);
    const l = this.label('真空干燥器', '冷却后暂存 · 防吸湿', 0.42, false); l.position.set(0, 1.0, 0); g.add(l);
    this.register(g, 'desiccator', '真空干燥器', '用于活化后样品的防潮冷却与暂存', [2.2, 1.8, 3]);
  }

  buildEquipment() {
    this.buildFumeHood(); this.buildBalance(); this.buildReagents(); this.buildBeakers(); this.buildReactor(); this.buildCentrifuge(); this.buildOven(); this.buildCharacterization(); this.buildSafety(); this.buildDecor(); this.buildAssistant();
  }

  buildFumeHood() {
    const g = new THREE.Group(); g.position.set(-5.1, 1.18, -5.35); this.labRoot.add(g);
    // 底部柜体（橱柜台面以下的支撑柜）
    this.box(3.2, 1.1, 1.82, new THREE.MeshStandardMaterial({ color: 0xeceef0, roughness: 0.58 }), 0, -0.63, 0, g);
    this.box(3.2, 0.1, 0.06, new THREE.MeshStandardMaterial({ color: 0x2f3439, roughness: 0.7 }), 0, -1.13, 0.92, g);
    this.box(3.2, 0.16, 1.85, this.mat.white, 0, 0, 0, g);
    this.box(3.15, 0.25, 1.75, this.mat.white, 0, 2.5, 0, g);
    this.box(0.16, 2.5, 1.75, this.mat.white, -1.5, 1.25, 0, g); this.box(0.16, 2.5, 1.75, this.mat.white, 1.5, 1.25, 0, g);
    this.box(2.85, 2.25, 0.06, new THREE.MeshStandardMaterial({ color: 0x8fa3a4, roughness: 0.7 }), 0, 1.25, -0.82, g);
    this.hoodSash = this.box(2.85, 1.1, 0.035, this.mat.glass, 0, 1.65, 0.86, g, false); this.hoodSash.renderOrder = 3;
    this.box(2.9, 0.08, 0.08, this.mat.chrome, 0, 1.08, 0.89, g);
    this.box(2.5, 0.06, 0.45, new THREE.MeshStandardMaterial({ color: 0xf2ffff, emissive: 0xffffff, emissiveIntensity: 0.8 }), 0, 2.32, 0, g);
    // duct
    this.cyl(0.3, 0.3, 1.1, this.mat.steel, 0, 3.15, -0.3, g, 16);
    // airflow arrows
    for (let i = 0; i < 5; i++) {
      const cone = this.mesh(new THREE.ConeGeometry(0.07, 0.2, 8), new THREE.MeshBasicMaterial({ color: 0x63e5d6, transparent: true, opacity: 0.5 }), g, false);
      cone.position.set(-0.9 + i * 0.45, 2.0, 0.1); cone.rotation.x = Math.PI;
      this.airflows.push(cone);
    }
    // hazard label
    const hz = this.label('当心腐蚀 · 保持通风', 'HOOD IN OPERATION', 0.44, false); hz.position.set(0, 3.15, 0.3); g.add(hz);
    const l = this.label('通风橱', 'FUME HOOD', 0.58); l.position.set(0, 2.62, 0); g.add(l);
    this.register(g, 'hood', '通风橱', '检查通风、风速与防护设施', [3.4, 2.2, 4.5]);
  }

  buildBalance() {
    const g = new THREE.Group(); g.position.set(-3.75, 1.31, 0.45); this.labRoot.add(g);
    this.box(1.35, 0.24, 1.15, this.mat.white, 0, 0.12, 0, g);
    this.box(0.82, 0.06, 0.72, this.mat.steel, 0, 0.29, 0, g);
    this.cyl(0.29, 0.29, 0.035, this.mat.chrome, 0, 0.345, 0, g);
    this.balanceDoor = this.box(1.04, 1.05, 0.035, this.mat.glass.clone(), 0, 0.84, 0.44, g, false);
    this.balanceSideDoors=[-0.52,0.52].map(x=>this.box(0.035,1.05,0.85,this.mat.opticalGlass,x,0.84,0,g,false));
    const bubble=this.sphere(0.033,new THREE.MeshPhysicalMaterial({color:0x9cd88b,roughness:0.12,clearcoat:1}),0.47,0.252,0.45,g,12);bubble.scale.y=0.45;
    this.torus(0.045,0.008,this.mat.chrome,0.47,0.25,0.45,g);
    this.box(1.1, 0.06, 0.94, this.mat.white, 0, 1.4, 0, g);
    this.box(0.035, 1.05, 0.035, this.mat.chrome, -0.5, 0.84, 0.43, g); this.box(0.035, 1.05, 0.035, this.mat.chrome, 0.5, 0.84, 0.43, g);
    this.balanceScreen = this.box(0.72, 0.19, 0.025, this.mat.screen.clone(), 0, 0.14, 0.59, g, false);
    this.balanceScreen.material.map = this.screenTexture(['0.000 g', 'CAL  READY']);
    this.boat = this.cyl(0.19, 0.14, 0.055, this.mat.whiteSolid.clone(), 0, 0.39, 0, g); this.boat.visible = false;
    // 称量舟内粉末堆：高度随加样质量增加（origin 在底部，scale.y = 高度）
    const pg = new THREE.CylinderGeometry(0.125, 0.142, 1, 20); pg.translate(0, 0.5, 0);
    this.boatPowder = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x2a6fc2, roughness: 0.75 }));
    this.boatPowder.scale.y = 0.001; this.boatPowder.position.y = 0.0275; this.boatPowder.visible = false;
    this.boat.add(this.boatPowder);
    this.balancePan = this.cyl(0.29, 0.29, 0.035, this.mat.chrome, 0, 0.345, 0, g);
    const l = this.label('分析天平', '0.1 mg · 容差 ±0.005 g', 0.54); l.position.set(0, 1.7, 0); g.add(l);
    this.register(g, 'balance', '分析天平', '称量舟、去皮与精准加样', [2.6, 1.9, 3.2]);
  }

  bottle(id, name, formula, x, z, material, capColor = 0x263b40, fillMat = null, powder = false) {
    const g = new THREE.Group(); g.position.set(x, 1.31, z); this.labRoot.add(g);
    this.cyl(0.25, 0.28, 0.65, material, 0, 0.34, 0, g);
    this.cyl(0.13, 0.13, 0.19, material, 0, 0.75, 0, g);
    this.cyl(0.15, 0.15, 0.12, new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.6 }), 0, 0.89, 0, g);
    const labelMat = new THREE.MeshStandardMaterial({ map:this.reagentLabel(name,formula,id), roughness: 0.85 });
    this.box(0.46, 0.37, 0.015, labelMat, 0, 0.38, 0.264, g);
    // 瓶内容物：倾倒时可见液位/粉末高度下降（物理反馈）
    let fill = null;
    if (fillMat) fill = powder
      ? this.cyl(0.17, 0.185, 0.18, fillMat, 0, 0.14, 0, g, 20)
      : this.cyl(0.185, 0.2, 0.34, fillMat, 0, 0.24, 0, g, 20);
    // 试剂标识直接贴在瓶身，避免悬浮标签遮挡标签细节。
    this.register(g, id, name, formula + ' · 点击查看试剂信息', [2.1, 1.5, 2.7]);
    this.bottles = this.bottles || {};
    this.bottles[id] = { group: g, baseY: g.position.y, tilt: 0, liquid: fill };
    return g;
  }

  buildReagents() {
    // 硝酸铜瓶改为半透明蓝：能看到瓶内蓝色粉末随倾倒减少
    const cuBody = new THREE.MeshPhysicalMaterial({ color: 0x2f74c8, transparent: true, opacity: 0.82, roughness: 0.14 });
    this.bottle('cu', '三水硝酸铜', 'Cu(NO₃)₂·3H₂O', -4.65, -0.85, cuBody, 0xc9403a, this.mat.blueSolid, true);
    this.bottle('btc', '均苯三甲酸', 'H₃BTC · C₉H₆O₆', -3.7, -1.05, this.mat.whiteSolid, 0x2f6fd2, this.mat.whiteSolid, true);
    this.bottle('water', '去离子水', 'H₂O', -2.75, -1.05, this.mat.glass, 0x2f6fd2, this.mat.clearLiquid.clone());
    this.bottle('ethanol', '无水乙醇', 'C₂H₅OH', -1.85, -1.05, this.mat.opticalAmber, 0x2b3238, new THREE.MeshPhysicalMaterial({ color: 0xe6d3a8, transparent: true, opacity: 0.5, roughness: 0.1 }));
    this.bottle('dmf', 'DMF', 'C₃H₇NO', -0.95, -1.05, new THREE.MeshPhysicalMaterial({ color: 0xb8c4c8, transparent: true, opacity: 0.72, roughness: 0.16 }), 0xc9403a, this.mat.clearLiquid.clone());
    const spatula = this.cyl(0.025, 0.025, 0.85, this.mat.chrome, -2.75, 1.36, 0.75); spatula.rotation.z = Math.PI / 2;
    this.spatula = spatula;
    this.register(spatula, 'spatula', '药匙', '少量多次加样', [1.8, 1.4, 2.2]);
  }

  beaker(id, name, x, z) {
    const g = new THREE.Group(); g.position.set(x, 1.31, z); this.labRoot.add(g);
    // 双壁 Lathe 杯体：外壁-圆弧杯口-内壁，带可见壁厚
    const prof = [[0.30, 0.03], [0.36, 0.05], [0.375, 0.08], [0.40, 0.32], [0.413, 0.60], [0.42, 0.86], [0.425, 0.90], [0.437, 0.922], [0.418, 0.94], [0.40, 0.915], [0.394, 0.86], [0.388, 0.60], [0.372, 0.32], [0.35, 0.10], [0.30, 0.06]];
    const body = this.mesh(new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p[0], p[1])), 48), this.mat.opticalGlass, g, false);
    body.renderOrder = 4;
    this.cyl(0.355, 0.33, 0.035, this.mat.glass, 0, 0.035, 0, g, 48).renderOrder = 4;
    const tickCanvas=document.createElement('canvas');tickCanvas.width=256;tickCanvas.height=512;const tx=tickCanvas.getContext('2d');
    tx.strokeStyle=tx.fillStyle='#ffffff';tx.lineWidth=3;tx.font='bold 28px sans-serif';
    for(let i=1;i<=5;i++){const y=440-i*70;tx.beginPath();tx.moveTo(35,y);tx.lineTo(i%2?95:120,y);tx.stroke();tx.fillText(String(i*10),140,y+10);}tx.font='20px sans-serif';tx.fillText('mL / 20 °C',35,460);
    const ticks=new THREE.CanvasTexture(tickCanvas);ticks.encoding=THREE.sRGBEncoding;
    const decal=this.mesh(new THREE.CylinderGeometry(0.427,0.403,0.77,32,1,true,-0.55,1.1),new THREE.MeshStandardMaterial({map:ticks,transparent:true,depthWrite:false,roughness:0.5,side:THREE.DoubleSide}),g,false);decal.position.y=0.49;decal.renderOrder=6;
    // 双侧白色刻度线（绕杯壁朝外）
    for (let i = 1; i <= 4; i++) {
      [0.62, Math.PI - 0.62].forEach(ang => {
        const tick = this.box(0.055, 0.013, 0.012, this.mat.white, Math.cos(ang) * 0.416, 0.16 + i * 0.15, Math.sin(ang) * 0.416, g, false);
        tick.rotation.y = -ang;
      });
    }
    const liquid = this.cyl(0.375, 0.345, 0.5, this.mat.clearLiquid.clone(), 0, 0.27, 0, g, 40); liquid.scale.y = 0.02; liquid.visible = false;
    const surface=this.mesh(new THREE.CircleGeometry(0.373,40),new THREE.MeshPhysicalMaterial({color:0xd9eef2,transparent:true,opacity:0.46,roughness:0.06,clearcoat:1,side:THREE.DoubleSide,depthWrite:false}),g,false);surface.rotation.x=-Math.PI/2;surface.visible=false;
    const solid = this.cyl(0.29, 0.3, 0.08, this.mat.blueSolid, 0, 0.08, 0, g); solid.visible = false;
    // 搅拌时出现的液面涡流（倒锥面）
    const vortex = this.mesh(new THREE.ConeGeometry(0.32, 0.36, 24, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xd6f4fb, transparent: true, opacity: 0.2, roughness: 0.08, side: THREE.DoubleSide, depthWrite: false }), g, false);
    vortex.position.y = 0.44; vortex.rotation.x = Math.PI; vortex.visible = false;
    // 杯内磁搅拌子（水平胶囊状，搅拌时旋转）
    const barPivot = new THREE.Group(); barPivot.position.y = 0.065; g.add(barPivot);
    const stirBar = this.cyl(0.032, 0.032, 0.1, this.mat.white, 0, 0, 0, barPivot, 12);
    stirBar.rotation.z = Math.PI / 2; barPivot.visible = false;
    const l = this.label(name, '50 mL', 0.46); l.position.set(0, 1.2, 0); g.add(l);
    this.register(g, id, name, '点击进行溶液配制', [2.3, 1.6, 3]);
    return { group: g, liquid, surface, solid, vortex, stirBar: barPivot };
  }

  buildBeakers() {
    this.beakerA = this.beaker('beakerA', '金属盐溶液 A', -1.35, 0.45);
    this.beakerB = this.beaker('beakerB', '配体溶液 B', 0.05, 0.45);
    this.vortexMeshes = [this.beakerA.vortex, this.beakerB.vortex];
    this.stirBars = [this.beakerA.stirBar, this.beakerB.stirBar];
    const g = new THREE.Group(); g.position.set(-0.65, 1.31, 1.35); this.labRoot.add(g);
    this.box(0.9, 0.18, 0.85, this.mat.white, 0, 0.09, 0, g);
    this.cyl(0.34, 0.34, 0.04, this.mat.dark, 0, 0.2, 0, g);
    this.cyl(0.07, 0.07, 0.08, this.mat.black, 0.25, 0.12, 0.43, g).rotation.x = Math.PI / 2;
    this.stirBar = this.box(0.25, 0.04, 0.06, this.mat.white, 0, 0.24, 0, g);
    const l = this.label('磁力搅拌器', '600 rpm', 0.44); l.position.set(0, 0.62, 0); g.add(l);
    this.register(g, 'stirrer', '磁力搅拌器', '促进溶解与均匀混合', [2, 1.5, 2.7]);
  }

  buildReactor() {
    const g = new THREE.Group(); g.position.set(1.65, 1.31, -0.15); this.labRoot.add(g);
    // 加热板（反应时发出橙红辉光）
    this.reactorPlate = this.box(1.45, 0.05, 1.45, this.mat.hotplate, 0, 0.028, 0, g, false);
    this.cyl(0.52, 0.52, 1.05, this.mat.steel, 0, 0.55, 0, g);
    this.cyl(0.57, 0.57, 0.14, this.mat.dark, 0, 0.08, 0, g);
    this.reactorLid = this.cyl(0.59, 0.59, 0.18, this.mat.chrome, 0, 1.15, 0, g);
    this.cyl(0.37, 0.37, 0.93, this.mat.white, 0, 0.58, 0, g);
    this.reactorLiquid = this.cyl(0.34, 0.34, 0.55, this.mat.blueLiquid.clone(), 0, 0.45, 0, g); this.reactorLiquid.visible = false;
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; this.cyl(0.045, 0.045, 0.18, this.mat.dark, Math.cos(a) * 0.46, 1.26, Math.sin(a) * 0.46, g, 12); }
    this.reactorGlow = new THREE.PointLight(0xff8a52, 0, 4.5); this.reactorGlow.position.set(1.65, 1.9, -0.15); this.scene.add(this.reactorGlow);
    // 自生压力表：反应时指针摆动（物理反馈）
    this.cyl(0.17, 0.17, 0.05, this.mat.white, 0.34, 1.32, 0.38, g, 20).rotation.x = Math.PI / 2;
    this.reactorGaugeNeedle = this.box(0.016, 0.13, 0.016, this.mat.red, 0.34, 1.32, 0.415, g, false);
    this.reactorGaugeNeedle.rotation.z = -1.05;
    const l = this.label('水热反应釜', '25 mL · PTFE 内衬', 0.54); l.position.set(0, 1.62, 0); g.add(l);
    this.register(g, 'reactor', '水热反应釜', '组装前驱体并启动溶剂热反应', [2.7, 2.1, 3.4]);
  }

  buildCentrifuge() {
    const g = new THREE.Group(); g.position.set(3.55, 1.31, 0.55); this.labRoot.add(g);
    this.box(1.65, 0.67, 1.45, this.mat.white, 0, 0.34, 0, g);
    this.cyl(0.61, 0.61, 0.12, this.mat.dark, 0, 0.7, 0, g);
    this.rotor = new THREE.Group(); this.rotor.position.y = 0.78; g.add(this.rotor);
    this.cyl(0.18, 0.22, 0.12, this.mat.steel, 0, 0, 0, this.rotor);
    // 8 支离心管改为动态装载：转移/配平时逐支装入，管底带蓝色固体
    this.rotorTubes = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const tube = this.cyl(0.06, 0.035, 0.38, this.mat.glass, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, this.rotor, 16);
      tube.rotation.z = Math.PI / 4; tube.rotation.y = -a;
      const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.14, 12), this.mat.blueSolid);
      liq.position.y = -0.1; tube.add(liq);
      tube.visible = false; liq.visible = false;
      this.rotorTubes.push({ tube, liq });
    }
    this.centrifugeLid = this.cyl(0.68, 0.68, 0.09, this.mat.white, 0, 0.93, 0, g);
    const displayMat = new THREE.MeshStandardMaterial({ map: this.screenTexture(['5000 rpm', '02:30  READY']), emissive: 0x175f56, emissiveIntensity: 0.4 });
    this.box(0.7, 0.23, 0.025, displayMat, 0, 0.39, 0.737, g, false);
    const l = this.label('高速离心机', '5000 rpm · 2.5 min', 0.5); l.position.set(0, 1.32, 0); g.add(l);
    this.register(g, 'centrifuge', '高速离心机', '配平后进行固液分离', [2.8, 2.1, 3.5]);
  }

  buildOven() {
    const g = new THREE.Group(); g.position.set(5.25, 1.2, -5.25); this.labRoot.add(g);
    this.box(2.1, 2.15, 1.55, this.mat.white, 0, 1.08, 0, g);
    // 箱门（绕左侧铰链旋转）
    const door = new THREE.Group(); door.position.set(-1.05, 1.17, 0.78); g.add(door);
    this.box(1.55, 1.2, 0.06, this.mat.cabinet, 0.78, 0, 0, door);
    this.box(1.25, 0.88, 0.035, this.mat.glass, 0.78, 0, 0.04, door, false);
    this.box(0.07, 0.75, 0.09, this.mat.chrome, 1.62, 0, 0.08, door);
    this.ovenDoor = door;
    // 真空表与指针
    const gaugeBase = this.cyl(0.2, 0.2, 0.05, this.mat.white, 0.62, 1.62, 0.8, g, 20);
    gaugeBase.rotation.x = Math.PI / 2;
    const needle = this.box(0.018, 0.15, 0.02, this.mat.red, 0.62, 1.62, 0.83, g, false);
    const pivot = new THREE.Group(); pivot.position.set(0.62, 1.62, 0.83); g.add(pivot);
    this.ovenGauge = needle;
    this.ovenGaugePivot = pivot;
    const displayMat = new THREE.MeshStandardMaterial({ map: this.screenTexture(['120.0 °C', 'VAC  -0.09 MPa'], '#f2c77d'), emissive: 0x684410, emissiveIntensity: 0.45 });
    this.box(1.2, 0.35, 0.025, displayMat, 0, 1.92, 0.8, g, false);
    this.ovenGlow = new THREE.PointLight(0xff9d5c, 0, 4); this.ovenGlow.position.set(5.25, 1.6, -4.9); this.scene.add(this.ovenGlow);
    // 箱内样品瓶：活化步骤手动放入（落下动画见 placeOvenVial）
    this.ovenVial = this.cyl(0.09, 0.09, 0.24, this.mat.glass, 0, 0.62, 0.1, g, 16);
    const vfill = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12), this.mat.blueSolid);
    vfill.position.y = -0.05; this.ovenVial.add(vfill); this.ovenVial.userData.vfill = vfill;
    this.ovenVial.visible = false;
    const l = this.label('真空干燥箱', 'VACUUM OVEN', 0.56); l.position.set(0, 2.42, 0); g.add(l);
    this.register(g, 'oven', '真空干燥箱', '脱除孔道溶剂，完成活化', [3, 2.2, 3.8]);
  }

  buildCharacterization() {
    const defs = [
      ['pxrd', 'X 射线衍射仪', 'PXRD', -1.5, ['2θ  5—50°', 'Cu Kα  λ=1.5406 Å']],
      ['bet', '比表面积分析仪', 'N₂ ADSORPTION · BET', 0.65, ['N₂  77 K', 'BET  READY']],
      ['sem', '扫描电子显微镜', 'SEM', 2.65, ['SE  10.0 kV', 'MAG  50.0 kx']]
    ];
    this.charAnim = { pxrd: false, bet: false, sem: false };
    defs.forEach(([id, name, sub, x, lines]) => {
      const g = new THREE.Group(); g.position.set(x, 1.2, -5.3); this.labRoot.add(g);
      this.box(1.75, 1.4, 1.35, this.mat.white, 0, 0.7, 0, g);
      this.box(1.3, 0.7, 0.04, this.mat.dark, 0, 0.78, 0.7, g);
      const sm = new THREE.MeshStandardMaterial({ map: this.screenTexture(lines), emissive: 0x175f56, emissiveIntensity: 0.45 });
      const screen = this.box(1.05, 0.5, 0.025, sm, 0, 0.79, 0.73, g, false); screen.userData.isScreen = true;
      this.box(0.4, 0.08, 0.3, this.mat.dark, 0.48, 1.48, 0, g);

      /* --- 各仪器专属运动部件 --- */
      if (id === 'pxrd') {
        // 测角仪：样品台 + 可摆动的探测器臂
        this.box(0.5, 0.06, 0.5, this.mat.steel, -0.36, 1.46, 0.2, g);
        const arm = new THREE.Group(); arm.position.set(-0.36, 1.5, 0.2); g.add(arm);
        this.box(0.06, 0.06, 0.82, this.mat.chrome, 0, 0, 0.41, arm);
        this.cyl(0.13, 0.1, 0.2, this.mat.dark, 0, 0, 0.86, arm, 16);
        this.box(0.05, 0.05, 0.16, new THREE.MeshStandardMaterial({ color: 0x2ee6c5, emissive: 0x2ee6c5, emissiveIntensity: 1.1 }), 0, 0, 0.7, arm, false);
        this.pxrdArm = arm;
      } else if (id === 'bet') {
        // 杜瓦瓶：分析时升起包裹样品管
        const dewar = new THREE.Group(); dewar.position.set(0.62, 0.1, 0.28); g.add(dewar);
        this.cyl(0.24, 0.22, 0.62, new THREE.MeshPhysicalMaterial({
          color: 0xdff4ff, transparent: true, opacity: 0.4, roughness: 0.06, metalness: 0.1
        }), 0, 0.31, 0, dewar, 24);
        this.cyl(0.25, 0.25, 0.05, this.mat.steel, 0, 0.63, 0, dewar, 24);
        this.betDewar = dewar;
      } else {
        // SEM：电子束扫描线
        const beam = this.box(0.012, 0.9, 0.012, new THREE.MeshBasicMaterial({
          color: 0x8ff0dc, transparent: true, opacity: 0.55
        }), 0.1, 1.0, 0.24, g, false);
        this.semBeam = beam;
        this.box(0.06, 0.06, 0.06, this.mat.chrome, 0.1, 1.5, 0.24, g, false);
      }

      const l = this.label(name, sub, 0.46); l.position.set(0, 1.75, 0); g.add(l);
      this.register(g, id, name, '点击打开模拟表征工作站', [2.8, 2, 3.5]);
    });
  }

  /** 触发仪器运行动画（用于表征步骤） */
  runInstrument(id, duration = 2600) {
    if (!this.charAnim) return;
    this.charAnim[id] = true;
    clearTimeout(this['_charTimer_' + id]);
    this['_charTimer_' + id] = setTimeout(() => { this.charAnim[id] = false; }, duration);
  }

  buildSafety() {
    const g = new THREE.Group(); g.position.set(-6.2, 0, 2.6); this.labRoot.add(g);
    // emergency shower pipe + head + pull rod
    this.cyl(0.06, 0.06, 2.7, this.mat.chrome, 0, 1.35, 0, g);
    this.cyl(0.28, 0.12, 0.18, this.mat.yellow, 0, 2.62, 0, g);
    this.box(0.5, 0.08, 0.08, this.mat.red, 0.25, 2.15, 0, g);
    // eyewash station
    const basin = this.box(0.62, 0.1, 0.45, this.mat.steel, 0.62, 1.05, 0.1, g, false);
    [-0.15, 0.15].forEach(dx => { this.cyl(0.035, 0.05, 0.14, this.mat.chrome, 0.62 + dx, 1.16, 0.1, g, 10); });
    const l = this.label('安全设施', 'PPE · 洗眼器 · 紧急淋浴', 0.52); l.position.set(0, 2.95, 0); g.add(l);
    this.register(g, 'safety', '安全检查工位', '个人防护与应急设施', [3, 2.2, 4]);
    // fire extinguisher
    const fe = new THREE.Group(); fe.position.set(-7.4, 0, -1.2); this.labRoot.add(fe);
    this.cyl(0.16, 0.16, 0.72, this.mat.red, 0, 0.36, 0, fe);
    this.cyl(0.05, 0.05, 0.18, this.mat.black, 0, 0.78, 0, fe, 10);
    this.box(0.13, 0.03, 0.03, this.mat.black, 0.1, 0.7, 0, fe);
    const l2 = this.label('灭火器', 'FIRE EXTINGUISHER', 0.42, false); l2.position.set(0, 0.98, 0.1); fe.add(l2);
    this.register(fe, 'extinguisher', '灭火器', '熟悉位置与使用方法，定期检查压力', [2.2, 1.8, 3]);
    // spill kit and first aid
    const sk = new THREE.Group(); sk.position.set(-7.4, 0, 0.4); this.labRoot.add(sk);
    this.box(0.6, 0.42, 0.5, this.mat.yellow, 0, 0.21, 0, sk);
    const l3 = this.label('溢液应急箱', 'SPILL KIT', 0.4, false); l3.position.set(0, 0.56, 0.1); sk.add(l3);
    this.register(sk, 'spillkit', '溢液应急箱', '含吸附材料与中和剂，用于泄漏处理', [2.2, 1.8, 3]);
    const fa = new THREE.Group(); fa.position.set(-7.4, 0, 1.1); this.labRoot.add(fa);
    this.box(0.5, 0.5, 0.22, this.mat.white, 0, 0.78, 0, fa);
    this.box(0.06, 0.3, 0.02, this.mat.red, 0, 0.78, 0.12, fa, false);
    this.box(0.3, 0.06, 0.02, this.mat.red, 0, 0.78, 0.12, fa, false);
    const l4 = this.label('急救箱', 'FIRST AID', 0.4, false); l4.position.set(0, 1.12, 0.1); fa.add(l4);
    this.register(fa, 'firstaid', '急救箱', '轻微外伤处理，严重情况立即就医', [2.2, 1.8, 3]);
    // 含铜废液桶：点击确认分类回收检查（步骤 1 设施勾选联动）
    const wb = new THREE.Group(); wb.position.set(-7.35, 0, 2.15); this.labRoot.add(wb);
    this.cyl(0.27, 0.23, 0.58, new THREE.MeshStandardMaterial({ color: 0x2f6fd2, roughness: 0.55 }), 0, 0.29, 0, wb, 20);
    this.cyl(0.29, 0.29, 0.05, this.mat.dark, 0, 0.6, 0, wb, 20);
    this.cyl(0.05, 0.05, 0.1, this.mat.dark, 0.18, 0.68, 0, wb, 10);
    this.box(0.3, 0.22, 0.015, new THREE.MeshStandardMaterial({ color: 0xf1f0e8, roughness: 0.85 }), 0, 0.3, 0.272, wb);
    const l5 = this.label('含铜废液桶', 'Cu WASTE · 分类回收', 0.4, false); l5.position.set(0, 0.92, 0.1); wb.add(l5);
    this.register(wb, 'waste', '含铜废液桶', '点击确认废液分类回收就位', [2.2, 1.8, 3]);
    // 个人防护装备站：实验服 + 护目镜（点击依次穿戴 PPE）
    const ps = new THREE.Group(); ps.position.set(-7.5, 0, -3.3); this.labRoot.add(ps);
    this.box(0.06, 1.5, 1.1, this.mat.white, 0, 1.55, 0, ps);
    this.box(0.4, 0.9, 0.1, new THREE.MeshStandardMaterial({ color: 0xf5f6f7, roughness: 0.8 }), 0.12, 1.3, 0.18, ps);
    this.box(0.3, 0.16, 0.06, new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.4 }), 0.12, 1.95, 0.15, ps);
    [-0.07, 0.07].forEach(dx => this.cyl(0.05, 0.05, 0.03, this.mat.glass, 0.12 + dx, 1.95, 0.19, ps, 12));
    const l6 = this.label('个人防护装备', 'PPE · 实验服/护目镜/手套', 0.4, false); l6.position.set(0.2, 2.5, 0.1); ps.add(l6);
    this.register(ps, 'ppeStation', '个人防护装备', '点击依次穿戴实验服、护目镜、丁腈手套', [2.2, 2, 3]);
    // storage shelf on right
    const shelf = new THREE.Group(); shelf.position.set(7.8, 0, -1.5); this.labRoot.add(shelf);
    for (let y = 0.35; y < 2.8; y += 0.8) this.box(1.5, 0.07, 2.4, this.mat.steel, 0, y, 0, shelf);
    [-0.68, 0.68].forEach(x => [-1.1, 1.1].forEach(z => this.box(0.07, 3, 0.07, this.mat.dark, x, 1.5, z, shelf)));
  }

  cylinderBetween(a, b, radius, material, parent) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
    const m = this.mesh(new THREE.CylinderGeometry(radius, radius, len, 10), material, parent);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()); return m;
  }

  /* ============ 照片同款装饰道具：墙面试剂架 / 锥形瓶 / 试管架 / 移液管 / 铁架台 ============ */
  buildDecor() {
    /* --- 墙面试剂架：琥珀瓶 + 白瓶红/蓝盖 --- */
    const shelf = new THREE.Group(); shelf.position.set(1.9, 0, -6.62); this.labRoot.add(shelf);
    [2.3, 2.88, 3.46].forEach(y => {
      this.box(6.8, 0.05, 0.44, this.mat.benchTop, 0, y, 0, shelf);
      this.box(6.8, 0.03, 0.03, this.mat.chrome, 0, y - 0.005, 0.22, shelf);
    });
    [-2.9, 0, 2.9].forEach(x => this.box(0.06, 1.28, 0.4, this.mat.chrome, x, 2.92, -0.01, shelf));
    let shelfLabelIndex=0;
    const shelfLabels=[['cu','三水硝酸铜','Cu(NO₃)₂·3H₂O'],['ethanol','无水乙醇','C₂H₅OH'],['btc','均苯三甲酸','H₃BTC'],['dmf','DMF','C₃H₇NO'],['water','去离子水','H₂O']];
    const sbottle = (x, y, r, h, bodyMat, capMat) => {
      const bg = new THREE.Group(); bg.position.set(x, y + 0.025, 0); shelf.add(bg);
      this.cyl(r, r, h, bodyMat, 0, h / 2, 0, bg, 18);
      this.cyl(r * 0.42, r * 0.42, h * 0.2, bodyMat, 0, h + h * 0.08, 0, bg, 12);
      this.cyl(r * 0.5, r * 0.5, h * 0.15, capMat, 0, h + h * 0.2, 0, bg, 12);
      const meta=shelfLabels[(shelfLabelIndex++)%shelfLabels.length];
      const tag=new THREE.Mesh(new THREE.PlaneGeometry(r*1.65,h*0.62),new THREE.MeshStandardMaterial({map:this.reagentLabel(meta[1],meta[2],meta[0]),roughness:0.8}));tag.position.set(0,h*0.5,r+0.002);bg.add(tag);
    };
    for (let i = 0; i < 5; i++) sbottle(-2.3 + i * 0.5, 2.3, 0.13, 0.34 + (i % 2) * 0.1, this.mat.amber, this.mat.black);
    for (let i = 0; i < 4; i++) sbottle(-1.4 + i * 0.62, 2.88, 0.14, 0.3 + (i % 3) * 0.09, this.mat.white, i % 2 ? this.mat.capRed : this.mat.capBlue);
    sbottle(1.35, 2.88, 0.1, 0.42, this.mat.glass, this.mat.capBlue);
    sbottle(-0.6, 3.46, 0.17, 0.42, this.mat.amber, this.mat.black);
    sbottle(0.1, 3.46, 0.12, 0.3, this.mat.white, this.mat.capRed);
    sbottle(0.5, 3.46, 0.12, 0.34, this.mat.white, this.mat.capBlue);

    /* --- 锥形瓶（紫色 / 蓝色 / 无色液体） --- */
    const flask = (x, z, liquidMat, scale = 1) => {
      const g = new THREE.Group(); g.position.set(x, 1.31, z); this.labRoot.add(g);
      const prof = [[0.001, 0.04], [0.29, 0.08], [0.28, 0.14], [0.19, 0.40], [0.10, 0.58], [0.092, 0.64], [0.092, 0.88], [0.108, 0.90], [0.086, 0.92], [0.082, 0.87], [0.082, 0.63]].map(p => new THREE.Vector2(p[0] * scale, p[1] * scale));
      const body = this.mesh(new THREE.LatheGeometry(prof, 36), this.mat.glass, g, false); body.renderOrder = 4;
      const lp = [[0.001, 0.05], [0.24, 0.09], [0.165, 0.32], [0.085, 0.5], [0.001, 0.5]].map(p => new THREE.Vector2(p[0] * scale, p[1] * scale));
      this.mesh(new THREE.LatheGeometry(lp, 30), liquidMat, g, false).renderOrder = 3;
      return g;
    };
    flask(-5.25, 0.95, this.mat.purpleLiquid);
    flask(-5.3, 0.2, this.mat.blueLiquid, 0.85);
    flask(5.0, 1.15, this.mat.clearLiquid, 0.8);

    /* --- 试管架（多支彩色试管） --- */
    const rack = new THREE.Group(); rack.position.set(-1.62, 1.31, 1.62); this.labRoot.add(rack);
    this.box(0.66, 0.03, 0.15, this.mat.bench, 0, 0.015, 0, rack);
    [-0.3, 0.3].forEach(x => this.box(0.025, 0.3, 0.15, this.mat.bench, x, 0.16, 0, rack));
    this.box(0.66, 0.028, 0.15, this.mat.bench, 0, 0.3, 0, rack);
    [0xcf4640, 0x2f6fd2, 0x2f8f75, 0xe0af3e, 0x7b3fd4, 0xb8c4c8].forEach((c, i) => {
      const x = -0.25 + i * 0.1;
      this.cyl(0.032, 0.032, 0.3, this.mat.glass, x, 0.2, 0, rack, 12).renderOrder = 4;
      this.cyl(0.024, 0.024, 0.1, new THREE.MeshStandardMaterial({ color: c, roughness: 0.3 }), x, 0.1, 0, rack, 12);
    });

    /* --- 移液管罐（玻璃罐内插 3 支移液管） --- */
    const jar = new THREE.Group(); jar.position.set(0.62, 1.31, 1.62); this.labRoot.add(jar);
    this.cyl(0.09, 0.08, 0.2, this.mat.glass, 0, 0.1, 0, jar, 20).renderOrder = 4;
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Group(); p.position.set((i - 1) * 0.035, 0.18, 0); p.rotation.z = (i - 1) * 0.12; jar.add(p);
      this.cyl(0.011, 0.011, 0.4, this.mat.glass, 0, 0.2, 0, p, 8).renderOrder = 4;
      this.cyl(0.002, 0.011, 0.08, this.mat.glass, 0, -0.04, 0, p, 8).renderOrder = 4;
    }

    /* --- 铁架台 + 滴定管 --- */
    const stand = new THREE.Group(); stand.position.set(1.15, 1.31, 1.5); this.labRoot.add(stand);
    this.box(0.52, 0.045, 0.3, this.mat.black, 0, 0.022, 0, stand);
    this.cyl(0.022, 0.022, 1.05, this.mat.chrome, -0.18, 0.55, -0.08, stand, 12);
    this.cyl(0.015, 0.015, 0.34, this.mat.chrome, -0.02, 1.02, 0.02, stand, 10).rotation.z = Math.PI / 2;
    this.cyl(0.028, 0.028, 0.78, this.mat.glass, 0.14, 0.6, 0.02, stand, 14).renderOrder = 4;
    this.cyl(0.02, 0.02, 0.3, this.mat.purpleLiquid, 0.14, 0.48, 0.02, stand, 12).renderOrder = 3;
    this.box(0.06, 0.035, 0.035, this.mat.chrome, 0.14, 0.18, 0.02, stand);
    this.cyl(0.004, 0.016, 0.06, this.mat.glass, 0.14, 0.13, 0.02, stand, 10).renderOrder = 4;

    /* --- 可点选器材道具：称量舟 / 移液器 / 样品瓶（步骤 2 器材选择的 3D 来源） --- */
    const boatProp = new THREE.Group(); boatProp.position.set(-3.1, 1.31, 1.3); this.labRoot.add(boatProp);
    this.box(0.34, 0.035, 0.24, this.mat.whiteSolid, 0, 0.02, 0, boatProp);
    [0.1, -0.1].forEach(dz => this.box(0.34, 0.05, 0.02, this.mat.whiteSolid, 0, 0.05, dz, boatProp));
    const l7 = this.label('称量舟', '惰性称量容器', 0.32, false); l7.position.set(0, 0.28, 0); boatProp.add(l7);
    this.register(boatProp, 'boatProp', '称量舟', '点击选用称量舟', [1.8, 1.3, 2.2]);

    const pip = new THREE.Group(); pip.position.set(-2.2, 1.31, 1.55); this.labRoot.add(pip);
    pip.rotation.z = 0.06;
    this.cyl(0.05, 0.05, 0.34, new THREE.MeshStandardMaterial({ color: 0x2f6fd2, roughness: 0.4 }), 0, 0.22, 0, pip, 14);
    this.cyl(0.05, 0.048, 0.1, this.mat.white, 0, 0.44, 0, pip, 14);
    this.cyl(0.008, 0.02, 0.16, this.mat.glass, 0, 0.0, 0, pip, 10).renderOrder = 4;
    const l8 = this.label('移液器', '准确量取溶剂', 0.32, false); l8.position.set(0, 0.62, 0); pip.add(l8);
    this.register(pip, 'pipette', '移液器', '点击选用移液器', [1.8, 1.3, 2.2]);

    const vial = new THREE.Group(); vial.position.set(4.55, 1.31, 1.45); this.labRoot.add(vial);
    this.cyl(0.08, 0.08, 0.2, this.mat.glass, 0, 0.1, 0, vial, 16).renderOrder = 4;
    this.cyl(0.055, 0.055, 0.08, this.mat.capBlue, 0, 0.24, 0, vial, 14);
    this.cyl(0.055, 0.06, 0.06, this.mat.blueSolid, 0, 0.05, 0, vial, 12);
    const l9 = this.label('样品瓶', '产物收集', 0.32, false); l9.position.set(0, 0.48, 0); vial.add(l9);
    this.register(vial, 'vial', '样品瓶', '点击选用样品瓶', [1.8, 1.3, 2.2]);
  }

  buildCrystal() {
    const g = this.crystalRoot;
    const spacing = 1.25, n = 3, offset = (n - 1) * spacing / 2;
    const nodePositions = [];
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
      const p = new THREE.Vector3(x * spacing - offset, y * spacing - offset, z * spacing - offset); nodePositions.push({ p, x, y, z });
      const paddle = new THREE.Group(); paddle.position.copy(p); g.add(paddle);
      const c1 = this.sphere(0.115, this.mat.copper, -0.09, 0, 0, paddle, 16); const c2 = this.sphere(0.115, this.mat.copper, 0.09, 0, 0, paddle, 16);
      c1.userData.crystalInfo = 'Cu₂ 桨轮节点：两个 Cu²⁺ 通过羧酸氧桥联，构成 HKUST-1 的二级结构单元。';
      c2.userData.crystalInfo = c1.userData.crystalInfo;
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; this.sphere(0.048, this.mat.oxygen, Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0, paddle, 10); }
    }
    const lookup = new Map(nodePositions.map(o => [`${o.x},${o.y},${o.z}`, o.p]));
    nodePositions.forEach(({ p, x, y, z }) => {
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(([dx, dy, dz]) => {
        const q = lookup.get(`${x + dx},${y + dy},${z + dz}`); if (!q) return;
        const a = p.clone().lerp(q, 0.22), b = p.clone().lerp(q, 0.78);
        const bond = this.cylinderBetween(a, b, 0.047, this.mat.linker, g); bond.userData.crystalInfo = 'BTC 有机连接体：均苯三甲酸去质子化后连接铜节点，形成三维多孔网络。';
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const ring = this.mesh(new THREE.TorusGeometry(0.13, 0.028, 6, 6), this.mat.linker, g); ring.position.copy(mid);
        if (dx) ring.rotation.y = Math.PI / 2; if (dy) ring.rotation.x = Math.PI / 2;
      });
    });
    // Conceptual crystal habit (octahedral HKUST-1 morphology)
    this.crystalHabit = this.mesh(new THREE.OctahedronGeometry(2.25, 0), new THREE.MeshPhysicalMaterial({ color: 0x168fad, transparent: true, opacity: 0.1, roughness: 0.1, metalness: 0.42, side: THREE.DoubleSide, depthWrite: false }), g, false);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(2.26, 0)), new THREE.LineBasicMaterial({ color: 0x54d3d8, transparent: true, opacity: 0.6 })); g.add(edges);
    g.scale.setScalar(0.01);
    const cl = new THREE.PointLight(0x49c8d2, 1.35, 13); cl.position.set(3, 4, 4); g.add(cl);
  }

  /* ============ 真实 CIF 晶体结构查看器 ============ */
  initCIF() {
    if (!window.MOF_CIF_LIBRARY) return;
    const key = window.MOF_CIF_DEFAULT || Object.keys(window.MOF_CIF_LIBRARY)[0];
    this.loadCIF(key);
  }

  loadCIF(key) {
    if (!window.MOF_CIF_LIBRARY || !window.MOF_CIF_LIBRARY[key]) return null;
    const entry = window.MOF_CIF_LIBRARY[key];
    try {
      this.structure = Crys.buildStructure(entry.cif);
      this.structure.meta = entry;
      this.buildCIFStructure(this.structure);
      this.callbacks.onStructureLoad?.(this.structure);
      return this.structure;
    } catch (e) {
      console.error('CIF 解析失败', e);
      this.callbacks.onStructureError?.(e.message || String(e));
      return null;
    }
  }

  /** 若已有 CIF 谱或导入谱，返回缓存 */
  cachedPattern(key, build) {
    this._patternCache = this._patternCache || {};
    if (!this._patternCache[key]) this._patternCache[key] = build();
    return this._patternCache[key];
  }

  /** 由内置真实 CIF 计算参考粉末谱 */
  referencePattern(opts) {
    opts = opts || {};
    const lambda = opts.wavelength || 1.540598;
    const cacheKey = `cif:${lambda}`;
    return this.cachedPattern(cacheKey, () => {
      if (!this.structure) return null;
      return Crys.powderPattern(this.structure, {
        wavelength: lambda, twoThetaMin: 3, twoThetaMax: 55, step: 0.02, fwhm: 0.16, hmax: 14
      });
    });
  }

  /** 清除并重建 CIF 结构（单位胞 + 原子 + 键），并居中对齐到世界原点 */
  buildCIFStructure(structure) {
    if (!this.cifInner) {
      this.cifInner = new THREE.Group();          // 内层组：负责居中偏移，原子/键/晶胞放入其中
      this.cifRoot.add(this.cifInner);
    }
    while (this.cifInner.children.length) {
      const c = this.cifInner.children.pop();
      c.traverse?.(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });
      this.cifInner.remove(c);
    }
    if (!structure) return;

    const cell = structure.cell, M = cell.M;
    const center = fracToCart([0.5, 0.5, 0.5], M);   // 晶胞中心（Å）
    this.cifCenter = center;
    // 让晶胞中心落在 cifInner 的原点 → 缩放后结构正好居中于世界原点
    this.cifInner.position.set(-center[0], -center[1], -center[2]);

    // 单位胞 8 个顶点（分数 0/1 组合）-> 笛卡尔
    const corners = [];
    for (let i = 0; i < 8; i++) {
      const f = [(i & 1) ? 1 : 0, (i & 2) ? 1 : 0, (i & 4) ? 1 : 0];
      corners.push(fracToCart(f, M));
    }
    const edges = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
    const pts = [];
    edges.forEach(([a, b]) => { pts.push(new THREE.Vector3(...corners[a]), new THREE.Vector3(...corners[b])); });
    const cellGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const cellLines = new THREE.LineSegments(cellGeo, new THREE.LineBasicMaterial({ color: 0x4fd8cd, transparent: true, opacity: 0.75 }));
    this.cifInner.add(cellLines);
    this.cifCell = cellLines;

    // 原子：按元素分组，使用 InstancedMesh
    const groups = new Map();
    structure.atoms.forEach((a, idx) => {
      const key = a.el;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(idx);
    });
    const sphere = new THREE.SphereGeometry(1, 18, 14);
    this.cifAtomMeshes = [];
    const dummy = new THREE.Object3D();
    groups.forEach((indices, el) => {
      const info = Crys.elementInfo(el);
      const mat = new THREE.MeshStandardMaterial({
        color: info.color, roughness: info.metal ? 0.28 : 0.55, metalness: info.metal ? 0.85 : 0.1
      });
      const mesh = new THREE.InstancedMesh(sphere, mat, indices.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const r = displayRadius(el);
      indices.forEach((atomIdx, k) => {
        const c = structure.cart[atomIdx];
        dummy.position.set(c[0], c[1], c[2]);
        dummy.scale.setScalar(r);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        mesh.setColorAt?.(k, new THREE.Color(info.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.element = el;
      mesh.userData.indices = indices;
      this.cifInner.add(mesh);
      this.cifAtomMeshes.push(mesh);
    });

    // 化学键：共价键与配位键分开（配位键更细、半透明）
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    [['covalent', 0.052, 0xc9d8d5, 0.95], ['coord', 0.032, 0xe0a35f, 0.55]].forEach(([kind, rad, color, opacity]) => {
      const list = structure.bonds.filter(b => b.kind === kind);
      if (!list.length) return;
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, transparent: opacity < 1, opacity });
      const mesh = new THREE.InstancedMesh(cyl, mat, list.length);
      const up = new THREE.Vector3(0, 1, 0);
      list.forEach((b, k) => {
        const a = structure.cart[b.i], c2 = structure.cart[b.j];
        const from = new THREE.Vector3(a[0], a[1], a[2]);
        const to = new THREE.Vector3(c2[0], c2[1], c2[2]);
        const dir = new THREE.Vector3().subVectors(to, from);
        const len = dir.length();
        dummy.position.copy(from).add(to).multiplyScalar(0.5);
        dummy.scale.set(rad, len, rad);
        dummy.quaternion.setFromUnitVectors(up, dir.clone().normalize());
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.cifInner.add(mesh);
    });

    // 整体缩放到合适的可视尺寸（目标：最长边约 8 个场景单位）
    const longest = Math.max(cell.a, cell.b, cell.c);
    const s = 8 / longest;
    this.cifRoot.scale.setScalar(s);
    this.cifRoot.position.set(0, 0, 0);

    // 结构已居中于世界原点；光源放在 cifRoot 上但按缩放换算到世界坐标
    const light = new THREE.PointLight(0xbfefff, 1.1, 26); light.position.set(6 / s, 7 / s, 8 / s); this.cifRoot.add(light);
    const light2 = new THREE.PointLight(0x59c6d0, 0.7, 20); light2.position.set(-7 / s, 4 / s, -6 / s); this.cifRoot.add(light2);
  }

  /** 显示真实 CIF 结构 / 教学模型 */
  showStructure(mode) {
    this.structureMode = mode;
    const cif = mode === 'cif';
    this.crystalRoot.visible = !cif;
    this.cifRoot.visible = cif;
    this.labRoot.visible = false;
    this.scene.background.set(cif ? 0x061c24 : 0x071e26);
    this.scene.fog.color.set(cif ? 0x061c24 : 0x071e26);
    this.tweenCamera(new THREE.Vector3(5.6, 4.3, 6.6), new THREE.Vector3(0, 0, 0));
  }

  /** 结构视图：控制项 */
  setStructureOptions(opts) {
    this.structureOpts = Object.assign({ showH: true, showCell: true, thermal: false, supercell: 1 }, this.structureOpts || {}, opts);
    this.applyStructureOptions();
  }

  applyStructureOptions() {
    if (!this.structure || !this.cifAtomMeshes) return;
    const o = this.structureOpts;
    if (this.cifCell) this.cifCell.visible = o.showCell;
    this.cifAtomMeshes.forEach(m => { m.visible = o.showH || m.userData.element !== 'H'; });
    this.thermalAmp = o.thermal ? 1 : 0;
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    const el = this.renderer.domElement;
    // GPU 上下文丢失：阻止默认行为后浏览器才会尝试恢复；期间跳过渲染，避免白屏后整套逻辑停摆
    el.addEventListener('webglcontextlost', e => {
      e.preventDefault(); this.contextLost = true;
      this.callbacks.onContextLost?.();
    }, false);
    el.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.degrade();                     // 恢复后直接走轻量配置，降低再次崩溃的概率
      this.callbacks.onContextRestored?.();
    }, false);
    el.addEventListener('pointermove', e => {
      const rect = el.getBoundingClientRect(); this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
      this.mouseEvent = e;
    });
    el.addEventListener('click', e => {
      if (this.dragDistance > 5) return;
      // 点击实验员本体：挥手问候（优先于设备拾取）
      if (!this.crystalMode && this.assistOn && this.assistant) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        if (this.raycaster.intersectObject(this.assistant, true).length) { this.assistantGreet(); return; }
      }
      const hit = this.pick(); if (!hit) return;
      if (hit.object.userData.crystalInfo) { this.callbacks.onCrystalInfo?.(hit.object.userData.crystalInfo); return; }
      if (this.crystalMode && this.structureMode === 'cif' && hit.instanceId !== undefined) {
        const info = this.atomInfo(hit.object.userData.indices?.[hit.instanceId]);
        if (info) { this.highlightAtom(info.index); this.callbacks.onAtomInfo?.(info); return; }
      }
      const root = hit.object.userData.deviceRoot;
      if (root) {
        // 3D 直接操作优先：当前步骤允许对该设备动手操作时，由回调执行动作并返回 true
        const handled = this.callbacks.onDeviceAction ? this.callbacks.onDeviceAction(root.userData.device, root.userData.name) : false;
        if (!handled) this.callbacks.onSelect?.(root.userData.device, root.userData.name);
      }
    });
    el.addEventListener('dblclick', () => { const hit = this.pick(); const root = hit?.object.userData.deviceRoot; if (root) this.focus(root.userData.device); });
    el.addEventListener('pointerdown', e => { this.pointerDown = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => { this.dragDistance = this.pointerDown ? Math.hypot(e.clientX - this.pointerDown[0], e.clientY - this.pointerDown[1]) : 0; });
  }

  pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    let targets;
    if (this.crystalMode && this.structureMode === 'cif') targets = this.cifAtomMeshes || [];
    else if (this.crystalMode) targets = this.crystalRoot.children;
    else targets = this.interactive;
    const hits = this.raycaster.intersectObjects(targets, false); return hits[0];
  }

  /** 点击 CIF 结构中的某个原子时返回的解释信息 */
  atomInfo(i) {
    const st = this.structure; if (!st) return null;
    const a = st.atoms[i]; if (!a) return null;
    const info = Crys.elementInfo(a.el);
    const neighbors = [];
    st.bonds.forEach(b => {
      if (b.i === i) { const o = st.atoms[b.j]; neighbors.push({ el: o.el, label: o.label, d: b.d, kind: b.kind }); }
      else if (b.j === i) { const o = st.atoms[b.i]; neighbors.push({ el: o.el, label: o.label, d: b.d, kind: b.kind }); }
    });
    neighbors.sort((x, y) => x.d - y.d);
    return {
      index: i, symbol: info.symbol, name: info.name, label: a.label,
      frac: a.f, occ: a.occ, u: a.u,
      neighbors: neighbors.slice(0, 6),
      coordLabel: `${info.symbol}–${neighbors.length ? Crys.elementInfo(neighbors[0].el).symbol : '—'}`
    };
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight; if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h);
  }

  /** 轻量渲染：像素比降到 1、关闭阴影并强制重编译材质，用于低端显卡或上下文恢复后 */
  degrade() {
    this.autoDegraded = true;
    this.scene.environment = null;
    this.scene.traverse(o=>{if(o.isMesh&&o.material&&o.material.transmission>0){o.material.transmission=0;o.material.transparent=true;o.material.opacity=0.24;o.material.needsUpdate=true;}});
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.scene.traverse(o => {
      if (o.isLight) { o.castShadow = false; }
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m => { m.needsUpdate = true; });
      }
    });
    this.resize();
  }

  /** 程序化 3D 实验员：白大褂 + 护目镜 + 丁腈手套，同步演示实验并气泡播报（无外部模型） */
  buildAssistant() {
    const g = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: 0xf3f6f8, roughness: 0.62 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8bfa2, roughness: 0.55 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2c3540, roughness: 0.7 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x2a6fc2, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22282e, roughness: 0.4 });
    const mk = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.castShadow = true;
      (parent || g).add(m); return m;
    };
    // 腿（髋部枢轴，行走时前后摆动）
    const legL = new THREE.Group(); legL.position.set(-0.085, 0.5, 0); g.add(legL);
    const legR = new THREE.Group(); legR.position.set(0.085, 0.5, 0); g.add(legR);
    [legL, legR].forEach(leg => {
      mk(new THREE.CylinderGeometry(0.055, 0.05, 0.5, 12), pants, 0, -0.25, 0, leg);
      mk(new THREE.BoxGeometry(0.09, 0.05, 0.16), dark, 0, -0.48, 0.03, leg);
    });
    // 躯干（白大褂）+ 衣领 + 发光胸牌
    const torso = mk(new THREE.BoxGeometry(0.36, 0.56, 0.22), coat, 0, 0.82, 0);
    mk(new THREE.BoxGeometry(0.2, 0.06, 0.24), coat, 0, 1.11, 0);
    mk(new THREE.BoxGeometry(0.09, 0.06, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x1d5650, emissive: 0x2fb8ae, emissiveIntensity: 0.7, roughness: 0.3 }), -0.09, 0.94, 0.115);
    // 手臂（肩部枢轴，行走摆动 / 演示手势）
    const armL = new THREE.Group(); armL.position.set(-0.23, 1.06, 0); g.add(armL);
    const armR = new THREE.Group(); armR.position.set(0.23, 1.06, 0); g.add(armR);
    [armL, armR].forEach(arm => {
      mk(new THREE.CylinderGeometry(0.045, 0.04, 0.46, 12), coat, 0, -0.23, 0, arm);
      mk(new THREE.SphereGeometry(0.05, 12, 8), glove, 0, -0.48, 0, arm);
    });
    // 头（独立组：便于环视 / 点头）+ 头发 + 护目镜
    const head = new THREE.Group(); head.position.set(0, 1.26, 0); g.add(head);
    mk(new THREE.SphereGeometry(0.105, 16, 12), skin, 0, 0, 0, head);
    const hair = mk(new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), dark, 0, 0.012, -0.008, head);
    hair.castShadow = false;
    const goggles = mk(new THREE.BoxGeometry(0.19, 0.05, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55, roughness: 0.15 }), 0, 0.02, 0.1, head);
    goggles.castShadow = false;
    this.assistant = g;
    this.assistParts = { legL, legR, armL, armR, head, torso };
    g.position.set(0, 0, 2.8); g.rotation.y = Math.PI;   // 面向实验台（-z 方向）
    this.labRoot.add(g);
  }

  focus(id) {
    const d = this.devices.get(id); if (!d) return;
    const target = new THREE.Vector3(); d.group.getWorldPosition(target); target.y += 0.55;
    const end = target.clone().add(new THREE.Vector3(...d.focusOffset));
    this.tweenCamera(end, target);
    this.flash(id);
  }

  tweenCamera(position, target) {
    this.cameraTween = { start: performance.now(), duration: 850, fromPos: this.camera.position.clone(), toPos: position, fromTarget: this.controls.target.clone(), toTarget: target };
  }

  overview() {
    this.crystalMode = false; this.labRoot.visible = true; this.crystalRoot.position.set(0, 2.75, 0); this.cifRoot.visible = false;
    this.scene.background.set(0xe8ecef); this.scene.fog.color.set(0xe8ecef);
    this.tweenCamera(new THREE.Vector3(8.8, 5.1, 11.0), new THREE.Vector3(0, 1.45, 0));
    this.updateCrystalVisibility();
  }

  focusForStep(step) {
    const map = { 1: 'safety', 2: 'balance', 3: 'balance', 4: 'beakerA', 5: 'reactor', 6: 'reactor', 7: 'centrifuge', 8: 'centrifuge', 9: 'oven', 10: 'pxrd' };
    if (map[step]) this.focus(map[step]); else this.overview();
  }

  showCrystal(show = true, mode) {
    if (mode) this.structureMode = mode;
    this.crystalMode = show; this.labRoot.visible = !show;
    if (show) {
      const cif = this.structureMode === 'cif' && !!this.structure;
      this.crystalRoot.visible = !cif;
      this.crystalRoot.position.set(0, 0, 0);
      this.cifRoot.visible = !!cif;
      this.scene.background.set(cif ? 0x061c24 : 0x071e26);
      this.scene.fog.color.set(cif ? 0x061c24 : 0x071e26);
      this.crystalRoot.scale.setScalar(Math.max(0.2, this.growth) * 1.35);
      this.tweenCamera(new THREE.Vector3(5.6, 4.3, 6.6), new THREE.Vector3(0, 0, 0));
    } else this.overview();
  }

  flash(id) {
    const d = this.devices.get(id); if (!d) return;
    this.bounce(d.group);
    this.sfx.click();
    const ring = this.mesh(new THREE.RingGeometry(0.55, 0.62, 48), new THREE.MeshBasicMaterial({ color: 0x4de0c4, transparent: true, opacity: 0.8, side: THREE.DoubleSide }), this.scene, false);
    const p = new THREE.Vector3(); d.group.getWorldPosition(p); ring.position.copy(p); ring.position.y += 0.04; ring.rotation.x = -Math.PI / 2;
    const start = performance.now(); const animate = () => { const t = (performance.now() - start) / 1100; ring.scale.setScalar(1 + t * 1.4); ring.material.opacity = Math.max(0, 0.8 * (1 - t)); if (t < 1) requestAnimationFrame(animate); else { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); } }; animate();
  }

  pour(id = 'reactor') {
    const d = this.devices.get(id); if (!d) return;
    this.sfx.pourLiquid(1.0);
    const p = new THREE.Vector3(); d.group.getWorldPosition(p);
    const stream = this.cyl(0.025, 0.04, 0.9, this.mat.blueLiquid.clone(), p.x - 0.3, p.y + 1.3, p.z, this.scene, 12);
    stream.rotation.z = -0.35; const start = performance.now();
    const tick = () => { const t = (performance.now() - start) / 1300; stream.material.opacity = Math.sin(Math.min(1, t) * Math.PI) * 0.75; if (t < 1) requestAnimationFrame(tick); else { this.scene.remove(stream); stream.geometry.dispose(); stream.material.dispose(); } }; tick();
  }

  /** 3D 直接操作 · 通用流柱：从 from 点到 to 点的液体/粉末流，自动淡入淡出并在结束时销毁 */
  stream(from, to, color = 0x9fd8e8, opacity = 0.55, done) {
    this.sfx.pourLiquid(0.9);
    const a = new THREE.Vector3(from[0], from[1], from[2]);
    const b = new THREE.Vector3(to[0], to[1], to[2]);
    const dir = new THREE.Vector3().subVectors(b, a), len = Math.max(0.2, dir.length());
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, roughness: 0.35 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1, 8, 1, true), mat);
    m.scale.set(1, len, 1);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.renderOrder = 6; this.scene.add(m);
    const start = performance.now(), dur = 1150;
    const tick = () => {
      const t = (performance.now() - start) / dur;
      if (t >= 1) {
        this.scene.remove(m); m.geometry.dispose(); m.material.dispose();
        this.splash(b.x, b.y, b.z, color, 7); this.sfx.drip();   // 落液飞溅 + 水滴声
        done?.(); return;
      }
      mat.opacity = opacity * Math.sin(Math.min(1, t) * Math.PI);
      setTimeout(tick, 16);   // 用 setTimeout 驱动：无头/后台环境下 rAF 会冻结
    }; tick();
  }

  /** 3D 直接操作 · 拿起试剂瓶，倾斜到目标上方倒出内容物，再放回原位（全程约 2.2 s） */
  pourFromBottle(id, to, kind = 'liquid', done, swayKey = null) {
    const b = this.bottles && this.bottles[id];
    if (!b) { done?.(); return false; }
    if (this.pourAnim) return false;               // 上一次操作动画尚未结束，忽略本次点击
    const g = b.group, baseY = b.baseY;
    const fill0 = b.liquid ? b.liquid.scale.y : 0;   // 瓶内容物起始高度（倾倒时消耗）
    const from = g.position.clone();
    const toV = new THREE.Vector3(to[0], to[1], to[2]);
    const dirH = new THREE.Vector3(toV.x - from.x, 0, toV.z - from.z);
    if (dirH.lengthSq() < 1e-4) dirH.set(0, 0, 1);
    dirH.normalize();
    // 瓶体朝目标倾倒：绕“侧向轴”正向旋转，使瓶口 (+y) 倒向目标方向
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dirH).normalize();
    const tiltQ = new THREE.Quaternion().setFromAxisAngle(axis, 1.05);
    const idQ = new THREE.Quaternion();
    const powder = kind.indexOf('powder') === 0;
    const color = kind === 'powder-cu' ? 0x2a6fc2 : kind === 'powder-btc' ? 0xeee9dc : (id === 'ethanol' ? 0xd9ecdf : 0x9fd8e8);
    const opacity = powder ? 0.85 : 0.5;
    // 举起并倾斜后的瓶口近似世界坐标
    const mouth = from.clone().addScaledVector(dirH, 0.8).add(new THREE.Vector3(0, 1.02, 0));
    const dir = new THREE.Vector3().subVectors(toV, mouth), len = Math.max(0.2, dir.length());
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0, roughness: 0.35 });
    const s = new THREE.Mesh(new THREE.CylinderGeometry(powder ? 0.035 : 0.028, powder ? 0.06 : 0.05, 1, 8, 1, true), mat);
    s.scale.set(1, len, 1);
    s.position.copy(mouth).add(toV).multiplyScalar(0.5);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    s.renderOrder = 6; s.visible = false; this.scene.add(s);
    this.pourAnim = { g, baseY, s };
    powder ? this.sfx.pourPowder(1.25) : this.sfx.pourLiquid(1.35);
    const start = performance.now(), dur = 2200, lift = 0.5;
    const tick = () => {
      const t = (performance.now() - start) / dur;
      if (t >= 1) {
        g.quaternion.copy(idQ); g.position.y = baseY;
        this.scene.remove(s); s.geometry.dispose(); s.material.dispose();
        this.pourAnim = null;
        if (swayKey && this._sway && this._sway[swayKey] !== undefined) this._sway[swayKey] = 1;   // 落液后液面晃动
        if (powder) this.dustPuff(toV.x, toV.y, toV.z, color); else this.splash(toV.x, toV.y, toV.z, color, 8);   // 粉尘扬起 / 液滴飞溅
        this.sfx.drip();
        done?.(); return;
      }
      // 三段式：提起倾斜（0–0.28）→ 保持倾倒（0.28–0.72）→ 复位（0.72–1）
      let k;
      if (t < 0.28) k = t / 0.28;
      else if (t < 0.72) k = 1;
      else k = 1 - (t - 0.72) / 0.28;
      const e = 1 - Math.pow(1 - k, 3);
      g.quaternion.copy(idQ).slerp(tiltQ, e);
      g.position.y = baseY + lift * e;
      const pouring = t > 0.22 && t < 0.78;
      s.visible = pouring;
      if (pouring) {
        mat.opacity = opacity * Math.sin(Math.min(1, (t - 0.22) / 0.56) * Math.PI);
        if (b.liquid) b.liquid.scale.y = Math.max(0.15, fill0 - 0.4 * Math.min(1, (t - 0.22) / 0.56));   // 瓶内液位/粉末下降
      }
      setTimeout(tick, 16);   // 用 setTimeout 驱动：无头/后台环境下 rAF 会冻结
    }; tick();
    return true;
  }

  /** 3D 直接操作 · 反应釜拧盖：釜盖边下降边旋紧（约 2 圈），结束时与 updateDevices 的密封姿态无缝衔接 */
  screwLid(done) {
    if (!this.reactorLid) { done && done(); return; }
    this.lidScrewing = true;
    this.sfx.whoosh();
    const g = this.reactorLid, start = performance.now(), dur = 1500;
    const y0 = g.position.y, r0 = g.rotation.y, r1 = 0.85 + Math.PI * 4;
    let clanked = false;
    const tick = () => {
      const t = (performance.now() - start) / dur;
      if (!clanked && t > 0.45) { clanked = true; this.sfx.clank(); }   // 旋紧中途金属咬合声
      if (t >= 1) {
        g.position.y = 1.15; g.rotation.y = r1;
        this.lidScrewing = false; this.anim.lidLift = 1;   // 让 updateDevices 从密封姿态继续
        this.sfx.click(); done && done(); return;
      }
      const e = t * t * (3 - 2 * t);
      g.position.y = y0 + (1.15 - y0) * e;
      g.rotation.y = r0 + (r1 - r0) * e;
      setTimeout(tick, 16);
    }; tick();
  }

  /** 3D 直接操作 · 搅拌子落入烧杯底部（k: 'A' | 'B'） */
  dropStirBar(k) { this._stirDrop = { i: k === 'B' ? 1 : 0, t: 0 }; }

  /** 3D 直接操作 · 样品瓶放入真空干燥箱（落下动画） */
  placeOvenVial() {
    if (!this.ovenVial) return;
    this.ovenVial.visible = true; this.ovenVial.position.y = 1.25;
    this.sfx.click();
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 520;
      if (t >= 1) { this.ovenVial.position.y = 0.62; this.sfx.tap(); return; }
      const e = 1 - Math.pow(1 - t, 3);
      this.ovenVial.position.y = 1.25 + (0.62 - 1.25) * e;
      setTimeout(tick, 16);
    }; tick();
  }

  /** 离心管装载：n=4 转移产物（带蓝色固体），n=8 对称配平；逐支落入并伴随咔哒声 */
  loadTubes(n) {
    if (!this.rotorTubes) return;
    n = Math.max(0, Math.min(8, n | 0));
    const prev = this._tubeCount || 0;
    if (n === prev) { this.rotorTubes.forEach((t, i) => { t.tube.visible = i < n; }); return; }
    this._tubeCount = n;
    if (n < prev) { this.rotorTubes.forEach((t, i) => { t.tube.visible = i < n; t.liq.visible = false; }); return; }
    if (prev === 0 && n > 0) this._tubesDrained = false;
    this.rotorTubes.forEach((t, i) => {
      setTimeout(() => {
        t.tube.visible = i < n;
        if (i < n) { this.sfx.click(); t.liq.visible = i < 4 && !this._tubesDrained; }
      }, 130 * i);
    });
    if (n >= 8) this.rotorWobble = 1;   // 配平检查：转子轻微晃动后恢复
  }

  /** 离心结束 · 弃上清：管内液体逐支排空 + 一股废液流 */
  pourOutTubes() {
    if (!this.rotorTubes) return;
    this._tubesDrained = true;
    this.sfx.pourLiquid(1.1);
    this.rotorTubes.forEach((t, i) => setTimeout(() => { t.liq.visible = false; }, 100 * i));
    this.stream([3.55, 1.72, 0.55], [3.55, 1.42, 1.75], 0xbfe3ea, 0.5);
  }

  /** 反应釜蒸汽粒子（白色半透明小球上升膨胀消散） */
  spawnSteam(x, y, z) {
    if (this.steam.length > 30) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.04, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }));
    m.position.set(x + (Math.random() - 0.5) * 0.25, y, z + (Math.random() - 0.5) * 0.25);
    m.userData.life = 0; m.userData.vy = 0.32 + Math.random() * 0.25;
    this.labRoot.add(m); this.steam.push(m);
  }

  updateSteam(dt) {
    for (let i = this.steam.length - 1; i >= 0; i--) {
      const s = this.steam[i]; s.userData.life += dt;
      s.position.y += dt * s.userData.vy;
      const k = s.userData.life / 1.8;
      s.scale.setScalar(1 + k * 2.2);
      s.material.opacity = Math.max(0, 0.16 * (1 - k));
      if (k >= 1) { this.labRoot.remove(s); s.geometry.dispose(); s.material.dispose(); this.steam.splice(i, 1); }
    }
  }

  /** 点击设备回弹：轻微放大后弹回（物理反馈） */
  bounce(g) {
    if (!g) return;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 380;
      if (t >= 1) { g.scale.setScalar(1); return; }
      g.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.045);
      setTimeout(tick, 16);
    }; tick();
  }

  /** 3D 直接操作 · 动态提示：先把所有设备恢复默认提示，再应用当前步骤的操作提示 */
  applyHints(map = {}) {
    if (!this._baseHints) { this._baseHints = {}; this.devices.forEach((d, id) => { this._baseHints[id] = d.hint; }); }
    this.devices.forEach((d, id) => {
      const h = map[id] || this._baseHints[id];
      d.hint = h; d.group.userData.hint = h;
    });
  }

  setGrowth(v) { this.growth = Math.max(0, Math.min(1, v)); this.updateCrystalVisibility(); }
  updateCrystalVisibility() {
    const shouldShow = this.crystalMode || this.growth > 0;
    const cif = this.crystalMode && this.structureMode === 'cif' && !!this.structure;
    this.crystalRoot.visible = shouldShow && !cif;
    if (!this.crystalMode) this.crystalRoot.scale.setScalar(Math.max(0.01, this.growth) * 0.52);
    if (this.cifRoot) this.cifRoot.visible = !!cif;
  }

  /** 高亮被点击的原子（发光环，自动淡出） */
  highlightAtom(i) {
    if (!this.structure || !this.cifInner) return;
    const c = this.structure.cart[i];
    const ring = this.mesh(new THREE.SphereGeometry(0.9, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7ff5e2, transparent: true, opacity: 0.42, wireframe: true }), this.cifInner, false);
    ring.position.set(c[0], c[1], c[2]);
    const t0 = performance.now();
    const tick = () => {
      const k = (performance.now() - t0) / 1500;
      const s = 1 + k * 1.9;
      ring.scale.setScalar(s);
      ring.material.opacity = Math.max(0, 0.42 * (1 - k));
      if (k < 1) requestAnimationFrame(tick);
      else { this.cifInner.remove(ring); ring.geometry.dispose(); ring.material.dispose(); }
    };
    tick();
  }

  /** 热振动动画：振幅正比于 √U_iso，模拟原子热位移椭球的整体效果 */
  animateThermal(now) {
    if (!this.structure || !this.cifAtomMeshes) return;
    // CIF 未给出 U_iso 时的教学默认值（Å²）：轻原子热位移更大
    const U_DEFAULT = { H: 0.060, C: 0.045, N: 0.045, O: 0.045, F: 0.045, S: 0.040 };
    const dummy = this._dummy || (this._dummy = new THREE.Object3D());
    this.cifAtomMeshes.forEach(mesh => {
      const indices = mesh.userData.indices || [];
      indices.forEach((atomIdx, k) => {
        const a = this.structure.atoms[atomIdx], c = this.structure.cart[atomIdx];
        const u = (a.u && a.u > 0) ? a.u : (U_DEFAULT[Crys.elementInfo(a.el).symbol] || 0.030);
        const amp = Math.sqrt(u) * 1.8 * this.thermalAmp;
        const p = k * 0.61;
        dummy.position.set(
          c[0] + Math.sin(now / 205 + p) * amp,
          c[1] + Math.cos(now / 168 + p * 1.27) * amp,
          c[2] + Math.sin(now / 237 + p * 0.63) * amp
        );
        dummy.scale.setScalar(displayRadius(a.el));
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /* ============ 仪器交互动画 ============ */
  updateDevices(dt, now) {
    if(this._balanceTarget!==undefined){
      this._balanceDisplay=(this._balanceDisplay||0)+(this._balanceTarget-(this._balanceDisplay||0))*Math.min(1,dt*7);
      const text=this._balanceDisplay.toFixed(3)+(this._balanceTared?' NET':' GROSS');
      if(text!==this._balanceText && now-(this._balancePaint||0)>85){
        this._balanceText=text;this._balancePaint=now;const old=this.balanceScreen.material.map;
        this.balanceScreen.material.map=this.screenTexture([this._balanceDisplay.toFixed(3)+' g',this._balanceTared?'NET  STABLE':'GROSS  MASS']);this.balanceScreen.material.needsUpdate=true;if(old)old.dispose();
      }
    }
    const a = this.anim, ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);

    /* --- 分析天平：防风门开合 + 托盘稳衡摆动 --- */
    if (this.balanceDoor) {
      const target = this.stirring ? 0 : (this.balanceOpen ? 1 : 0);
      a.balanceDoor += (target - a.balanceDoor) * Math.min(1, dt * 5.5);
      this.balanceDoor.position.x = a.balanceDoor * 0.62;
      if(this.balanceSideDoors)this.balanceSideDoors.forEach(d=>d.position.z=-a.balanceDoor*0.52);
      this.balanceDoor.material.opacity = 0.2 - a.balanceDoor * 0.1;
    }
    if (this.balancePan) {
      a.balanceWobble *= Math.exp(-dt * 4.2);
      this.balancePan.position.y = 0.345 + Math.sin(now / 90) * a.balanceWobble;
      this.balancePan.rotation.z = Math.sin(now / 110) * a.balanceWobble * 0.5;
    }
    if (this.boat && this.boat.visible) {
      a.boatDrop = Math.min(1, a.boatDrop + dt * 3.2);
      const e = ease(a.boatDrop);
      this.boat.position.y = 0.39 + (1 - e) * 0.55;
      this.boat.material.opacity = e;
    }

    /* --- 磁力搅拌器：转速缓升 + 液面涡流 --- */
    const stirTarget = this.stirring ? 1 : 0;
    a.stirSpeed += (stirTarget - a.stirSpeed) * Math.min(1, dt * 2.6);
    if (this.stirBar) this.stirBar.rotation.y += dt * 19 * a.stirSpeed;
    a.vortex += (stirTarget - a.vortex) * Math.min(1, dt * 2.2);
    if (this.vortexMeshes) {
      this.vortexMeshes.forEach(m => {
        m.visible = a.vortex > 0.04;
        m.rotation.y -= dt * (2.4 + 3.6 * a.vortex);
        m.scale.set(0.35 + 0.65 * a.vortex, 0.55 + 0.85 * a.vortex, 0.35 + 0.65 * a.vortex);
        m.material.opacity = 0.16 + 0.3 * a.vortex;
      });
    }
    if (this.stirBars) {
      this.stirBars.forEach(b => {
        b.visible = a.stirSpeed > 0.04;
        b.rotation.y += dt * 24 * a.stirSpeed;
      });
    }
    // 搅拌子落入烧杯：从上方沉到杯底
    if (this._stirDrop && this.stirBars) {
      const d = this._stirDrop; d.t = Math.min(1, d.t + dt * 2.2);
      const e = 1 - Math.pow(1 - d.t, 3);
      this.stirBars[d.i].position.y = 0.065 + (1 - e) * 0.5;
      if (d.t >= 1) { this.stirBars[d.i].position.y = 0.065; this.sfx.tap(); this._stirDrop = null; }
    }
    // 搅拌时液面偶发小气泡（物理反馈）
    if (a.stirSpeed > 0.5) {
      ['A', 'B'].forEach(k => {
        const b = k === 'A' ? this.beakerA : this.beakerB;
        if (b && b.liquid.visible && Math.random() < dt * 2.2) {
          const bp = b.group.position;
          this.spawnBubble({ x: bp.x, y: 1.31 + 0.3 * b.liquid.scale.y + 0.06, z: bp.z });
          if (Math.random() < 0.3) this.sfx.bubble();
        }
      });
    }

    /* --- 水热釜：釜盖下降 + 旋紧 + 加热辉光 + 蒸汽 + 压力表 --- */
    if (this.reactorLid && !this.lidScrewing) {
      const want = (this.assemblySealed || this.reactionStarted) ? 1 : 0;
      a.lidLift += (want - a.lidLift) * Math.min(1, dt * 3.4);
      const e = ease(a.lidLift);
      this.reactorLid.position.y = 1.52 - e * 0.37;
      this.reactorLid.rotation.y = e * 0.85;
    }
    if (this.reactorGlow) {
      const on = this.reactionStarted && !this.reactionCooled;
      this.reactorGlow.intensity = on ? 0.85 + Math.sin(now / 380) * 0.28 : Math.max(0, this.reactorGlow.intensity - dt * 2);
    }
    if (this.reactorPlate) {
      const hot = (this.reactionStarted && !this.reactionCooled) ? 0.7 + Math.sin(now / 300) * 0.18 : 0;
      this.mat.hotplate.emissiveIntensity += (hot - this.mat.hotplate.emissiveIntensity) * Math.min(1, dt * 3);
    }
    if (this.reactorLiquid && this.reactorLiquid.visible) {
      this.reactorLiquid.rotation.y += dt * (this.stirring ? 1.4 : 0.12);
    }
    // 反应中：釜口冒蒸汽 + 自生压力表指针摆动
    if (this.reactionStarted && !this.reactionCooled) {
      if (Math.random() < dt * 7) this.spawnSteam(1.65, 2.0, -0.15);
      if (this.reactorGaugeNeedle) {
        const target = -0.32 + Math.sin(now / 430) * 0.2 + Math.sin(now / 97) * 0.05;
        this.reactorGaugeNeedle.rotation.z += (target - this.reactorGaugeNeedle.rotation.z) * Math.min(1, dt * 3);
      }
    } else if (this.reactorGaugeNeedle) {
      this.reactorGaugeNeedle.rotation.z += (-1.05 - this.reactorGaugeNeedle.rotation.z) * Math.min(1, dt * 2);
    }

    /* --- 离心机：盖门开合 + 转子转速缓升缓降 + 运行微振 --- */
    if (this.centrifugeLid) {
      const want = this.centrifuging ? 0 : (this.centrifugeOpen ? 1 : 0);
      a.spinLid += (want - a.spinLid) * Math.min(1, dt * 4);
      this.centrifugeLid.position.y = 0.93 + a.spinLid * 0.16 + (this.centrifuging ? Math.sin(now / 42) * 0.008 * a.rotorSpeed : 0);
      this.centrifugeLid.rotation.z = a.spinLid * 0.22;
    }
    if (this.rotor) {
      const want = this.centrifuging ? 1 : 0;
      a.rotorSpeed += (want - a.rotorSpeed) * Math.min(1, dt * 1.9);
      this.rotor.rotation.y += dt * 34 * a.rotorSpeed;
      if (this.rotorWobble > 0) {
        this.rotorWobble = Math.max(0, this.rotorWobble - dt * 0.8);
        this.rotor.rotation.z = Math.sin(now / 70) * 0.05 * this.rotorWobble;
      } else if (this.rotor.rotation.z) this.rotor.rotation.z *= Math.max(0, 1 - dt * 6);
    }

    /* --- 真空干燥箱：门开合 + 加热丝 + 真空表指针 --- */
    if (this.ovenDoor) {
      const want = this.activating ? 0 : (this.ovenOpen ? 1 : 0);
      a.ovenDoor += (want - a.ovenDoor) * Math.min(1, dt * 3.2);
      this.ovenDoor.rotation.y = -a.ovenDoor * 1.15;
    }
    if (this.ovenGlow) {
      const on = !!this.activating;
      this.ovenGlow.intensity = on ? 1.05 + Math.sin(now / 300) * 0.3 : Math.max(0, this.ovenGlow.intensity - dt * 2);
    }
    if (this.ovenGauge) {
      const want = this.activating ? 1 : (this.vacuumOn ? 0.45 : 0);
      a.gauge += (want - a.gauge) * Math.min(1, dt * 1.4);
      this.ovenGauge.rotation.z = -2.1 + a.gauge * 1.75 + Math.sin(now / 260) * 0.035 * a.gauge;
    }

    /* --- 超声波分散仪：水面涟漪 + 空化气泡 --- */
    if (this.sonicating && this.ultrasonicTank) {
      const p = this.ultrasonicTank.position;
      if (Math.random() < 0.55) this.spawnBubble(p);
    }
    this.updateBubbles(dt);
    this.updateRipples(dt);

    /* --- 通风橱：视窗升降 --- */
    if (this.hoodSash) {
      const want = this.hoodActive ? 0.42 : 0;
      a.sash += (want - a.sash) * Math.min(1, dt * 3);
      this.hoodSash.position.y = 1.65 + a.sash * 0.5;
    }

    /* --- 表征仪器运行动画 --- */
    const ca = this.charAnim || {};
    // PXRD 测角仪：探测器臂 5°→65° 往复扫描
    if (this.pxrdArm) {
      if (ca.pxrd) { a.pxrdArm += dt * 0.42; if (a.pxrdArm > Math.PI * 2) a.pxrdArm -= Math.PI * 2; }
      else a.pxrdArm += (0 - a.pxrdArm) * Math.min(1, dt * 3);
      const sweep = ca.pxrd ? Math.sin(a.pxrdArm) : 0;
      this.pxrdArm.rotation.y = sweep * 0.62;
    }
    // BET：杜瓦瓶升降
    if (this.betDewar) {
      const want = ca.bet ? 1 : 0;
      a.betDewar += (want - a.betDewar) * Math.min(1, dt * 1.8);
      this.betDewar.position.y = 0.1 + a.betDewar * 0.42;
    }
    // SEM：电子束逐行扫描
    if (this.semBeam) {
      const want = ca.sem ? 1 : 0;
      a.semScan += (want - a.semScan) * Math.min(1, dt * 2.4);
      const y = 1.0 - Math.sin(now / 420) * 0.16 * a.semScan;
      this.semBeam.position.y = y;
      this.semBeam.material.opacity = 0.2 + 0.45 * a.semScan;
    }

    // 气瓶压力表指针：运行时轻微抖动
    if (this.gasNeedles) {
      this.gasNeedles.forEach((n, i) => { n.rotation.z = -1.9 + (this.charAnim?.bet ? 0.12 : 0) + Math.sin(now / 900 + i) * 0.02; });
    }

    /* --- 液位/粉末平滑趋近（倾倒后缓缓上升，而非瞬间跳变） --- */
    const L = this._liqTarget;
    if (L) {
      ['A', 'B'].forEach(k => {
        const b = k === 'A' ? this.beakerA : this.beakerB; if (!b) return;
        const t = L[k], kk = Math.min(1, dt * 3);
        b.liquid.scale.y += (t.s - b.liquid.scale.y) * kk;
        b.liquid.position.y += (t.y - b.liquid.position.y) * kk;
      });
      if (this.reactorLiquid) this.reactorLiquid.scale.y += (L.reactor - this.reactorLiquid.scale.y) * Math.min(1, dt * 2.5);
    }
    // 倾倒后液面晃动（衰减摆动）
    if (this._sway) {
      ['A', 'B'].forEach(k => {
        const s = this._sway[k]; if (!s) return;
        this._sway[k] = Math.max(0, s - dt * 0.75);
        const liq = (k === 'A' ? this.beakerA : this.beakerB).liquid;
        liq.rotation.z = Math.sin(now / 120) * 0.06 * s;
        liq.rotation.x = Math.cos(now / 95) * 0.045 * s;
      });
    }
    // 称量舟粉末堆高度趋近
    if (this.boatPowder) this.boatPowder.scale.y += (this._powTarget - this.boatPowder.scale.y) * Math.min(1, dt * 4);
    this.updateSteam(dt);

    /* --- 循环音效状态机： flags 变化时启停对应合成音 --- */
    const S = this.sfx;
    const w = (k, v, on, off) => { if (this._snd[k] !== v) { this._snd[k] = v; try { v ? on() : off(); } catch (e) { } } };
    w('stir', a.stirSpeed > 0.05, () => S.loopStart('stir'), () => S.loopStop('stir'));
    w('cent', !!this.centrifuging, () => S.loopStart('cent'), () => S.loopStop('cent'));
    w('sonic', !!this.sonicating, () => S.loopStart('sonic'), () => S.loopStop('sonic'));
    w('heat', !!this.reactionStarted && !this.reactionCooled, () => S.loopStart('heat'), () => S.loopStop('heat'));
    w('vac', !!this.activating || !!this.vacuumOn, () => S.loopStart('vac'), () => S.loopStop('vac'));
  }

  spawnBubble(base) {
    if (this.bubbles.length > 26) return;
    const geo = new THREE.SphereGeometry(0.022 + Math.random() * 0.02, 8, 6);
    const m = this.mesh(geo, new THREE.MeshPhysicalMaterial({
      color: 0xdff7ff, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0
    }), this.labRoot, false);
    m.position.set(base.x + (Math.random() - 0.5) * 0.78, base.y - 0.1, base.z + (Math.random() - 0.5) * 0.55);
    m.userData.life = 0;
    this.bubbles.push(m);
  }

  updateBubbles(dt) {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.userData.life += dt;
      b.position.y += dt * (0.34 + Math.random() * 0.18);
      b.material.opacity = Math.max(0, 0.55 * (1 - b.userData.life / 0.85));
      if (b.userData.life > 0.85) {
        this.labRoot.remove(b); b.geometry.dispose(); b.material.dispose(); this.bubbles.splice(i, 1);
      }
    }
  }

  updateRipples(dt) {
    const active = this.sonicating;
    this.ripples.forEach(r => {
      if (!active) return;
      r.userData.k += dt * 1.5;
      if (r.userData.k > 1) r.userData.k -= 1;
      const k = r.userData.k;
      r.scale.setScalar(0.35 + k * 0.85);
      r.material.opacity = 0.4 * (1 - k);
    });
  }

  /* ---------------- 3D 实验员控制（同步演示 · 无障碍辅助） ---------------- */

  /** 让助手走到 (x, z)，到达后转向 faceV3 并执行 after */
  assistantGoTo(x, z, faceV3, after) {
    const a = this.assist;
    a.tx = x; a.tz = z;
    a.faceV = faceV3 ? faceV3.clone() : null;
    a.after = after || null;
    a.mode = 'walk';
  }

  /** 走到某设备旁（站在设备前方走道侧） */
  assistantGoToDevice(id, after) {
    const d = this.devices.get(id); if (!d) return;
    const p = new THREE.Vector3(); d.group.getWorldPosition(p);
    this.assistantGoTo(p.x, Math.min(4.6, p.z + 1.15), p, after);
  }

  /** 用户对设备执行操作后调用：助手同步走到该设备旁并做演示手势 */
  assistantSync(id) {
    if (!this.assistOn || !this.assistant) return;
    const d = this.devices.get(id); if (!d) return;
    const p = new THREE.Vector3(); d.group.getWorldPosition(p);
    const g = this.assistant;
    const distSq = (p.x - g.position.x) ** 2 + (p.z - g.position.z) ** 2;
    if (distSq > 2.6 * 2.6) this.assistantGoToDevice(id, () => this.assistantGesture());
    else { this.assist.faceV = p.clone(); this.assistantGesture(); }
  }

  /** 演示手势：type = point 指向设备 / cheer 双臂欢呼 / wave 挥手问候 / no 摇头摊手 */
  assistantGesture(type = 'point') {
    const a = this.assist;
    if (a.mode === 'walk') return;
    a.gestureType = type;
    a.gesture = type === 'point' ? 1.15 : (type === 'wave' ? 2.0 : 1.5);
    if (type === 'cheer') this.sfx.clap(); else this.sfx.tap();
  }

  /** 完成步骤时的庆祝动作（双臂高举欢呼 + 拍手 + 轻跳） */
  assistantCelebrate() {
    this.assistantGesture('cheer');
    this.bounce(this.assistant);
  }

  /** 打招呼（点击助手本体触发）：挥手并随机说一句引导语 */
  assistantGreet() {
    if (this.assist.mode === 'walk') return;
    this.assistantGesture('wave');
    const lines = ['你好，我是实验助手，点击设备我可以同步演示', '不确定怎么做时，跟着我的动作一起操作', '我在实验室里陪着你，安全第一'];
    this.assistantSay(lines[Math.floor(Math.random() * lines.length)], 4.5);
  }

  /** 操作失误反应：摇头 + 摊手（由 sfx.error 挂钩自动触发） */
  assistantDisapprove() {
    if (!this.assistOn || !this.assistant || this.assist.mode === 'walk') return;
    this.assist.gestureType = 'no';
    this.assist.gesture = Math.max(this.assist.gesture, 1.6);
  }

  /** 助手头顶气泡字幕（无障碍播报：与界面操作同步，淡入淡出，说话期间配合点头与手部比划） */
  assistantSay(text, dur = 5) {
    if (!this.assistant) return;
    const g = this.assistant;
    if (this.assist.bubble) {
      g.remove(this.assist.bubble);
      this.assist.bubble.material.map?.dispose();
      this.assist.bubble.material.dispose();
      this.assist.bubble = null;
    }
    const sp = this.label('实验助手', text, 0.62, true);
    sp.position.set(0, 1.78, 0);
    sp.material.opacity = 0;   // 初始透明，由 updateAssistant 驱动淡入，避免闪现
    g.add(sp);
    this.assist.bubble = sp; this.assist.bubbleT = dur; this.assist.bubbleDur = dur; this.assist.speak = dur;
  }

  /** 步骤切换时同步走位：按步骤号前往对应工位并播报步骤标题 */
  assistantGoToStep(step, title) {
    const map = { 0: 'storage', 1: 'ppeStation', 2: 'balance', 3: 'balance', 4: 'beakerA', 5: 'reactor', 6: 'reactor', 7: 'centrifuge', 8: 'centrifuge', 9: 'oven', 10: 'pxrd', 11: 'storage', 12: 'storage' };
    const id = map[step]; if (!id) return;
    this.assistantGoToDevice(id, () => this.assistantGesture());
    if (title) this.assistantSay(title, 4.5);
  }

  /** 显示 / 隐藏助手（无障碍开关） */
  toggleAssistant(on) {
    this.assistOn = on === undefined ? !this.assistOn : !!on;
    this.assistant.visible = this.assistOn;
    return this.assistOn;
  }

  /* ---------------- 物理反馈扩展：液滴飞溅 / 粉尘扬起 / 镜头震动 ---------------- */

  /** 液滴飞溅粒子（上抛受重力，渐隐消散） */
  splash(x, y, z, color = 0x9fd8e8, n = 9) {
    for (let i = 0; i < n; i++) {
      if (this.drops.length > 60) break;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.014 + Math.random() * 0.014, 8, 6),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.75, roughness: 0.25 }));
      m.position.set(x, y, z);
      this.scene.add(m);
      this.drops.push({ m, vx: (Math.random() - 0.5) * 0.9, vy: 0.55 + Math.random() * 0.5, vz: (Math.random() - 0.5) * 0.9, life: 0.7 });
    }
  }

  /** 粉尘扬起粒子（膨胀渐隐） */
  dustPuff(x, y, z, color = 0xeee9dc) {
    for (let i = 0; i < 8; i++) {
      if (this.dusts.length > 40) break;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.03 + Math.random() * 0.025, 8, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34, depthWrite: false }));
      m.position.set(x + (Math.random() - 0.5) * 0.1, y, z + (Math.random() - 0.5) * 0.1);
      this.scene.add(m);
      this.dusts.push({ m, vx: (Math.random() - 0.5) * 0.35, vy: 0.12 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.35, life: 0.9 });
    }
  }

  /** 粒子物理更新与回收 */
  updateParticles(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const u = this.drops[i];
      u.life -= dt;
      u.vy -= dt * 2.6;
      u.m.position.x += u.vx * dt; u.m.position.y += u.vy * dt; u.m.position.z += u.vz * dt;
      u.m.material.opacity = Math.max(0, u.life / 0.7) * 0.75;
      if (u.life <= 0) { this.scene.remove(u.m); u.m.geometry.dispose(); u.m.material.dispose(); this.drops.splice(i, 1); }
    }
    for (let i = this.dusts.length - 1; i >= 0; i--) {
      const u = this.dusts[i];
      u.life -= dt;
      u.m.position.x += u.vx * dt; u.m.position.y += u.vy * dt; u.m.position.z += u.vz * dt;
      u.m.scale.setScalar(1 + (0.9 - u.life) * 2.4);
      u.m.material.opacity = Math.max(0, u.life / 0.9) * 0.34;
      if (u.life <= 0) { this.scene.remove(u.m); u.m.geometry.dispose(); u.m.material.dispose(); this.dusts.splice(i, 1); }
    }
  }

  /** 触发一次镜头震动（幅度 amp，自动衰减） */
  shake(amp = 0.04) { this._shake = Math.max(this._shake, amp); }

  /** 助手行为更新：行走步态（加减速 / 前倾 / 侧倾 / 头部预瞄 / 左右脚脚步声）、
   *  空闲微动作（摸下巴 / 叉腰 / 看表 / 环顾 / 整理护目镜）、看向用户、
   *  说话动作（点头节奏 + 手部比划）、手势（视线 < 说话 < 微动作 < 手势 优先级合成） */
  updateAssistant(dt, now) {
    const g = this.assistant, a = this.assist;
    if (!g || !this.assistOn) return;
    // 气泡生命周期：淡入 0.25s → 停留 → 最后 0.45s 淡出
    if (a.bubble) {
      a.bubbleT -= dt;
      a.bubble.material.opacity = clamp(Math.min((a.bubbleDur - a.bubbleT) / 0.25, a.bubbleT / 0.45), 0, 1);
      if (a.bubbleT <= 0) {
        g.remove(a.bubble);
        a.bubble.material.map?.dispose();
        a.bubble.material.dispose();
        a.bubble = null;
      }
    }
    a.speak = Math.max(0, a.speak - dt);
    const P = this.assistParts;

    // ---- 行走：平滑加减速 + 身体前倾 + 转弯侧倾 + 头部预瞄 + 左右脚交替脚步声 ----
    if (a.mode === 'walk') {
      const dx = a.tx - g.position.x, dz = a.tz - g.position.z, dist = Math.hypot(dx, dz);
      if (dist < 0.07) {
        a.mode = 'idle'; a.speed = 0;
        P.legL.rotation.x = 0; P.legR.rotation.x = 0; P.torso.rotation.x = 0;
        g.position.y = 0; g.rotation.z = 0;
        const after = a.after; a.after = null;
        after?.();
      } else {
        const targetSp = dist > 0.6 ? 2.0 : Math.max(0.55, dist * 2.6);
        a.speed += (targetSp - a.speed) * Math.min(1, dt * 4.5);
        const sp = Math.min(a.speed * dt, dist);
        g.position.x += dx / dist * sp; g.position.z += dz / dist * sp;
        const ry = Math.atan2(dx, dz);
        const turn = angleDelta(ry, g.rotation.y);
        g.rotation.y += turn * Math.min(1, dt * 8);
        g.rotation.z += (-turn * 0.35 - g.rotation.z) * Math.min(1, dt * 5);   // 转弯时身体向内侧倾
        const sr = Math.min(1, a.speed / 2.0);   // 速度比 0..1
        a.phase += dt * (4.8 + 4.6 * sr);
        const s = Math.sin(a.phase);
        P.legL.rotation.x = s * (0.32 + 0.26 * sr); P.legR.rotation.x = -s * (0.32 + 0.26 * sr);
        P.armL.rotation.x = -s * (0.26 + 0.16 * sr); P.armR.rotation.x = s * (0.26 + 0.16 * sr);
        P.torso.rotation.x = 0.055 * sr;   // 行走前倾
        P.head.rotation.y = turn * 0.55;   // 头部先于身体转向目标
        g.position.y = Math.abs(Math.cos(a.phase)) * 0.032 * sr;
        a.stepT += dt;
        if (a.stepT > 0.42 - 0.14 * sr) {
          a.stepT = 0; a.stepSide = 1 - a.stepSide;
          this.sfx.footstep(a.stepSide);
        }
        return;
      }
    }

    // ---- 微动作调度：空闲随机小动作，让助手"活着" ----
    a.nextFidget -= dt;
    if (a.nextFidget <= 0) {
      if (!a.fidget && a.gesture <= 0) {
        const types = ['chin', 'hip', 'watch', 'scan', 'goggle'];
        a.fidget = { type: types[Math.floor(Math.random() * types.length)], t: 0, dur: 1.6 + Math.random() * 1.4 };
        a.nextFidget = 3.5 + Math.random() * 5;
      } else a.nextFidget = 1.2;
    }
    if (a.fidget) { a.fidget.t += dt; if (a.fidget.t >= a.fidget.dur) a.fidget = null; }

    // ---- 视线调度：空闲时偶尔看向用户（相机方向） ----
    a.lookT -= dt;
    if (a.lookT <= 0) {
      a.look = a.look ? null : 'camera';
      a.lookT = a.look ? 2.4 + Math.random() * 1.6 : 5 + Math.random() * 5;
    }

    // ---- idle：从默认姿态出发按优先级合成 ----
    g.rotation.z += (0 - g.rotation.z) * Math.min(1, dt * 6);
    P.torso.rotation.x += (0 - P.torso.rotation.x) * Math.min(1, dt * 6);
    P.torso.rotation.z = Math.sin(now / 2300) * 0.022;                       // 重心缓慢左右转移
    P.torso.scale.y = 1 + Math.sin(now / 880) * 0.012;                       // 胸腔呼吸起伏
    P.torso.position.y = 0.82 + Math.sin(now / 1100) * 0.008;
    let armLx = Math.sin(now / 900) * 0.02, armRx = Math.sin(now / 900 + 1.3) * 0.02;
    let armLz = 0, armRz = 0, headX = 0, headY = Math.sin(now / 1700) * 0.25;

    if (a.look === 'camera' && a.gesture <= 0 && !a.fidget) {   // 看向用户：头转向相机（限幅 + 平滑）
      const hp = new THREE.Vector3(); P.head.getWorldPosition(hp);
      const dxw = this.camera.position.x - hp.x, dzw = this.camera.position.z - hp.z;
      const yaw = clamp(angleDelta(Math.atan2(dxw, dzw), g.rotation.y), -0.7, 0.7);
      const pitch = clamp(Math.atan2(this.camera.position.y - hp.y, Math.hypot(dxw, dzw)), -0.3, 0.4);
      headY = yaw * 0.85; headX = -pitch * 0.7;   // 相机在上方 → 抬头（负值）
    }
    if (a.speak > 0 && a.gesture <= 0 && !a.fidget) {           // 说话动作：点头节奏 + 右手小幅比划
      headX += Math.sin(now / 170) * 0.05;
      armRx += Math.sin(now / 300) * 0.14 - 0.2;
    }
    if (a.fidget) {                                            // 微动作（正弦包络淡入淡出）
      const f = a.fidget, k = Math.sin(Math.min(1, f.t / f.dur) * Math.PI);
      if (f.type === 'chin') { armRx += -1.05 * k; armRz += -0.55 * k; headX += 0.22 * k; headY += 0.12 * k; }
      else if (f.type === 'hip') { armLx += -0.3 * k; armRx += -0.3 * k; armLz += -0.5 * k; armRz += 0.5 * k; }
      else if (f.type === 'watch') { armRx += -1.3 * k; headX += 0.45 * k; headY += -0.18 * k; }
      else if (f.type === 'scan') { headY += Math.sin(f.t / f.dur * Math.PI * 2) * 0.55 * k; }
      else if (f.type === 'goggle') { armLx += -1.5 * k; armRx += -1.5 * k; armLz += -0.25 * k; armRz += 0.25 * k; headX += -0.1 * k; }
    }
    if (a.gesture > 0) {                                       // 手势（最高优先级）
      a.gesture -= dt;
      const t = a.gestureType;
      if (t === 'point') {          // 指向设备 + 点头
        const k = Math.min(1, a.gesture / 1.15);
        armRx += -1.25 * Math.sin(k * Math.PI); headX += -0.18 * Math.sin(k * Math.PI);
      } else if (t === 'cheer') {   // 双臂高举欢呼
        const w = Math.sin(Math.min(1, a.gesture / 1.5) * Math.PI);
        armLx += -2.6 * w; armRx += -2.6 * w; armLz += -0.35 * w; armRz += 0.35 * w; headX += -0.2 * w;
      } else if (t === 'wave') {    // 挥手问候
        const w = Math.min(1, Math.sin(Math.min(1, a.gesture / 2.0) * Math.PI) * 1.6);
        armRx += -2.55 * w; armRz += Math.sin(now / 140) * 0.32 * w; headY += 0.12 * w;
      } else if (t === 'no') {      // 摇头 + 摊手
        const w = Math.sin(Math.min(1, a.gesture / 1.6) * Math.PI);
        headY += Math.sin(Math.min(1, a.gesture / 1.6) * Math.PI * 3.2) * 0.34 * w;
        headX += 0.16 * w;
        armLx += -0.45 * w; armRx += -0.45 * w; armLz += -0.4 * w; armRz += 0.4 * w;
      }
    }
    // 应用（平滑插值，避免姿态跳变）
    const kk = Math.min(1, dt * 10);
    P.armL.rotation.x += (armLx - P.armL.rotation.x) * kk; P.armL.rotation.z += (armLz - P.armL.rotation.z) * kk;
    P.armR.rotation.x += (armRx - P.armR.rotation.x) * kk; P.armR.rotation.z += (armRz - P.armR.rotation.z) * kk;
    P.head.rotation.x += (headX - P.head.rotation.x) * Math.min(1, dt * 8);
    P.head.rotation.y += (headY - P.head.rotation.y) * Math.min(1, dt * 8);
    if (a.gesture <= 0) P.head.rotation.z = Math.sin(now / 2600) * 0.03;   // 偶尔轻微歪头
  }

  updateFromState(s) {
    if (!s) return;
    const w = (s.weigh && s.weigh[s.activeReagent || 'cu']) || {};
    const boatWas = this.boat.visible;
    this.boat.visible = !!w.boat;
    if (!boatWas && this.boat.visible) this.anim.boatDrop = 0;   // 重新播放称量舟落下的动画
    this.balanceOpen = this.boat.visible && !w.tared;         // 放置称量舟时防风门打开
    if (w.added !== this._lastMass) {                         // 每次加样托盘轻微摆动
      this.anim.balanceWobble = 0.028;
      this._lastMass = w.added;
    }
    this._balanceTarget=w.added||0; this._balanceTared=!!w.tared;
    // 称量舟内粉末堆：随加样量增长，颜色随当前试剂变化（高度由 updateDevices 平滑趋近）
    if (this.boatPowder) {
      const added = w.added || 0;
      this.boatPowder.visible = this.boat.visible && added > 0;
      this.boatPowder.material.color.set((s.activeReagent || 'cu') === 'cu' ? 0x2a6fc2 : 0xeee9dc);
      this._powTarget = 0.02 + Math.min(added, 1.8) * 0.075;
    }

    ['A', 'B'].forEach(k => {
      const b = k === 'A' ? this.beakerA : this.beakerB; const data = (s.solutions && s.solutions[k]) || {};
      b.solid.visible = !!data.solid && !data.dissolved;
      b.liquid.visible = (data.volume || 0) > 0;
      // 液位写入平滑目标：倾倒/稀释时液面缓缓变化而非瞬间跳变
      const sv = Math.max(0.02, (data.volume || 0) / 5);
      this._liqTarget[k] = { s: sv, y: 0.03 + 0.25 * sv };
      b.liquid.material.color.set(k === 'A' ? 0x1e78c8 : data.dissolved ? 0xdfe9e2 : 0xd9eef2);
      b.liquid.material.opacity = data.dissolved ? 0.72 : 0.43;
    });

    this.reactorLiquid.visible = !!(s.assembly && (s.assembly.aTransferred || s.assembly.bTransferred));
    this._liqTarget.reactor = (s.assembly && s.assembly.bTransferred) ? 1 : 0.5;
    this.assemblySealed = !!(s.assembly && s.assembly.sealed);

    const rx = s.reaction || {};
    this.reactionStarted = !!rx.started;
    this.reactionCooled = !!rx.cooled;
    this.centrifugeOpen = !(s.separation && s.separation.done);
    // 离心管装载状态同步（loadTubes 内部有守卫，重复调用不会重播动画）
    const sep = s.separation || {};
    if (sep.done) this._tubesDrained = true;
    this.loadTubes(sep.transferred ? (sep.balanced ? 8 : 4) : 0);
    // 烘箱：样品瓶放入状态 / 真空系统 / 箱门
    const act = s.activation || {};
    if (this.ovenVial) {
      const was = this.ovenVial.visible;
      this.ovenVial.visible = !!act.vialPlaced || !!act.done;
      const vf = this.ovenVial.userData.vfill; if (vf) vf.visible = !!act.done;
      if (!was && this.ovenVial.visible) this.placeOvenVial();   // 存档恢复时补播放入动画
    }
    this.vacuumOn = !!act.vacuum;
    this.ovenOpen = !(act.done || act.vacuum);
    this.hoodActive = !!(s.safety && s.safety.facilities && s.safety.facilities.includes('hood'));

    // characterization screens: highlight when completed
    ['pxrd', 'bet', 'sem'].forEach(id => {
      const dev = this.devices.get(id); if (!dev) return;
      const done = s.characterization && s.characterization[id];
      dev.group.traverse(o => { if (o.isMesh && o.userData.isScreen && o.material.emissive) o.material.emissive.set(done ? 0x2f9f6a : 0x0d7f86); });
    });

    this.setGrowth(rx.growth || 0);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05), now = performance.now();
    if (this.cameraTween) {
      const t = Math.min(1, (now - this.cameraTween.start) / this.cameraTween.duration), e = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(this.cameraTween.fromPos, this.cameraTween.toPos, e); this.controls.target.lerpVectors(this.cameraTween.fromTarget, this.cameraTween.toTarget, e);
      if (t >= 1) this.cameraTween = null;
    }
    this.updateDevices(dt, now);
    this.updateStudioDetails(dt, now);
    this.updateAssistant(dt, now);
    this.updateParticles(dt);
    if (this.cifRoot.visible) {
      this.cifRoot.rotation.y += dt * 0.12;
      if (this.thermalAmp > 0) this.animateThermal(now);
    }
    if (this.crystalRoot.visible) { this.crystalRoot.rotation.y += dt * (this.crystalMode ? 0.09 : 0.04); this.crystalHabit.rotation.y -= dt * 0.03; }
    this.airflows.forEach((c, i) => { c.position.y -= dt * 0.55; if (c.position.y < 0.35) c.position.y = 2.1; c.material.opacity = 0.22 + 0.22 * Math.abs(Math.sin(now / 700 + i)); });
    if (this.mouseEvent && this.frameCount % 3 === 0) {
      const hit = this.pick(); const root = hit?.object.userData.deviceRoot;
      // 悬停实验员本体：光标可点 + 脚下光环（与设备悬停同款反馈）
      let hoverAssist = false;
      if (!root && !this.crystalMode && this.assistOn && this.assistant) {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        hoverAssist = this.raycaster.intersectObject(this.assistant, true).length > 0;
      }
      this.renderer.domElement.style.cursor = root || hit?.object.userData.crystalInfo || hoverAssist ? 'pointer' : 'grab';
      this.callbacks.onHover?.(root ? { id: root.userData.device, name: root.userData.name, hint: root.userData.hint, x: this.mouseEvent.clientX, y: this.mouseEvent.clientY } : null);
      // 悬停设备高亮环：贴地光环跟随被悬停设备（大小按包围盒自适应，透明度呼吸）
      if (this.hoverRing) {
        if (root && !this.crystalMode) {
          if (!root.userData._ringBox) root.userData._ringBox = new THREE.Box3().setFromObject(root);
          const bb = root.userData._ringBox;
          const c = bb.getCenter(new THREE.Vector3());
          this.hoverRing.position.set(c.x, 0.03, c.z);
          const r = Math.max(0.5, Math.min(1.7, (bb.max.x - bb.min.x + bb.max.z - bb.min.z) / 3.4));
          this.hoverRing.scale.setScalar(r / 0.55);
          this.hoverRing.visible = true;
          this.hoverRing.material.opacity = 0.32 + 0.18 * Math.sin(now / 260);
        } else if (hoverAssist) {
          this.hoverRing.position.set(this.assistant.position.x, 0.03, this.assistant.position.z);
          this.hoverRing.scale.setScalar(1.0);
          this.hoverRing.visible = true;
          this.hoverRing.material.opacity = 0.32 + 0.18 * Math.sin(now / 260);
        } else this.hoverRing.visible = false;
      }
    }
    this.controls.update();
    if (this._shake > 0.0006) {   // 镜头震动：反应启动 / 离心等操作的物理反馈
      this._shake *= Math.max(0, 1 - dt * 4.2);
      this.camera.position.x += (Math.random() - 0.5) * this._shake;
      this.camera.position.y += (Math.random() - 0.5) * this._shake * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * this._shake;
    }
    if (!this.contextLost) this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    if (now - this.lastFpsTime > 1000) {
      const elapsed = now - this.lastFpsTime;
      const fps = Math.round(this.frameCount * 1000 / elapsed);
      this.callbacks.onFPS?.(fps);
      this.frameCount = 0; this.lastFpsTime = now;
      // 标签页切走再切回会造成“假低帧率”，超过 2.5s 的窗口不计入降级判断
      if (elapsed > 2500) { this.slowWindows = 0; }
      else {
        // 连续 3 秒低于 18 FPS 时自动降级一次，避免低端显卡上卡死或上下文丢失
        if (fps > 0 && fps < 40) this.slowWindows++; else this.slowWindows = 0;
        if (this.slowWindows >= 3 && !this.autoDegraded) { this.degrade(); this.callbacks.onAutoDegrade?.(fps); }
      }
    }
  }
}
/* ================= 程序化音效引擎 =================
   WebAudio 实时合成全部声音（无外部音频文件）。
   AudioContext 惰性创建并遵循浏览器自动播放策略：首次用户点击时才会出声。
   所有接口均做了 try/catch 与能力探测保护，音频不可用时静默降级。 */
class Sfx {
  constructor() {
    this.ctx = null; this.master = null; this.noiseBuf = null;
    this.muted = false;
    this.loops = {};              // name -> { g, nodes[] }
  }

  /** 惰性初始化 AudioContext / 主增益 / 1s 白噪声 buffer；失败返回 false */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { } }
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 1.0);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { this.ctx = null; return false; }
  }

  /** 包络：attack 起音 -> 指数衰减到静音（expRamp 不允许 0，用 0.0001 下限） */
  _env(g, t0, gain, attack, dur) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.max(0.002, attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.02, dur));
  }

  /** 滤波噪声爆发：type=lowpass/bandpass/highpass，sweep>1 频率上扬、<1 下滑 */
  noise({ dur = 0.2, gain = 0.3, type = 'lowpass', freq = 1200, q = 1, sweep = 0, attack = 0.008, delay = 0 } = {}) {
    if (this.muted || !this.ensure()) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      if (this.jitter !== false) freq = Math.max(40, freq * (0.965 + Math.random() * 0.07));
      f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t0 + dur);
      const g = this.ctx.createGain();
      this._env(g, t0, gain, attack, dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0); src.stop(t0 + dur + 0.06);
    } catch (e) { }
  }

  /** 振荡器单音：slide 为频率倍率（终值 = freq * slide） */
  tone({ freq = 440, dur = 0.15, gain = 0.2, type = 'sine', slide = 0, attack = 0.006, delay = 0 } = {}) {
    if (this.muted || !this.ensure()) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      o.type = type;
      if (this.jitter !== false) freq = Math.max(30, freq * (0.965 + Math.random() * 0.07));   // 随机微失谐：重复音效每次略有差异
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
      const g = this.ctx.createGain();
      this._env(g, t0, gain, attack, dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.06);
    } catch (e) { }
  }

  /* ---------- 单发音效 ---------- */
  tap() { this.tone({ freq: 1400, dur: 0.05, gain: 0.14, type: 'triangle', slide: 0.6 }); }
  click() {
    this.tone({ freq: 2100, dur: 0.035, gain: 0.1, type: 'square', slide: 0.5 });
    this.noise({ dur: 0.04, gain: 0.08, freq: 4200, type: 'highpass' });
  }
  glass() {
    this.tone({ freq: 2600, dur: 0.09, gain: 0.1, type: 'sine', slide: 1.25 });
    this.tone({ freq: 3900, dur: 0.07, gain: 0.06, type: 'sine', delay: 0.025 });
  }
  balanceClick() {
    this.tone({ freq: 950, dur: 0.045, gain: 0.13, type: 'square', slide: 0.7 });
    this.noise({ dur: 0.05, gain: 0.05, freq: 2500 });
  }
  /** 液体倾倒：宽带噪声 + 上扬共振，双层叠加模拟水流 */
  pourLiquid(dur = 1) {
    this.noise({ dur, gain: 0.16, freq: 900, sweep: 1.8, q: 2.2, attack: 0.06 });
    this.noise({ dur, gain: 0.05, freq: 2400, type: 'bandpass', q: 3, attack: 0.1 });
  }
  /** 粉末倾倒：高频沙沙声 + 随机颗粒哒哒声 */
  pourPowder(dur = 1) {
    this.noise({ dur, gain: 0.13, freq: 3400, type: 'highpass', q: 0.8, attack: 0.05 });
    const n = Math.max(3, Math.round(dur * 7));
    for (let i = 0; i < n; i++)
      this.tone({ freq: 1800 + Math.random() * 900, dur: 0.02, gain: 0.025, type: 'triangle', delay: (i / n) * dur + Math.random() * 0.04 });
  }
  bubble() { this.tone({ freq: 420 + Math.random() * 380, dur: 0.07, gain: 0.05, type: 'sine', slide: 2.2 }); }
  whoosh() { this.noise({ dur: 0.5, gain: 0.2, freq: 500, sweep: 3.2, q: 1.2, attack: 0.1 }); }
  door() {
    this.noise({ dur: 0.3, gain: 0.18, freq: 220, sweep: 0.5, q: 1, attack: 0.02 });
    this.tone({ freq: 120, dur: 0.18, gain: 0.12, type: 'sine', slide: 0.7, delay: 0.02 });
  }
  scan() { this.tone({ freq: 1200, dur: 0.12, gain: 0.07, type: 'sine', slide: 1.9 }); }
  /** 步骤完成：C5-E5-G5-C6 上行琶音 */
  stepDone() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.17, gain: 0.13, type: 'sine', delay: i * 0.09 }));
  }
  /** 操作错误：下行双音 */
  error() {
    this.tone({ freq: 320, dur: 0.16, gain: 0.15, type: 'square', slide: 0.6 });
    this.tone({ freq: 235, dur: 0.22, gain: 0.13, type: 'square', slide: 0.65, delay: 0.16 });
  }

  /* ---------- 物理反馈扩展音效 ---------- */
  /** 水滴落液：短促下滑单音 */
  drip() { this.tone({ freq: 900 + Math.random() * 500, dur: 0.06, gain: 0.07, type: 'sine', slide: 0.45 }); }
  /** 金属磕碰（釜盖旋紧 / 设备就位） */
  clank() {
    this.tone({ freq: 720 + Math.random() * 160, dur: 0.09, gain: 0.12, type: 'square', slide: 0.55 });
    this.noise({ dur: 0.07, gain: 0.09, freq: 5200, type: 'bandpass', q: 2.5 });
  }
  /** 仪器提示短 beep（两声） */
  beep() {
    this.tone({ freq: 1560, dur: 0.09, gain: 0.1, type: 'sine' });
    this.tone({ freq: 1560, dur: 0.09, gain: 0.1, type: 'sine', delay: 0.14 });
  }
  /** 仪器完成提示：三连升调 */
  beepDone() { [880, 1174, 1568].forEach((f, i) => this.tone({ freq: f, dur: 0.12, gain: 0.11, type: 'sine', delay: i * 0.13 })); }
  /** 脚步（实验员行走） */
  footstep(side = 0) { this.noise({ dur: 0.09, gain: 0.05 + Math.random() * 0.02, freq: (160 + Math.random() * 60) * (side ? 0.93 : 1.07), q: 1.2 }); }   // 左右脚音色微差
  /** 拍手（实验员庆祝 / 鼓励） */
  clap(n = 6) {
    for (let i = 0; i < n; i++)
      this.noise({ dur: 0.045, gain: 0.07 + Math.random() * 0.03, freq: 1800 + Math.random() * 900, type: 'bandpass', q: 1.6, delay: i * 0.11 + Math.random() * 0.03 });
  }
  /** 实验室环境底噪：空调 / 通风低鸣（进入实验室后开启） */
  ambientStart() {
    if (this.muted || !this.ensure() || this.amb) return;
    try {
      const t0 = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 2);
      g.connect(this.master);
      const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 110; f.Q.value = 0.8;
      const m = this.ctx.createGain(); m.gain.value = 0.05;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
      const lg = this.ctx.createGain(); lg.gain.value = 22;
      lfo.connect(lg); lg.connect(f.frequency);
      n.connect(f); f.connect(m); m.connect(g);
      n.start(t0); lfo.start(t0);
      this.amb = { g, nodes: [n, lfo] };
    } catch (e) { }
  }
  ambientStop() {
    const A = this.amb; if (!A) return;
    this.amb = null;
    try {
      const t = this.ctx.currentTime;
      A.g.gain.cancelScheduledValues(t);
      A.g.gain.setValueAtTime(Math.max(0.0002, A.g.gain.value), t);
      A.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      setTimeout(() => { try { A.nodes.forEach(n => { try { n.stop(); } catch (e) { } }); A.g.disconnect(); } catch (e) { } }, 700);
    } catch (e) { }
  }

  /* ---------- 循环音效（搅拌 / 离心 / 超声 / 加热 / 真空泵） ---------- */
  loopStart(name) {
    if (this.muted || !this.ensure() || this.loops[name]) return;
    try {
      const t0 = this.ctx.currentTime;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 0.25);
      g.connect(this.master);
      const nodes = [];
      const og = v => { const n = this.ctx.createGain(); n.gain.value = v; return n; };
      if (name === 'stir') {
        // 磁力搅拌：低频三角波 + 涡流 LFO 调制
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 95;
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = 2.4;
        const lg = og(18); lfo.connect(lg); lg.connect(o.frequency);
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 480;
        const m = og(0.3);
        o.connect(f); f.connect(m); m.connect(g);
        o.start(t0); lfo.start(t0); nodes.push(o, lfo);
      } else if (name === 'cent') {
        // 离心机：锯齿波 55→210Hz 渐强（升速） + 宽带风噪
        const o = this.ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(55, t0);
        o.frequency.linearRampToValueAtTime(210, t0 + 3.5);
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
        const m = og(0.26);
        o.connect(f); f.connect(m); m.connect(g);
        const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
        const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 1.4;
        const ng = og(0.12);
        n.connect(nf); nf.connect(ng); ng.connect(g);
        o.start(t0); n.start(t0); nodes.push(o, n);
      } else if (name === 'sonic') {
        // 超声清洗：880 Hz 载波 + 33 Hz 振幅调制（嗡嗡颤动）
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 880;
        const am = this.ctx.createOscillator(); am.frequency.value = 33;
        const ag = og(0.11); am.connect(ag);
        const m = og(0.22); ag.connect(m.gain);
        o.connect(m); m.connect(g);
        o.start(t0); am.start(t0); nodes.push(o, am);
      } else if (name === 'heat') {
        // 烘箱加热：低通白噪声（炉腔闷响）
        const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
        const m = og(0.4);
        n.connect(f); f.connect(m); m.connect(g);
        n.start(t0); nodes.push(n);
      } else if (name === 'vac') {
        // 真空泵：方波 72 Hz + 低通（马达脉动）
        const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 72;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 2;
        const m = og(0.14);
        o.connect(f); f.connect(m); m.connect(g);
        o.start(t0); nodes.push(o);
      } else { g.disconnect(); return; }
      this.loops[name] = { g, nodes };
    } catch (e) { }
  }

  loopStop(name) {
    const L = this.loops[name];
    if (!L) return;
    delete this.loops[name];
    try {
      const t = this.ctx.currentTime;
      L.g.gain.cancelScheduledValues(t);
      L.g.gain.setValueAtTime(Math.max(0.0002, L.g.gain.value), t);
      L.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      setTimeout(() => { try { L.nodes.forEach(n => { try { n.stop(); } catch (e) { } }); L.g.disconnect(); } catch (e) { } }, 380);
    } catch (e) {
      try { L.nodes.forEach(n => { try { n.stop(); } catch (e2) { } }); } catch (e3) { }
    }
  }
}

window.VirtualLab = VirtualLab;
