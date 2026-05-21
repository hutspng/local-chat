(function () {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const statusLine = document.getElementById("statusLine");
  const hpValue = document.getElementById("hpValue");
  const ammoValue = document.getElementById("ammoValue");
  const roleValue = document.getElementById("roleValue");
  const nameOverlay = document.getElementById("nameOverlay");
  const nameInput = document.getElementById("nameInput");
  const joinBtn = document.getElementById("joinBtn");
  const joinError = document.getElementById("joinError");
  const gameOverOverlay = document.getElementById("gameOverOverlay");

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${location.host}`;
  const params = new URLSearchParams(location.search);

  const localStorageName = localStorage.getItem("chat_name") || "";
  const queryName = params.get("name") || "";
  let initialName = sanitizeName(queryName || localStorageName || "");
  if (initialName === "Anônimo") initialName = "";

  const state = {
    ws: null,
    connected: false,
    map: { width: 2400, height: 1600, walls: [], crates: [], meleePoints: [], gunPoints: [] },
    players: [],
    zombies: [],
    bullets: [],
    items: [],
    me: null,
    followId: null,
    aimWorldX: 0,
    aimWorldY: 0,
    mouseDown: false,
    shootQueued: false,
    meleeQueued: false,
    keys: { up: false, down: false, left: false, right: false, shift: false },
    cameraX: 0,
    cameraY: 0,
    gameOver: false,
    lastSnapshotAt: 0
  };

  const deviceId = getOrCreateDeviceId();
  let resizeRaf = 0;
  let inputTimer = 0;
  let animationFrame = 0;

  function sanitizeName(raw) {
    return String(raw || "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 24) || "Anônimo";
  }

  function getOrCreateDeviceId() {
    let id = localStorage.getItem("chat_device_id");
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("chat_device_id", id);
    }
    return id;
  }

  function setStatus(text) {
    statusLine.textContent = text;
  }

  function setOverlayVisible(overlay, visible) {
    overlay.classList.toggle("show", !!visible);
  }

  function updateCanvasSize() {
    canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  function showNameModal(message = "") {
    if (joinError) joinError.textContent = message;
    setOverlayVisible(nameOverlay, true);
    window.setTimeout(() => nameInput.focus(), 0);
  }

  function hideNameModal() {
    setOverlayVisible(nameOverlay, false);
  }

  function sendIdentity() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    const name = sanitizeName(nameInput.value || initialName || localStorage.getItem("chat_name") || "Anônimo");
    if (!name || name === "Anônimo") return;
    localStorage.setItem("chat_name", name);
    state.ws.send(JSON.stringify({
      type: "set-device-id",
      deviceId,
      name,
      tabActive: true,
      mode: "game"
    }));
  }

  function connect() {
    state.connected = false;
    setStatus("conectando...");
    state.ws = new WebSocket(wsUrl);

    state.ws.addEventListener("open", () => {
      state.connected = true;
      setStatus("conectado ao jogo");
      sendIdentity();
      startInputLoop();
    });

    state.ws.addEventListener("close", () => {
      state.connected = false;
      setStatus("desconectado, tentando reconectar...");
      stopInputLoop();
      window.setTimeout(() => {
        if (!state.gameOver) connect();
      }, 900);
    });

    state.ws.addEventListener("message", (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (data.type === "game-init") {
        state.map = data.map || state.map;
        state.me = data.player || null;
        state.followId = data.player?.spectatingZombieId || data.player?.id || null;
        hideNameModal();
        setStatus("partida iniciada");
      } else if (data.type === "game-state") {
        state.players = Array.isArray(data.players) ? data.players : [];
        state.zombies = Array.isArray(data.zombies) ? data.zombies : [];
        state.bullets = Array.isArray(data.bullets) ? data.bullets : [];
        state.items = Array.isArray(data.items) ? data.items : [];
        state.lastSnapshotAt = data.time || Date.now();
        syncLocalPlayerSnapshot();
      } else if (data.type === "game-over") {
        state.gameOver = true;
        setOverlayVisible(gameOverOverlay, true);
        setStatus(data.text || "Todos perderam");
      } else if (data.type === "name-error") {
        showNameModal(String(data.text || "Nome em uso"));
      }
    });
  }

  function syncLocalPlayerSnapshot() {
    const me = state.players.find((player) => player.deviceId === deviceId) || null;
    if (!me) return;
    state.me = me;
    if (me.state === "zombie") {
      state.followId = me.spectatingZombieId || me.id;
      setStatus("você virou zumbi");
    }
    if (state.followId === null) {
      state.followId = me.id;
    }
    hpValue.textContent = String(Math.max(0, Math.round(me.hp || 0)));
    ammoValue.textContent = String(Math.max(0, Math.round(me.ammo || 0)));
    roleValue.textContent = me.state === "zombie" ? "zumbi" : "humano";
  }

  function startInputLoop() {
    if (inputTimer) return;
    inputTimer = window.setInterval(() => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN || state.gameOver) return;
      state.ws.send(JSON.stringify({
        type: "game-input",
        input: {
          up: state.keys.up,
          down: state.keys.down,
          left: state.keys.left,
          right: state.keys.right,
          shift: state.keys.shift,
          aimX: state.aimWorldX,
          aimY: state.aimWorldY,
          shoot: state.shootQueued,
          melee: state.meleeQueued
        }
      }));
      state.shootQueued = false;
      state.meleeQueued = false;
    }, 50);
  }

  function stopInputLoop() {
    if (!inputTimer) return;
    window.clearInterval(inputTimer);
    inputTimer = 0;
  }

  function worldToScreen(x, y) {
    return {
      x: x - state.cameraX,
      y: y - state.cameraY
    };
  }

  function screenToWorld(x, y) {
    return {
      x: x + state.cameraX,
      y: y + state.cameraY
    };
  }

  function fitCamera() {
    const target = getFollowTarget();
    if (!target) {
      state.cameraX = state.map.width / 2 - canvas.clientWidth / 2;
      state.cameraY = state.map.height / 2 - canvas.clientHeight / 2;
      return;
    }

    state.cameraX = clamp(target.x - canvas.clientWidth / 2, 0, Math.max(0, state.map.width - canvas.clientWidth));
    state.cameraY = clamp(target.y - canvas.clientHeight / 2, 0, Math.max(0, state.map.height - canvas.clientHeight));
  }

  function getFollowTarget() {
    if (!state.me) return null;
    const own = state.players.find((player) => player.deviceId === deviceId) || state.me;
    if (!own) return null;
    if (own.state === "zombie") {
      return state.zombies.find((zombie) => zombie.id === (own.spectatingZombieId || own.id)) || own;
    }
    return own;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function drawRoundedRect(x, y, w, h, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function drawGrid() {
    const grid = 80;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = "#3e5369";
    ctx.lineWidth = 1;
    for (let x = 0; x <= state.map.width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, state.map.height);
      ctx.stroke();
    }
    for (let y = 0; y <= state.map.height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(state.map.width, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWorld() {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    fitCamera();
    const offsetX = -state.cameraX;
    const offsetY = -state.cameraY;

    ctx.save();
    ctx.translate(offsetX, offsetY);

    const bg = ctx.createLinearGradient(0, 0, state.map.width, state.map.height);
    bg.addColorStop(0, "#0a1826");
    bg.addColorStop(1, "#0e2331");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, state.map.width, state.map.height);

    drawGrid();

    for (const wall of state.map.walls || []) {
      drawRoundedRect(wall.x, wall.y, wall.w, wall.h, 8, "#17222f", "rgba(255,255,255,.08)");
    }

    for (const crate of state.map.crates || []) {
      drawRoundedRect(crate.x, crate.y, crate.w, crate.h, 8, "#8a6230", "#5a3a18");
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#c89a5b";
      ctx.fillRect(crate.x + 6, crate.y + 6, crate.w - 12, 6);
      ctx.restore();
    }

    for (const item of state.items || []) {
      if (item.kind === "gun") {
        ctx.fillStyle = "#ffd66e";
        ctx.beginPath();
        ctx.arc(item.x + 12, item.y + 12, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1b1302";
        ctx.fillRect(item.x + 10, item.y + 7, 18, 4);
        ctx.fillRect(item.x + 18, item.y + 4, 4, 10);
      } else {
        ctx.fillStyle = "#d7dce2";
        ctx.fillRect(item.x + 10, item.y + 2, 4, 20);
        ctx.fillRect(item.x + 7, item.y + 9, 10, 4);
      }
      ctx.fillStyle = "rgba(255,255,255,.8)";
      ctx.font = "12px Inter, sans-serif";
      ctx.fillText(item.kind === "gun" ? "+12" : "MELEE", item.x - 1, item.y - 6);
    }

    for (const bullet of state.bullets || []) {
      ctx.fillStyle = "#f8f3d5";
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const zombieIds = new Set((state.players || []).filter((player) => player.state === "zombie").map((player) => player.id));

    for (const player of state.players || []) {
      const isZombie = player.state === "zombie";
      const color = isZombie ? "#ff6767" : (player.deviceId === deviceId ? "#7df0a5" : "#6aa6ff");
      const radius = isZombie ? 17 : 16;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.2)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#f3fbff";
      ctx.font = "13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(player.name + (player.deviceId === deviceId ? " (você)" : ""), player.x, player.y - 24);
      ctx.restore();
    }

    for (const zombie of state.zombies || []) {
      if (zombieIds.has(zombie.id)) continue;
      ctx.save();
      ctx.fillStyle = zombie.isPlayerZombie ? "#ff9667" : "#ff6767";
      ctx.beginPath();
      ctx.arc(zombie.x, zombie.y, 17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.16)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(zombie.ownerName || "zumbi", zombie.x, zombie.y - 24);
      ctx.restore();
    }

    ctx.restore();

    if (state.gameOver) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.restore();
    }
  }

  function animate() {
    drawWorld();
    animationFrame = window.requestAnimationFrame(animate);
  }

  function wireInput() {
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyW") state.keys.up = true;
      if (e.code === "KeyS") state.keys.down = true;
      if (e.code === "KeyA") state.keys.left = true;
      if (e.code === "KeyD") state.keys.right = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") state.keys.shift = true;
      if (e.code === "KeyE") state.meleeQueued = true;
      if (e.code === "Space") {
        e.preventDefault();
        state.shootQueued = true;
      }
      if (e.code === "Enter" && nameOverlay.classList.contains("show")) join();
    });

    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyW") state.keys.up = false;
      if (e.code === "KeyS") state.keys.down = false;
      if (e.code === "KeyA") state.keys.left = false;
      if (e.code === "KeyD") state.keys.right = false;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") state.keys.shift = false;
    });

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      state.aimWorldX = world.x;
      state.aimWorldY = world.y;
    });

    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        state.shootQueued = true;
        state.mouseDown = true;
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) state.mouseDown = false;
    });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  function join() {
    const name = sanitizeName(nameInput.value || initialName || localStorage.getItem("chat_name") || "Anônimo");
    if (!name || name === "Anônimo") {
      showNameModal("Digite um nome para entrar no jogo.");
      return;
    }
    initialName = name;
    nameInput.value = name;
    joinError.textContent = "";
    hideNameModal();
    localStorage.setItem("chat_name", name);
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) connect();
    else sendIdentity();
  }

  function scheduleResize() {
    window.clearTimeout(resizeRaf);
    resizeRaf = window.setTimeout(() => updateCanvasSize(), 120);
  }

  joinBtn.addEventListener("click", join);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") join();
  });

  window.addEventListener("resize", scheduleResize);
  window.addEventListener("blur", () => {
    state.mouseDown = false;
  });

  updateCanvasSize();
  wireInput();
  animate();

  if (initialName) {
    nameInput.value = initialName;
    hideNameModal();
    connect();
  } else {
    showNameModal("Seu nome do chat será usado se estiver salvo.");
  }
})();
