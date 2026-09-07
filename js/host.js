// host.js — runs on the "TV" screen. Owns the PeerJS host connection,
// the lobby, the simulation and all rendering. Controllers are dumb
// input sources; this file is the single source of truth for game state.

const MAX_PLAYERS = 4;
const TOTAL_LAPS = 3;

const state = {
  peer: null,
  peerId: null,
  slots: Array.from({ length: MAX_PLAYERS }, () => ({ type: 'empty', conn: null, name: null })),
  karts: [],
  itemBoxes: [],
  bananas: [],
  phase: 'lobby', // lobby | countdown | racing | finished
  countdownValue: 3,
  raceStartAt: 0,
};

const el = {
  joinCode: document.getElementById('join-code'),
  qrCanvas: document.getElementById('qr-canvas'),
  playerSlots: document.getElementById('player-slots'),
  startBtn: document.getElementById('start-btn'),
  lobby: document.getElementById('lobby'),
  race: document.getElementById('race'),
  trackCanvas: document.getElementById('track-canvas'),
  lapCounter: document.getElementById('lap-counter'),
  standings: document.getElementById('standings'),
  countdown: document.getElementById('countdown'),
  results: document.getElementById('results'),
  resultsList: document.getElementById('results-list'),
  restartBtn: document.getElementById('restart-btn'),
  controllerUrlHint: document.getElementById('controller-url-hint'),
  minimapCanvas: document.getElementById('minimap-canvas'),
  viewportLabels: document.getElementById('viewport-labels'),
};

const minimapCtx = el.minimapCanvas.getContext('2d');

// ---------------------------------------------------------------- Peer setup

