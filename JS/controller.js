// controller.js — runs on the player's phone. No game logic lives here:
// it just reads touch state and streams it to the host over a PeerJS
// data connection, and shows a tiny status HUD sent back by the host.

const el = {
  status: document.getElementById('status'),
  joinForm: document.getElementById('join-form'),
  codeInput: document.getElementById('code-input'),
  joinBtn: document.getElementById('join-btn'),
  pad: document.getElementById('pad'),
  leftBtn: document.getElementById('left-btn'),
  rightBtn: document.getElementById('right-btn'),
  gasBtn: document.getElementById('gas-btn'),
  itemBtn: document.getElementById('item-btn'),
};

const input = { throttle: 0, steer: 0 };
let hasItem = false;
let peer = null;
let conn = null;
let myColor = null;

function setStatus(text, kind) {
  el.status.textContent = text;
  el.status.className = 'controller-status' + (kind ? ` ${kind}` : '');
}

function connectTo(hostId) {
  setStatus('Conectando à corrida…');
  peer = new Peer();

  peer.on('open', () => {
    conn = peer.connect(hostId, { reliable: true });

    conn.on('open', () => {
      setStatus('Conectado! Aguardando início…', 'connected');
      el.joinForm.style.display = 'none';
      el.pad.style.display = 'grid';
    });

    conn.on('data', handleHostMessage);

    conn.on('close', () => {
      setStatus('Conexão perdida com a tela principal.', 'error');
    });
  });

  peer.on('error', (err) => {
    console.warn('Peer error', err);
    setStatus('Não foi possível conectar. Confira o código e tente de novo.', 'error');
    el.joinForm.style.display = 'flex';
    el.pad.style.display = 'none';
  });
}

function handleHostMessage(msg) {
  if (msg.type === 'full') {
    setStatus('A sala já está cheia.', 'error');
  } else if (msg.type === 'assigned') {
    myColor = msg.color;
    document.body.style.borderTop = `6px solid ${myColor}`;
  } else if (msg.type === 'race-start') {
    setStatus('Corrida em andamento!', 'connected');
  } else if (msg.type === 'state') {
    hasItem = !!msg.item;
    el.itemBtn.disabled = !hasItem;
    el.itemBtn.textContent = hasItem ? (msg.item === 'boost' ? 'TURBO!' : 'CASCA') : 'ITEM';
    setStatus(`${msg.position}º de ${msg.total} — volta ${msg.lap}/${msg.totalLaps}`, 'connected');
  } else if (msg.type === 'finished') {
    setStatus(`Corrida terminada — você ficou em ${msg.position}º lugar!`, 'connected');
    el.pad.style.display = 'none';
  }
}

function send() {
  if (conn && conn.open) {
    conn.send({ throttle: input.throttle, steer: input.steer });
  }
}
setInterval(send, 50);

function bindHold(btn, onDown, onUp) {
  const down = (e) => { e.preventDefault(); onDown(); };
  const up = (e) => { e.preventDefault(); onUp(); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('pointercancel', up);
}

bindHold(el.leftBtn, () => (input.steer = -1), () => { if (input.steer < 0) input.steer = 0; });
bindHold(el.rightBtn, () => (input.steer = 1), () => { if (input.steer > 0) input.steer = 0; });
bindHold(el.gasBtn, () => (input.throttle = 1), () => (input.throttle = 0));

el.itemBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!hasItem || !conn || !conn.open) return;
  conn.send({ throttle: input.throttle, steer: input.steer, useItem: true });
});

el.joinBtn.addEventListener('click', () => {
  const code = el.codeInput.value.trim().toLowerCase();
  if (code.length !== 4) {
    setStatus('Digite os 4 caracteres do código.', 'error');
    return;
  }
  connectTo(`kart-${code}`);
});

// ---------------------------------------------------------------- Boot

const params = new URLSearchParams(location.search);
const hostParam = params.get('host');
if (hostParam) {
  connectTo(hostParam);
} else {
  setStatus('Digite o código da sala para entrar.');
  el.joinForm.style.display = 'flex';
}
