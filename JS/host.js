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
};

const ctx = el.trackCanvas.getContext('2d');

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
    render();
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

// ---------------------------------------------------------------- Rendering

function resizeCanvas() {
  const rect = el.race.getBoundingClientRect();
  el.trackCanvas.width = rect.width;
  el.trackCanvas.height = rect.height;
}
window.addEventListener('resize', () => {
  if (el.race.style.display !== 'none') resizeCanvas();
});

function worldToScreen() {
  const scale = Math.min(
    el.trackCanvas.width / (TRACK.WIDTH + 200),
    el.trackCanvas.height / (TRACK.HEIGHT + 200)
  );
  const offsetX = (el.trackCanvas.width - TRACK.WIDTH * scale) / 2;
  const offsetY = (el.trackCanvas.height - TRACK.HEIGHT * scale) / 2;
  return { scale, offsetX, offsetY };
}

function render() {
  const { scale, offsetX, offsetY } = worldToScreen();
  const w = el.trackCanvas.width;
  const h = el.trackCanvas.height;

  ctx.fillStyle = '#2f8f5b';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  // Track surface.
  drawTrackShape(TRACK.TRACK_WIDTH + 26, '#e7473c'); // curb (red edge)
  drawTrackShape(TRACK.TRACK_WIDTH, '#33384a'); // asphalt

  // Dashed centerline.
  ctx.strokeStyle = 'rgba(244,241,230,0.4)';
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 16]);
  ctx.beginPath();
  TRACK.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Start/finish line.
  const startP = TRACK.pointAt(TRACK.startIndex);
  const startHeading = TRACK.headingAt(TRACK.startIndex);
  ctx.save();
  ctx.translate(startP.x, startP.y);
  ctx.rotate(startHeading);
  ctx.fillStyle = '#f4f1e6';
  ctx.fillRect(-4, -TRACK.TRACK_WIDTH / 2, 8, TRACK.TRACK_WIDTH);
  ctx.restore();

  // Item boxes.
  for (const box of state.itemBoxes) {
    if (!box.active) continue;
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.fillStyle = '#ffd23f';
    ctx.strokeStyle = '#a97e00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-16, -16, 32, 32, 6);
    } else {
      ctx.rect(-16, -16, 32, 32);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#a97e00';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.restore();
  }

  // Bananas.
  for (const b of state.bananas) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.fillStyle = '#f2d024';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 7, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Karts.
  for (const kart of state.karts) {
    drawKart(kart);
  }

  ctx.restore();
}

function drawTrackShape(width, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  TRACK.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawKart(kart) {
  ctx.save();
  ctx.translate(kart.x, kart.y);
  ctx.rotate(kart.angle);

  if (kart.stunTimer > 0) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 40);
  }
  if (kart.boostTimer > 0) {
    ctx.fillStyle = 'rgba(255,170,60,0.6)';
    ctx.beginPath();
    ctx.ellipse(-22, 0, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = kart.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-12, 10);
  ctx.lineTo(-12, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  ctx.save();
  ctx.fillStyle = 'rgba(18,21,31,0.8)';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(kart.name, kart.x, kart.y - 22);
  ctx.restore();
}

// ---------------------------------------------------------------- Boot

renderLobby();
initPeer();