function randomCode(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function initPeer() {
  const code = randomCode(4);
  const peerId = `kart-${code}`;
  state.peer = new Peer(peerId);

  state.peer.on('open', (id) => {
    state.peerId = id;
    el.joinCode.textContent = code.toUpperCase();

    const controllerUrl = new URL('controller.html', location.href);
    controllerUrl.searchParams.set('host', id);
    el.controllerUrlHint.textContent = controllerUrl.href.replace(/^https?:\/\//, '');

    QRCode.toCanvas(el.qrCanvas, controllerUrl.href, { width: 140, margin: 1 }, (err) => {
      if (err) console.warn('QR generation failed', err);
    });
  });

  state.peer.on('connection', (conn) => {
    conn.on('open', () => {
      const openSlot = state.slots.findIndex((s) => s.type === 'empty');
      if (openSlot === -1) {
        conn.send({ type: 'full' });
        conn.close();
        return;
      }
      const slot = state.slots[openSlot];
      slot.type = 'human';
      slot.conn = conn;
      slot.name = `Piloto ${openSlot + 1}`;
      conn.send({ type: 'assigned', slot: openSlot, color: KART_COLORS[openSlot % KART_COLORS.length] });
      renderLobby();

      conn.on('data', (msg) => {
        if (state.phase !== 'racing') return;
        const kart = state.karts[openSlot];
        if (!kart) return;
        kart.input.throttle = msg.throttle ?? 0;
        kart.input.steer = msg.steer ?? 0;
        if (msg.useItem) kart.input.useItem = true;
      });

      conn.on('close', () => {
        slot.type = 'empty';
        slot.conn = null;
        if (state.phase === 'racing' && state.karts[openSlot]) {
          state.karts[openSlot].isAI = true;
        }
        renderLobby();
      });
    });
  });

  state.peer.on('error', (err) => {
    console.warn('Peer error', err);
  });
}

// ---------------------------------------------------------------- Lobby UI

function renderLobby() {
  el.playerSlots.innerHTML = '';
  let humanCount = 0;
  state.slots.forEach((slot, i) => {
    const chip = document.createElement('div');
    chip.className = 'slot-chip' + (slot.type === 'empty' ? ' empty' : '');
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.background = KART_COLORS[i % KART_COLORS.length];
    chip.appendChild(dot);
    const label = document.createElement('span');
    if (slot.type === 'human') {
      label.textContent = slot.name;
      humanCount++;
    } else {
      label.textContent = `Vaga ${i + 1} (CPU)`;
    }
    chip.appendChild(label);
    el.playerSlots.appendChild(chip);
  });

  el.startBtn.disabled = humanCount === 0;
  el.startBtn.textContent = humanCount === 0
    ? 'Aguardando jogadores…'
    : `Começar corrida (${humanCount} piloto${humanCount > 1 ? 's' : ''})`;
}

el.startBtn.addEventListener('click', startRace);
el.restartBtn.addEventListener('click', () => {
  el.results.style.display = 'none';
  el.lobby.style.display = 'flex';
  state.phase = 'lobby';
  // Free up slots that were auto-filled with AI so new phones can join them;
  // slots still occupied by a connected human stay as they are.
  state.slots.forEach((slot) => {
    if (slot.type === 'ai') slot.type = 'empty';
  });
  renderLobby();
});

// ---------------------------------------------------------------- Race setup

function startRace() {
  // Fill remaining slots with AI.
  state.slots.forEach((slot, i) => {
    if (slot.type === 'empty') slot.type = 'ai';
  });

  state.karts = state.slots.map((slot, i) => new Kart(i, slot.type === 'human' ? slot.name : `CPU ${i + 1}`, slot.type === 'ai'));

  state.itemBoxes = TRACK.itemBoxIndices.map((idx) => {
    const p = TRACK.pointAt(idx);
    return { x: p.x, y: p.y, active: true, respawnTimer: 0 };
  });
  state.bananas = [];

  el.lobby.style.display = 'none';
  el.results.style.display = 'none';
  el.race.style.display = 'block';

  if (!scene) initScene3D();
  buildKartMeshes();
  buildItemBoxMeshes();
  buildCameraRigs();
  resizeCanvas();

  broadcast({ type: 'race-start' });

  state.phase = 'countdown';
  state.countdownValue = 3;
  el.countdown.style.display = 'flex';
  el.countdown.textContent = state.countdownValue;

  const countdownTimer = setInterval(() => {
    state.countdownValue -= 1;
    if (state.countdownValue <= 0) {
      el.countdown.textContent = 'VAI!';
      clearInterval(countdownTimer);
      setTimeout(() => {
        el.countdown.style.display = 'none';
        state.phase = 'racing';
      }, 600);
    } else {
      el.countdown.textContent = state.countdownValue;
    }
  }, 800);

  requestAnimationFrame(loop);
}

function broadcast(msg) {
  state.slots.forEach((slot) => {
    if (slot.type === 'human' && slot.conn) slot.conn.send(msg);
  });
}

// ---------------------------------------------------------------- Game loop

let lastTime = null;

function loop(ts) {
  if (lastTime === null) lastTime = ts;
  const dt = Math.min(0.05, (ts - lastTime) / 1000);
  lastTime = ts;

  if (state.phase === 'racing' || state.phase === 'countdown') {
    if (state.phase === 'racing') {
      updateSimulation(dt);
    }
    render(dt);
  }

  if (state.phase !== 'finished') {
    requestAnimationFrame(loop);
  } else {
    lastTime = null;
  }
}

function updateSimulation(dt) {
  // Item box respawns.
  for (const box of state.itemBoxes) {
    if (!box.active) {
      box.respawnTimer -= dt;
      if (box.respawnTimer <= 0) box.active = true;
    }
  }

  // Bananas arm after a short delay (so the dropper doesn't self-hit).
  for (const b of state.bananas) {
    if (b.armTimer > 0) b.armTimer -= dt;
  }
  state.bananas = state.bananas.filter((b) => !b.hit);

  for (const kart of state.karts) {
    if (kart.finished) continue;
    kart.applyAIInput();
    kart.update(dt, state.karts, state.itemBoxes, state.bananas);

    if (kart.lapCount >= TOTAL_LAPS && !kart.finished) {
      kart.finished = true;
      kart.finishTime = performance.now();
    }
  }

  updateHUD();
  sendControllerUpdates();

  if (state.karts.every((k) => k.finished)) {
    finishRace();
  }
}

function ranked() {
  return [...state.karts].sort((a, b) => b.raceDistance - a.raceDistance);
}

function updateHUD() {
  const leaderLap = Math.min(TOTAL_LAPS, Math.max(...state.karts.map((k) => k.lapCount + 1)));
  el.lapCounter.textContent = `Volta ${leaderLap} / ${TOTAL_LAPS}`;

  el.standings.innerHTML = '';
  ranked().forEach((kart, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.background = kart.color;
    row.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = `${i + 1}º ${kart.name}`;
    row.appendChild(label);
    el.standings.appendChild(row);
  });
}

function sendControllerUpdates() {
  const rank = ranked();
  state.slots.forEach((slot, i) => {
    if (slot.type !== 'human' || !slot.conn) return;
    const kart = state.karts[i];
    if (!kart) return;
    slot.conn.send({
      type: 'state',
      position: rank.indexOf(kart) + 1,
      total: state.karts.length,
      lap: Math.min(TOTAL_LAPS, kart.lapCount + 1),
      totalLaps: TOTAL_LAPS,
      item: kart.item,
      finished: kart.finished,
    });
  });
}

function finishRace() {
  state.phase = 'finished';
  const rank = ranked();
  el.resultsList.innerHTML = '';
  rank.forEach((kart, i) => {
    const li = document.createElement('li');
    const place = document.createElement('span');
    place.className = 'place';
    place.textContent = `${i + 1}º`;
    const dot = document.createElement('span');
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.borderRadius = '50%';
    dot.style.background = kart.color;
    dot.style.display = 'inline-block';
    const name = document.createElement('span');
    name.textContent = kart.name;
    li.append(place, dot, name);
    el.resultsList.appendChild(li);
  });
  el.results.style.display = 'flex';

  state.slots.forEach((slot, i) => {
    if (slot.type === 'human' && slot.conn) {
      slot.conn.send({ type: 'finished', position: rank.indexOf(state.karts[i]) + 1 });
    }
  });
}

// ---------------------------------------------------------------- Rendering (Three.js, 3rd-person chase cam on kart 0)

let scene, renderer;
let kartGroups = [];
let itemBoxMeshes = [];
let cameraRigs = []; // one per human player, in slot order
let viewW = 0;
let viewH = 0;
const bananaMeshes = new Map();
const bananaGeo = new THREE.SphereGeometry(9, 10, 8);
const bananaMat = new THREE.MeshStandardMaterial({ color: '#f2d024' });

const CAM_BACK = 68;
const CAM_HEIGHT = 32;
const CAM_LOOK_AHEAD = 45;
const CAM_LOOK_HEIGHT = 12;

function toWorld(x, y) {
  return new THREE.Vector3(x - TRACK.WIDTH / 2, 0, y - TRACK.HEIGHT / 2);
}

function ribbonGeometry(width, yOffset) {
  const pts = TRACK.points;
  const n = pts.length;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const p = pts[idx];
    const h = TRACK.headingAt(idx);
    const nx = Math.cos(h + Math.PI / 2);
    const ny = Math.sin(h + Math.PI / 2);
    const l = toWorld(p.x - nx * width / 2, p.y - ny * width / 2);
    const r = toWorld(p.x + nx * width / 2, p.y + ny * width / 2);
    positions.push(l.x, yOffset, l.z, r.x, yOffset, r.z);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeNameSprite(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const c2 = canvas.getContext('2d');
  c2.fillStyle = 'rgba(18,21,31,0.75)';
  c2.fillRect(0, 0, 256, 64);
  c2.fillStyle = '#f4f1e6';
  c2.font = 'bold 30px sans-serif';
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  c2.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(26, 6.5, 1);
  return sprite;
}

function initScene3D() {
  renderer = new THREE.WebGLRenderer({ canvas: el.trackCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#7ec9ef');
  scene.fog = new THREE.Fog('#7ec9ef', 500, 1500);

  scene.add(new THREE.HemisphereLight('#bfe3ff', '#2f8f5b', 0.95));
  const sun = new THREE.DirectionalLight('#fff6df', 1.0);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: '#2f8f5b' })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  // Curb + asphalt ribbons.
  scene.add(new THREE.Mesh(ribbonGeometry(TRACK.TRACK_WIDTH + 26, 0), new THREE.MeshStandardMaterial({ color: '#e7473c', side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(ribbonGeometry(TRACK.TRACK_WIDTH, 0.4), new THREE.MeshStandardMaterial({ color: '#33384a', side: THREE.DoubleSide })));

  // Dashed centerline stripe pairs, alternating along the track.
  const dashMat = new THREE.MeshStandardMaterial({ color: '#f4f1e6', side: THREE.DoubleSide });
  for (let i = 0; i < TRACK.points.length; i += 6) {
    if (Math.floor(i / 6) % 2 !== 0) continue;
    const p = TRACK.points[i];
    const h = TRACK.headingAt(i);
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.5), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.rotation.z = -h;
    const wp = toWorld(p.x, p.y);
    dash.position.set(wp.x, 0.5, wp.z);
    scene.add(dash);
  }

  // Checkered pattern band alongside the outer curb, more visual noise like a real track.
  const checkerMat1 = new THREE.MeshStandardMaterial({ color: '#f4f1e6', side: THREE.DoubleSide });
  const checkerMat2 = new THREE.MeshStandardMaterial({ color: '#181a20', side: THREE.DoubleSide });
  for (let i = 0; i < TRACK.points.length; i += 10) {
    const p = TRACK.points[i];
    const h = TRACK.headingAt(i);
    const nx = Math.cos(h + Math.PI / 2);
    const ny = Math.sin(h + Math.PI / 2);
    const dist = TRACK.TRACK_WIDTH / 2 + 40;
    const mat = Math.floor(i / 10) % 2 === 0 ? checkerMat1 : checkerMat2;
    const block = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), mat);
    block.rotation.x = -Math.PI / 2;
    block.rotation.z = -h;
    const wp = toWorld(p.x + nx * dist, p.y + ny * dist);
    block.position.set(wp.x, 0.3, wp.z);
    scene.add(block);
  }

  // Start/finish stripe.
  const startP = TRACK.pointAt(TRACK.startIndex);
  const startH = TRACK.headingAt(TRACK.startIndex);
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(8, TRACK.TRACK_WIDTH),
    new THREE.MeshStandardMaterial({ color: '#f4f1e6', side: THREE.DoubleSide })
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.rotation.z = -startH;
  const sw = toWorld(startP.x, startP.y);
  stripe.position.set(sw.x, 0.5, sw.z);
  scene.add(stripe);

  buildDecoration();
}

function buildDecoration() {
  const treeGeo = new THREE.ConeGeometry(14, 34, 7);
  const trunkGeo = new THREE.CylinderGeometry(3, 3, 10, 6);
  const treeMat = new THREE.MeshStandardMaterial({ color: '#2e7d46' });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b3a21' });
  const step = 6;
  for (let i = 0; i < TRACK.points.length; i += step) {
    const p = TRACK.points[i];
    const h = TRACK.headingAt(i);
    const nx = Math.cos(h + Math.PI / 2);
    const ny = Math.sin(h + Math.PI / 2);
    const dist = TRACK.TRACK_WIDTH / 2 + 55;
    [1, -1].forEach((side) => {
      if (Math.random() < 0.25) return; // sparse, not every point
      const wp = toWorld(p.x + nx * dist * side, p.y + ny * dist * side);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(wp.x, 5, wp.z);
      scene.add(trunk);
      const top = new THREE.Mesh(treeGeo, treeMat);
      top.position.set(wp.x, 27, wp.z);
      scene.add(top);
    });
  }
}

function buildKartMeshes() {
  kartGroups.forEach((g) => scene.remove(g));
  kartGroups = state.karts.map((kart) => {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: kart.color });

    const body = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 20), bodyMat);
    body.position.set(0, 9, 0);
    group.add(body);

    const driver = new THREE.Mesh(
      new THREE.SphereGeometry(6.5, 12, 12),
      new THREE.MeshStandardMaterial({ color: '#f4f1e6' })
    );
    driver.position.set(-4, 18, 0);
    group.add(driver);

    const wheelMat = new THREE.MeshStandardMaterial({ color: '#181a20' });
    [[12, 4, 9], [12, 4, -9], [-12, 4, 9], [-12, 4, -9]].forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 5, 10), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, y, z);
      group.add(wheel);
    });

    const nameSprite = makeNameSprite(kart.name);
    nameSprite.position.set(0, 32, 0);
    group.add(nameSprite);
    group.userData.body = body;
    group.userData.driver = driver;

    scene.add(group);
    return group;
  });
}

function buildCameraRigs() {
  cameraRigs = [];
  state.slots.forEach((slot, i) => {
    if (slot.type !== 'human') return;
    const kart = state.karts[i];
    cameraRigs.push({
      kartIndex: i,
      name: kart.name,
      color: kart.color,
      camera: new THREE.PerspectiveCamera(62, 1, 1, 3000),
      camPos: new THREE.Vector3(),
      camLook: new THREE.Vector3(),
      ready: false,
    });
  });
  updateViewportLabels();
}

// Splits the canvas into 1/2/3/4 panels, top-left origin (like CSS), one
// panel per human player. 3-player uses the classic top-two + bottom-wide
// layout; 4 uses a plain 2x2 grid.
function viewportLayout(n, w, h) {
  if (n <= 1) return [{ x: 0, y: 0, w, h }];
  if (n === 2) return [{ x: 0, y: 0, w, h: h / 2 }, { x: 0, y: h / 2, w, h: h / 2 }];
  if (n === 3) {
    return [
      { x: 0, y: 0, w: w / 2, h: h / 2 },
      { x: w / 2, y: 0, w: w / 2, h: h / 2 },
      { x: 0, y: h / 2, w, h: h / 2 },
    ];
  }
  return [
    { x: 0, y: 0, w: w / 2, h: h / 2 },
    { x: w / 2, y: 0, w: w / 2, h: h / 2 },
    { x: 0, y: h / 2, w: w / 2, h: h / 2 },
    { x: w / 2, y: h / 2, w: w / 2, h: h / 2 },
  ];
}

function updateViewportLabels() {
  if (!el.viewportLabels) return;
  el.viewportLabels.innerHTML = '';
  if (!viewW || !viewH || cameraRigs.length <= 1) return; // no clutter for a single full-screen view
  const rects = viewportLayout(cameraRigs.length, viewW, viewH);
  cameraRigs.forEach((rig, i) => {
    const r = rects[i];
    const tag = document.createElement('div');
    tag.className = 'viewport-tag';
    tag.style.left = `${r.x + 10}px`;
    tag.style.top = `${r.y + 10}px`;
    tag.style.background = rig.color;
    tag.textContent = rig.name;
    el.viewportLabels.appendChild(tag);
  });
}

function buildItemBoxMeshes() {
  itemBoxMeshes.forEach((m) => scene.remove(m));
  const geo = new THREE.BoxGeometry(18, 18, 18);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffd23f' });
  itemBoxMeshes = state.itemBoxes.map((box) => {
    const mesh = new THREE.Mesh(geo, mat);
    const wp = toWorld(box.x, box.y);
    mesh.position.set(wp.x, 12, wp.z);
    scene.add(mesh);
    return mesh;
  });
}

function syncBananaMeshes() {
  for (const [banana, mesh] of bananaMeshes) {
    if (!state.bananas.includes(banana)) {
      scene.remove(mesh);
      bananaMeshes.delete(banana);
    }
  }
  for (const banana of state.bananas) {
    if (!bananaMeshes.has(banana)) {
      const mesh = new THREE.Mesh(bananaGeo, bananaMat);
      scene.add(mesh);
      bananaMeshes.set(banana, mesh);
    }
    const wp = toWorld(banana.x, banana.y);
    bananaMeshes.get(banana).position.set(wp.x, 5, wp.z);
  }
}

function updateChaseCameraForRig(rig, dt) {
  const kart = state.karts[rig.kartIndex];
  if (!kart) return;
  const wp = toWorld(kart.x, kart.y);
  const dirX = Math.cos(kart.angle);
  const dirZ = Math.sin(kart.angle);

  const desiredPos = new THREE.Vector3(wp.x - dirX * CAM_BACK, CAM_HEIGHT, wp.z - dirZ * CAM_BACK);
  const desiredLook = new THREE.Vector3(wp.x + dirX * CAM_LOOK_AHEAD, CAM_LOOK_HEIGHT, wp.z + dirZ * CAM_LOOK_AHEAD);

  if (!rig.ready) {
    rig.camPos.copy(desiredPos);
    rig.camLook.copy(desiredLook);
    rig.ready = true;
  } else {
    const t = 1 - Math.pow(0.0005, dt); // frame-rate independent smoothing
    rig.camPos.lerp(desiredPos, t);
    rig.camLook.lerp(desiredLook, t);
  }
  rig.camera.position.copy(rig.camPos);
  rig.camera.lookAt(rig.camLook);
}

function updateSceneObjects(dt) {
  for (let i = 0; i < state.karts.length; i++) {
    const kart = state.karts[i];
    const group = kartGroups[i];
    if (!group) continue;
    const wp = toWorld(kart.x, kart.y);
    group.position.set(wp.x, 0, wp.z);
    group.rotation.y = -kart.angle;

    const flicker = kart.stunTimer > 0 ? 0.5 + 0.5 * Math.sin(performance.now() / 40) : 1;
    group.userData.body.material.opacity = flicker;
    group.userData.body.material.transparent = kart.stunTimer > 0;
  }

  itemBoxMeshes.forEach((mesh, i) => {
    const box = state.itemBoxes[i];
    mesh.visible = box.active;
    mesh.rotation.y += dt * 1.6;
    mesh.position.y = 12 + Math.sin(performance.now() / 300 + i) * 2;
  });

  syncBananaMeshes();
}

function render(dt) {
  if (!renderer || cameraRigs.length === 0) return;
  updateSceneObjects(dt);

  const n = cameraRigs.length;
  const GAP = n > 1 ? 4 : 0;
  const rects = viewportLayout(n, viewW, viewH);

  // Full clear first (scissor off) so the gap between panels reads as a
  // clean divider rather than leftover pixels from a previous frame.
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, viewW, viewH);
  renderer.setClearColor('#0c0d11', 1);
  renderer.clear();
  renderer.setScissorTest(true);

  cameraRigs.forEach((rig, i) => {
    const r = rects[i];
    const x = r.x + GAP / 2;
    const yTop = r.y + GAP / 2;
    const pw = Math.max(1, r.w - GAP);
    const ph = Math.max(1, r.h - GAP);
    const yGL = viewH - yTop - ph; // three.js viewport/scissor origin is bottom-left

    renderer.setViewport(x, yGL, pw, ph);
    renderer.setScissor(x, yGL, pw, ph);
    rig.camera.aspect = pw / ph;
    rig.camera.updateProjectionMatrix();
    updateChaseCameraForRig(rig, dt);
    renderer.render(scene, rig.camera);
  });

  renderer.setScissorTest(false);
  renderMinimap();
}

function renderMinimap() {
  const w = el.minimapCanvas.width;
  const h = el.minimapCanvas.height;
  const scale = Math.min(w / (TRACK.WIDTH + 60), h / (TRACK.HEIGHT + 60));
  const offsetX = (w - TRACK.WIDTH * scale) / 2;
  const offsetY = (h - TRACK.HEIGHT * scale) / 2;

  minimapCtx.clearRect(0, 0, w, h);
  minimapCtx.save();
  minimapCtx.translate(offsetX, offsetY);
  minimapCtx.scale(scale, scale);

  minimapCtx.strokeStyle = 'rgba(244,241,230,0.85)';
  minimapCtx.lineWidth = 10;
  minimapCtx.lineJoin = 'round';
  minimapCtx.beginPath();
  TRACK.points.forEach((p, i) => (i === 0 ? minimapCtx.moveTo(p.x, p.y) : minimapCtx.lineTo(p.x, p.y)));
  minimapCtx.closePath();
  minimapCtx.stroke();

  for (const kart of state.karts) {
    minimapCtx.fillStyle = kart.color;
    minimapCtx.beginPath();
    minimapCtx.arc(kart.x, kart.y, 14, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  minimapCtx.restore();
}

function resizeCanvas() {
  const rect = el.race.getBoundingClientRect();
  if (!renderer) return;
  viewW = rect.width;
  viewH = rect.height;
  renderer.setSize(viewW, viewH, false);
  updateViewportLabels();
}
window.addEventListener('resize', () => {
  if (el.race.style.display !== 'none') resizeCanvas();
});

// ---------------------------------------------------------------- Boot

renderLobby();
initPeer();
