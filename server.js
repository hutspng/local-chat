// Chat local (LAN) com WebSocket
// Como rodar:
// 1) npm init -y
// 2) npm i express ws
// 3) node server.js
// Acesse: http://IP_DO_SERVIDOR:3000

const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const { Transform } = require("stream");

const PORT = process.env.PORT || 3000;
const CHAT_HOSTNAME = String(process.env.CHAT_HOSTNAME || "local-chat.lan").trim() || "local-chat.lan";

const app = express();

// CORS middleware - permite conexões da rede local
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Cache para mídia (vídeos/imagens grandes), para evitar data URLs gigantes
const mediaCache = new Map();
let mediaCacheCounter = 0;
const MEDIA_CACHE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutos (aumentado)
const LARGE_FILE_CACHE_THRESHOLD_BASE64 = 5_000_000;

function storeMediaInCache(base64Data, mimeType, fileName) {
  const mediaId = `media_${++mediaCacheCounter}`;
  
  // Validar entrada
  if (!base64Data || typeof base64Data !== 'string' || base64Data.length === 0) {
    console.error(`[CACHE] Entrada inválida para cache: base64 vazia`);
    return null;
  }

  const timeoutId = setTimeout(() => {
    console.log(`[CACHE] Limpando media ${mediaId} após timeout`);
    mediaCache.delete(mediaId);
  }, MEDIA_CACHE_TIMEOUT_MS);

  mediaCache.set(mediaId, {
    base64: base64Data,
    mimeType,
    fileName,
    timeoutId,
    storedAt: Date.now(),
    size: base64Data.length
  });

  console.log(`[CACHE] Armazenado ${mediaId}: ${mimeType}, ${(base64Data.length / 1024 / 1024).toFixed(2)}MB`);
  return mediaId;
}

// Rota para servir mídia com suporte a Range (streaming)
app.get("/media/:mediaId", (req, res) => {
  const { mediaId } = req.params;
  const cached = mediaCache.get(mediaId);

  if (!cached) {
    console.error(`[MEDIA] ${mediaId} não encontrado no cache. IDs disponíveis:`, Array.from(mediaCache.keys()));
    return res.status(404).json({ error: "Mídia não encontrada" });
  }

  console.log(`[MEDIA] Servindo ${mediaId}: ${cached.mimeType}, ${(cached.size / 1024 / 1024).toFixed(2)}MB`);

  try {
    const base64 = cached.base64;
    
    if (!base64 || base64.length === 0) {
      console.error(`[MEDIA] ${mediaId} tem base64 vazio`);
      return res.status(500).json({ error: "Mídia corrompida" });
    }
    
    // Calcular tamanho binário estimado (base64 é 4/3 do tamanho original)
    const binarySize = Math.ceil(base64.length * 0.75);

    console.log(`[MEDIA] Base64 size: ${base64.length}, binary size: ${binarySize}`);

    res.set("Accept-Ranges", "bytes");
    res.set("Content-Type", cached.mimeType || "application/octet-stream");
    const safeFileName = String(cached.fileName || "arquivo").replace(/[\r\n"]/g, "_");
    const inlineMime = /^(image|video|audio)\//.test(String(cached.mimeType || "").toLowerCase());
    const disposition = inlineMime ? "inline" : "attachment";
    res.set("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(safeFileName)}`);

    // Suporte a Range requests
    const range = req.headers.range;
      if (range) {
        // Log básico para debug de problemas de streaming
        console.log(`[MEDIA] Requisição /media/${mediaId} de ${req.ip} com Range: ${range}`);

        // Não suportamos ranges múltiplos (ex: bytes=0-1,2-3)
        if (String(range).includes(",")) {
          res.status(416).set("Content-Range", `bytes */${binarySize}`).end();
          return;
        }

        try {
          const parts = range.replace(/bytes=/, "").split("-");
          let start;
          let end;

          if (parts.length === 2) {
            // Suffix range: bytes=-N  (últimos N bytes)
            if (parts[0] === "") {
              const suffix = parseInt(parts[1], 10);
              if (Number.isNaN(suffix)) {
                res.status(416).set("Content-Range", `bytes */${binarySize}`).end();
                return;
              }
              start = Math.max(0, binarySize - suffix);
              end = binarySize - 1;
            } else {
              start = parseInt(parts[0], 10);
              end = parts[1] ? parseInt(parts[1], 10) : binarySize - 1;
            }
          } else {
            res.status(416).set("Content-Range", `bytes */${binarySize}`).end();
            return;
          }

          if (!Number.isInteger(start) || Number.isNaN(start) || !Number.isInteger(end) || Number.isNaN(end)) {
            res.status(416).set("Content-Range", `bytes */${binarySize}`).end();
            return;
          }

          // Clamp
          if (start < 0) start = 0;
          if (end >= binarySize) end = binarySize - 1;
          if (start > end) {
            res.status(416).set("Content-Range", `bytes */${binarySize}`).end();
            return;
          }

          // Calcular qual parte do base64 é necessária (alinhado a múltiplos de 4)
          const startBase64Idx = Math.floor(start / 3) * 4;
          const endBinary = Math.min(end + 1, binarySize);
          const endBase64Idx = Math.min(Math.ceil(endBinary / 3) * 4, base64.length);

          const base64Chunk = base64.slice(startBase64Idx, endBase64Idx);
          const decodedBuffer = Buffer.from(base64Chunk, "base64");

          const offsetInBuffer = start - Math.floor(startBase64Idx / 4) * 3;
          const lengthNeeded = end - start + 1;
          const slicedBuffer = decodedBuffer.slice(offsetInBuffer, offsetInBuffer + lengthNeeded);

          console.log(`[MEDIA] Servindo range ${start}-${end} (${slicedBuffer.length} bytes) para ${req.ip}`);

          res.status(206);
          res.set("Content-Range", `bytes ${start}-${end}/${binarySize}`);
          res.set("Content-Length", slicedBuffer.length);
          res.end(slicedBuffer);
        } catch (err) {
          console.error(`[MEDIA] Erro ao processar Range request para ${mediaId}:`, err);
          res.status(500).end();
        }
      } else {
      res.set("Content-Length", binarySize);
      res.set("Cache-Control", "public, max-age=3600");
      
      // Decodificar e servir em chunks de 64KB para evitar memory spike
      const STREAM_CHUNK = 64 * 1024; // 64KB chunks
      let base64Idx = 0;
      
      const sendChunk = () => {
        if (base64Idx >= base64.length) {
          console.log(`[MEDIA] Finalizado streaming de ${mediaId}`);
          res.end();
          return;
        }
        
        // Processar múltiplos de 4 caracteres base64 (cada 4 = 3 bytes)
        const base64End = Math.min(base64Idx + STREAM_CHUNK * 4 / 3, base64.length);
        // Arredondar para múltiplo de 4
        const roundedEnd = Math.floor(base64End / 4) * 4;
        
        if (roundedEnd <= base64Idx) {
          // Se não há múltiplo de 4 completo, pegar o resto
          const chunk = Buffer.from(base64.slice(base64Idx), "base64");
          if (chunk.length > 0) {
            if (!res.write(chunk)) {
              res.once('drain', () => {
                base64Idx = base64.length;
                setImmediate(sendChunk);
              });
            } else {
              base64Idx = base64.length;
              setImmediate(sendChunk);
            }
          } else {
            setImmediate(sendChunk);
          }
          return;
        }
        
        try {
          const base64Chunk = base64.slice(base64Idx, roundedEnd);
          const buffer = Buffer.from(base64Chunk, "base64");
          base64Idx = roundedEnd;
          
          if (!res.write(buffer)) {
            res.once('drain', sendChunk);
          } else {
            setImmediate(sendChunk);
          }
        } catch (err) {
          console.error(`[MEDIA] Erro ao decodificar base64 para ${mediaId}:`, err);
          res.end();
        }
      };
      
      sendChunk();
    }
  } catch (err) {
    console.error(`[MEDIA] Erro ao servir ${mediaId}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro ao servir mídia" });
    } else {
      res.end();
    }
  }
});

app.get("/chat-config", (req, res) => {
  res.json({
    port: Number(PORT),
    preferredHostname: CHAT_HOSTNAME,
    preferredOrigin: `http://${CHAT_HOSTNAME}:${PORT}`
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false,
  // Permitir conexões de qualquer origem (rede local)
  verifyClient: (info) => {
    // Aceita qualquer origem - útil para rede local
    return true;
  }
});

const clients = new Set();
const activeUsers = new Map(); // deviceId -> Set of WebSocket connections
// Mapeia nome normalizado -> deviceId (ajuda garantir nomes únicos por dispositivo)
const nameToDevice = new Map();
const blockedNames = new Set();
const localIpv4Addresses = new Set();

for (const interfaces of Object.values(os.networkInterfaces())) {
  for (const iface of interfaces || []) {
    if (iface.family === "IPv4" && !iface.internal) {
      localIpv4Addresses.add(iface.address);
    }
  }
}
const chatHistory = [];
const MAX_HISTORY = 200;
let messageIdCounter = 0;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_CHUNK_BASE64_CHARS = 500_000;
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LINES = 100;
const MAX_MESSAGE_CHARS = 10000;

function normalizeName(raw) {
  const compact = String(raw || "Anônimo").trim().replace(/\s+/g, "_").slice(0, 24);
  return compact || "Anônimo";
}

function normalizeMessageText(raw) {
  const limitedChars = String(raw || "").slice(0, MAX_MESSAGE_CHARS);
  const normalizedBreaks = limitedChars.replace(/\r\n/g, "\n");
  const lines = normalizedBreaks.split("\n");
  if (lines.length <= MAX_MESSAGE_LINES) return normalizedBreaks;
  return lines.slice(0, MAX_MESSAGE_LINES).join("\n");
}

function nowTime() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function pushChatHistory(entry) {
  chatHistory.push(entry);
  if (chatHistory.length > MAX_HISTORY) {
    chatHistory.splice(0, chatHistory.length - MAX_HISTORY);
  }
}

function publishChat(entry) {
  entry.messageId = `msg_${++messageIdCounter}`;
  broadcast(entry);
  pushChatHistory(entry);
}

function parseMentionedMessageIds(text) {
  const mentionedIds = new Set();
  const source = String(text || "");
  const regex = /@([^\s/]+)\/([^\s\]]+)/g;

  for (const match of source.matchAll(regex)) {
    const messageId = String(match[2] || "").slice(0, 64);
    if (messageId) mentionedIds.add(messageId);
  }

  return mentionedIds;
}

function removeMessageCascade(targetMessageId) {
  const targetId = String(targetMessageId || "").slice(0, 64);
  if (!targetId) return [];

  const entriesById = new Map();
  const referencesById = new Map();

  for (const entry of chatHistory) {
    if (!entry || !entry.messageId) continue;
    entriesById.set(entry.messageId, entry);
    referencesById.set(entry.messageId, parseMentionedMessageIds(entry.text));
  }

  if (!entriesById.has(targetId)) return [];

  const doomed = new Set([targetId]);
  let changed = true;

  while (changed) {
    changed = false;
    for (const [messageId, refs] of referencesById.entries()) {
      if (doomed.has(messageId)) continue;
      for (const ref of refs) {
        if (doomed.has(ref)) {
          doomed.add(messageId);
          changed = true;
          break;
        }
      }
    }
  }

  if (!doomed.size) return [];

  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const entry = chatHistory[i];
    if (entry && doomed.has(entry.messageId)) {
      chatHistory.splice(i, 1);
    }
  }

  return Array.from(doomed);
}

function broadcastHistoryRefresh() {
  broadcast({
    type: "history-refresh",
    messages: chatHistory,
    at: nowTime()
  });
}

function buildPeopleList() {
  const people = [];
  for (const [deviceId, sockets] of activeUsers.entries()) {
    let name = "Anônimo";
    let tabActive = false;

    for (const socket of sockets) {
      if (!socket) continue;
      if (socket.userName) name = socket.userName;
      if (socket.tabActive) tabActive = true;
    }

    people.push({
      deviceId,
      name,
      tabActive,
      connections: sockets.size
    });
  }

  people.sort((a, b) => {
    if (a.tabActive !== b.tabActive) return a.tabActive ? -1 : 1;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });

  return people;
}

function normalizeNameKey(name) {
  return String(name || "").trim().toLocaleLowerCase("pt-BR");
}

function normalizeRemoteAddress(address) {
  return String(address || "")
    .replace(/^::ffff:/, "")
    .trim();
}

function isHostMachineAddress(address) {
  const normalized = normalizeRemoteAddress(address);
  return normalized === "127.0.0.1" || normalized === "::1" || localIpv4Addresses.has(normalized);
}

function isNameBlocked(name) {
  const key = normalizeNameKey(name);
  return !!key && blockedNames.has(key);
}

function isNameInUse(name, excludeDeviceId = null) {
  const key = normalizeNameKey(name);
  if (!key) return false;

  for (const [deviceId, sockets] of activeUsers.entries()) {
    if (excludeDeviceId && deviceId === excludeDeviceId) continue;

    for (const socket of sockets) {
      if (!socket || !socket.userName) continue;
      if (normalizeNameKey(socket.userName) === key) {
        return true;
      }
    }
  }

  return false;
}

function sendNameError(ws, attemptedName, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const text = message || `O nome "${attemptedName}" já está em uso. Escolha outro.`;
  ws.send(JSON.stringify({
    type: "name-error",
    attemptedName,
    text,
    at: nowTime()
  }));
}

function broadcastPeopleList() {
  broadcast({
    type: "people-list",
    people: buildPeopleList(),
    at: nowTime()
  });
}

const GAME = {
  width: 2400,
  height: 1600,
  players: new Map(),
  sockets: new Set(),
  bullets: [],
  crates: [],
  items: [],
  zombies: [],
  walls: [],
  nextIds: { player: 1, zombie: 1, bullet: 1, crate: 1, item: 1 },
  nextGunSpawnAt: Date.now() + 60_000,
  gameOver: false,
  gameOverAt: 0,
  mapReady: false
};

const GAME_SPAWNS = [
  { x: 220, y: 220 },
  { x: 2180, y: 220 },
  { x: 220, y: 1380 },
  { x: 2180, y: 1380 },
  { x: 1200, y: 800 }
];

const GAME_ZOMBIE_SPAWNS = [
  { x: 120, y: 100 },
  { x: 2280, y: 100 },
  { x: 120, y: 1500 },
  { x: 2280, y: 1500 },
  { x: 1200, y: 120 },
  { x: 1200, y: 1480 }
];

const GAME_GUN_SPAWNS = [
  { x: 380, y: 360 },
  { x: 2060, y: 360 },
  { x: 380, y: 1260 },
  { x: 2060, y: 1260 },
  { x: 1200, y: 260 },
  { x: 1200, y: 1340 }
];

const GAME_MELEE_SPAWNS = [
  { x: 520, y: 800 },
  { x: 1880, y: 800 }
];

function nextGameId(prefix, key) {
  GAME.nextIds[key] += 1;
  return `${prefix}_${GAME.nextIds[key]}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function circleRectCollision(cx, cy, radius, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.w);
  const closestY = clamp(cy, rect.y, rect.y + rect.h);
  return distSq(cx, cy, closestX, closestY) <= radius * radius;
}

function rectRectCollision(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function buildGameWorld() {
  if (GAME.mapReady) return;

  GAME.mapReady = true;
  GAME.walls = [
    { x: 0, y: 0, w: GAME.width, h: 40 },
    { x: 0, y: GAME.height - 40, w: GAME.width, h: 40 },
    { x: 0, y: 0, w: 40, h: GAME.height },
    { x: GAME.width - 40, y: 0, w: 40, h: GAME.height },
    { x: 300, y: 260, w: 1800, h: 36 },
    { x: 300, y: 1340, w: 1800, h: 36 },
    { x: 520, y: 460, w: 36, h: 980 },
    { x: 1840, y: 460, w: 36, h: 980 },
    { x: 760, y: 460, w: 36, h: 320 },
    { x: 760, y: 1140, w: 36, h: 320 },
    { x: 1560, y: 460, w: 36, h: 320 },
    { x: 1560, y: 1140, w: 36, h: 320 },
    { x: 940, y: 820, w: 520, h: 36 }
  ];

  GAME.crates = [
    { id: nextGameId("crate", "crate"), x: 640, y: 560, w: 46, h: 46, vx: 0, vy: 0 },
    { id: nextGameId("crate", "crate"), x: 760, y: 620, w: 46, h: 46, vx: 0, vy: 0 },
    { id: nextGameId("crate", "crate"), x: 920, y: 1080, w: 46, h: 46, vx: 0, vy: 0 },
    { id: nextGameId("crate", "crate"), x: 1500, y: 1080, w: 46, h: 46, vx: 0, vy: 0 },
    { id: nextGameId("crate", "crate"), x: 1780, y: 620, w: 46, h: 46, vx: 0, vy: 0 },
    { id: nextGameId("crate", "crate"), x: 480, y: 980, w: 46, h: 46, vx: 0, vy: 0 }
  ];

  GAME.items = [];
  GAME.GUN_COUNT = 0;
  GAME.GUN_LIMIT = 3;

  for (const spawn of GAME_MELEE_SPAWNS) {
    GAME.items.push({
      id: nextGameId("item", "item"),
      kind: "melee",
      label: "Melee",
      x: spawn.x,
      y: spawn.y,
      w: 24,
      h: 24,
      respawnAt: 0,
      picked: false
    });
  }

  for (let i = 0; i < 6; i += 1) {
    const spawn = GAME_GUN_SPAWNS[i % GAME_GUN_SPAWNS.length];
    GAME.items.push({
      id: nextGameId("item", "item"),
      kind: "gun",
      label: "Arma",
      x: spawn.x,
      y: spawn.y,
      w: 24,
      h: 24,
      ammo: 12,
      respawnAt: 0,
      picked: false,
      fixed: i < 2
    });
  }

  GAME.zombies = [];
  for (let i = 0; i < 8; i += 1) {
    spawnZombieAt(GAME_ZOMBIE_SPAWNS[i % GAME_ZOMBIE_SPAWNS.length], false);
  }
}

function spawnZombieAt(spawn, fromPlayer = false, ownerDeviceId = null, ownerName = "") {
  const zombie = {
    id: nextGameId("zombie", "zombie"),
    ownerDeviceId,
    ownerName,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: 16,
    speed: fromPlayer ? 1.8 : 1.55,
    hp: fromPlayer ? 4 : 3,
    stunUntil: 0,
    respawnAt: 0,
    wanderAngle: Math.random() * Math.PI * 2,
    lastAttackAt: 0,
    isPlayerZombie: fromPlayer
  };
  GAME.zombies.push(zombie);
  return zombie;
}

function spawnBullet(player, aimX, aimY) {
  const dx = aimX - player.x;
  const dy = aimY - player.y;
  const len = Math.hypot(dx, dy) || 1;
  const speed = 13;
  GAME.bullets.push({
    id: nextGameId("bullet", "bullet"),
    x: player.x + (dx / len) * 22,
    y: player.y + (dy / len) * 22,
    vx: (dx / len) * speed,
    vy: (dy / len) * speed,
    radius: 4,
    ttl: 140,
    ownerDeviceId: player.deviceId
  });
}

function spawnGunIfNeeded(now) {
  if (now < GAME.nextGunSpawnAt) return;
  const activeGunCount = GAME.items.filter((item) => item.kind === "gun" && !item.picked).length;
  if (activeGunCount < GAME.GUN_LIMIT) {
    const spawn = GAME_GUN_SPAWNS[Math.floor(Math.random() * GAME_GUN_SPAWNS.length)];
    GAME.items.push({
      id: nextGameId("item", "item"),
      kind: "gun",
      label: "Arma",
      x: spawn.x,
      y: spawn.y,
      w: 24,
      h: 24,
      ammo: 12,
      respawnAt: 0,
      picked: false
    });
  }
  GAME.nextGunSpawnAt = now + 60_000;
}

function spawnGamePlayer(ws, deviceId, name) {
  buildGameWorld();
  const existing = GAME.players.get(deviceId);
  if (existing) {
    existing.name = name;
    existing.ws = ws;
    existing.online = true;
    return existing;
  }

  const spawn = GAME_SPAWNS[Math.floor(Math.random() * GAME_SPAWNS.length)];
  const player = {
    id: nextGameId("player", "player"),
    deviceId,
    name,
    ws,
    online: true,
    state: "human",
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: 16,
    speed: 3.1,
    hp: 100,
    ammo: 0,
    weapon: "none",
    melee: false,
    lastShotAt: 0,
    lastMeleeAt: 0,
    input: { up: false, down: false, left: false, right: false, aimX: spawn.x, aimY: spawn.y, shoot: false, melee: false },
    spectatingZombieId: null,
    respawnZombieId: null
  };

  GAME.players.set(deviceId, player);
  return player;
}

function removeGameConnection(ws) {
  if (!ws.gameDeviceId) return;
  const player = GAME.players.get(ws.gameDeviceId);
  if (!player) return;

  player.ws = null;
  player.online = false;

  if (player.state === "human") {
    GAME.players.delete(ws.gameDeviceId);
  }
}

function getNearestHuman(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const player of GAME.players.values()) {
    if (player.state !== "human") continue;
    const d = distSq(x, y, player.x, player.y);
    if (d < bestDist) {
      bestDist = d;
      best = player;
    }
  }
  return best;
}

function moveCircleWithCollisions(entity, dx, dy, radius, pushStrength = 0) {
  const tryMoveAxis = (axis) => {
    if (axis === "x") entity.x += dx;
    else entity.y += dy;

    entity.x = clamp(entity.x, radius + 40, GAME.width - radius - 40);
    entity.y = clamp(entity.y, radius + 40, GAME.height - radius - 40);

    for (const wall of GAME.walls) {
      if (circleRectCollision(entity.x, entity.y, radius, wall)) {
        if (axis === "x") entity.x -= dx;
        else entity.y -= dy;
        return false;
      }
    }

    for (const crate of GAME.crates) {
      const crateRect = crate;
      if (!circleRectCollision(entity.x, entity.y, radius, crateRect)) continue;
      if (pushStrength > 0) {
        const tx = crate.x + crate.w / 2 - entity.x;
        const ty = crate.y + crate.h / 2 - entity.y;
        const len = Math.hypot(tx, ty) || 1;
        crate.vx += (tx / len) * pushStrength;
        crate.vy += (ty / len) * pushStrength;
      }
      if (axis === "x") entity.x -= dx;
      else entity.y -= dy;
      return false;
    }

    return true;
  };

  tryMoveAxis("x");
  tryMoveAxis("y");
}

function rectCollisionWithWorld(rect) {
  for (const wall of GAME.walls) {
    if (rectRectCollision(rect, wall)) return true;
  }
  for (const crate of GAME.crates) {
    if (rectRectCollision(rect, crate)) return true;
  }
  return false;
}

function placeCrateOutsideCollision(crate) {
  crate.x = clamp(crate.x, 52, GAME.width - crate.w - 52);
  crate.y = clamp(crate.y, 52, GAME.height - crate.h - 52);
  if (!rectCollisionWithWorld(crate)) return;
  const snap = [
    { x: 60, y: 60 }, { x: GAME.width - 110, y: 60 },
    { x: 60, y: GAME.height - 110 }, { x: GAME.width - 110, y: GAME.height - 110 }
  ];
  for (const p of snap) {
    crate.x = p.x;
    crate.y = p.y;
    if (!rectCollisionWithWorld(crate)) break;
  }
}

function convertPlayerToZombie(player) {
  if (!player || player.state !== "human") return null;
  player.state = "zombie";
  player.hp = 3;
  player.radius = 16;
  player.speed = 1.6;
  player.weapon = "none";
  player.ammo = 0;
  player.melee = false;
  player.spectatingZombieId = player.id;
  player.respawnZombieId = player.id;
  const zombie = spawnZombieAt({ x: player.x, y: player.y }, true, player.deviceId, player.name);
  zombie.id = player.id;
  zombie.ownerDeviceId = player.deviceId;
  zombie.ownerName = player.name;
  zombie.x = player.x;
  zombie.y = player.y;
  zombie.isPlayerZombie = true;
  GAME.zombies = GAME.zombies.filter((entry) => entry.id !== player.id);
  GAME.zombies.push(zombie);
  return zombie;
}

function emitGameInit(ws, player) {
  ws.send(JSON.stringify({
    type: "game-init",
    at: nowTime(),
    map: {
      width: GAME.width,
      height: GAME.height,
      walls: GAME.walls,
      crates: GAME.crates,
      meleePoints: GAME_MELEE_SPAWNS,
      gunPoints: GAME_GUN_SPAWNS,
      spawnPoints: GAME_SPAWNS
    },
    player: {
      id: player.id,
      name: player.name,
      state: player.state,
      weapon: player.weapon,
      ammo: player.ammo,
      spectatingZombieId: player.spectatingZombieId
    }
  }));
}

function broadcastGameState() {
  const payload = JSON.stringify({
    type: "game-state",
    at: nowTime(),
    time: Date.now(),
    players: Array.from(GAME.players.values()).map((p) => ({
      id: p.id,
      deviceId: p.deviceId,
      name: p.name,
      state: p.state,
      x: p.x,
      y: p.y,
      hp: p.hp,
      ammo: p.ammo,
      weapon: p.weapon,
      spectatingZombieId: p.spectatingZombieId,
      online: p.online
    })),
    zombies: GAME.zombies.map((z) => ({
      id: z.id,
      ownerDeviceId: z.ownerDeviceId,
      ownerName: z.ownerName,
      x: z.x,
      y: z.y,
      hp: z.hp,
      isPlayerZombie: !!z.isPlayerZombie
    })),
    bullets: GAME.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y })),
    items: GAME.items.filter((item) => !item.picked).map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      x: item.x,
      y: item.y,
      ammo: item.ammo || 0
    }))
  });

  for (const ws of GAME.sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function resetGameWorld() {
  GAME.players.clear();
  GAME.bullets = [];
  GAME.zombies = [];
  GAME.items = [];
  GAME.nextIds = { player: 1, zombie: 1, bullet: 1, crate: 1, item: 1 };
  GAME.nextGunSpawnAt = Date.now() + 60_000;
  GAME.gameOver = false;
  GAME.gameOverAt = 0;
  GAME.mapReady = false;
  buildGameWorld();
}

buildGameWorld();

setInterval(() => {
  if (GAME.gameOver) return;

  const now = Date.now();
  spawnGunIfNeeded(now);

  for (const item of GAME.items) {
    if (item.picked && item.respawnAt && now >= item.respawnAt) {
      item.picked = false;
      item.respawnAt = 0;
      const spawn = item.kind === "melee"
        ? GAME_MELEE_SPAWNS.find((entry) => distSq(entry.x, entry.y, item.x, item.y) < 1) || GAME_MELEE_SPAWNS[0]
        : GAME_GUN_SPAWNS.find((entry) => distSq(entry.x, entry.y, item.x, item.y) < 1) || GAME_GUN_SPAWNS[0];
      item.x = spawn.x;
      item.y = spawn.y;
    }
  }

  for (const crate of GAME.crates) {
    crate.x += crate.vx;
    crate.y += crate.vy;
    crate.vx *= 0.88;
    crate.vy *= 0.88;

    crate.x = clamp(crate.x, 48, GAME.width - crate.w - 48);
    crate.y = clamp(crate.y, 48, GAME.height - crate.h - 48);

    if (rectCollisionWithWorld(crate)) {
      crate.x -= crate.vx;
      crate.y -= crate.vy;
      crate.vx *= -0.2;
      crate.vy *= -0.2;
    }
  }

  for (const bullet of GAME.bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    bullet.ttl -= 1;
  }

  GAME.bullets = GAME.bullets.filter((bullet) => {
    if (bullet.ttl <= 0) return false;
    if (bullet.x < 40 || bullet.y < 40 || bullet.x > GAME.width - 40 || bullet.y > GAME.height - 40) return false;
    if (GAME.walls.some((wall) => circleRectCollision(bullet.x, bullet.y, bullet.radius, wall))) return false;
    if (GAME.crates.some((crate) => circleRectCollision(bullet.x, bullet.y, bullet.radius, crate))) return false;

    for (const zombie of GAME.zombies) {
      if (zombie.respawnAt && now < zombie.respawnAt) continue;
      if (distSq(bullet.x, bullet.y, zombie.x, zombie.y) > 18 * 18) continue;
      zombie.hp -= 1;
      const dx = zombie.x - bullet.x;
      const dy = zombie.y - bullet.y;
      const len = Math.hypot(dx, dy) || 1;
      zombie.x += (dx / len) * 12;
      zombie.y += (dy / len) * 12;
      if (zombie.hp <= 0) {
        zombie.respawnAt = now + 8_000;
        zombie.hp = zombie.isPlayerZombie ? 4 : 3;
        const respawn = GAME_ZOMBIE_SPAWNS[Math.floor(Math.random() * GAME_ZOMBIE_SPAWNS.length)];
        zombie.x = respawn.x;
        zombie.y = respawn.y;
        zombie.stunUntil = now + 2_000;
      }
      return false;
    }

    return true;
  });

  for (const player of GAME.players.values()) {
    if (player.state !== "human") continue;
    const input = player.input;
    const moveX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const moveY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const len = Math.hypot(moveX, moveY) || 1;
    const speed = player.speed * (input.shift ? 1.25 : 1);
    const dx = (moveX / len) * speed;
    const dy = (moveY / len) * speed;
    moveCircleWithCollisions(player, dx, dy, player.radius, 0.28);

    for (const item of GAME.items) {
      if (item.picked) continue;
      if (distSq(player.x, player.y, item.x + item.w / 2, item.y + item.h / 2) > 26 * 26) continue;
      if (item.kind === "gun") {
        player.weapon = "gun";
        player.ammo += item.ammo || 12;
      } else if (item.kind === "melee") {
        player.weapon = "melee";
        player.melee = true;
      }
      item.picked = true;
      item.respawnAt = item.kind === "melee" ? now + 45_000 : now + 60_000;
    }

    if (input.shoot && player.weapon === "gun" && player.ammo > 0 && now - player.lastShotAt > 220) {
      spawnBullet(player, input.aimX, input.aimY);
      player.ammo -= 1;
      player.lastShotAt = now;
    }

    if (input.melee && player.weapon === "melee" && now - player.lastMeleeAt > 500) {
      for (const zombie of GAME.zombies) {
        if (zombie.respawnAt && now < zombie.respawnAt) continue;
        if (distSq(player.x, player.y, zombie.x, zombie.y) > 44 * 44) continue;
        zombie.hp -= 1;
        zombie.stunUntil = now + 900;
      }
      player.lastMeleeAt = now;
    }
  }

  for (const zombie of GAME.zombies) {
    if (zombie.respawnAt && now < zombie.respawnAt) continue;
    if (zombie.stunUntil && now < zombie.stunUntil) continue;

    const target = getNearestHuman(zombie.x, zombie.y);
    let dx = 0;
    let dy = 0;
    if (target) {
      const tx = target.x - zombie.x;
      const ty = target.y - zombie.y;
      const len = Math.hypot(tx, ty) || 1;
      dx = (tx / len) * zombie.speed;
      dy = (ty / len) * zombie.speed;

      if (distSq(zombie.x, zombie.y, target.x, target.y) < 26 * 26 && now - zombie.lastAttackAt > 700) {
        zombie.lastAttackAt = now;
        target.hp -= 34;
        if (target.hp <= 0) {
          convertPlayerToZombie(target);
        }
      }
    } else {
      zombie.wanderAngle += (Math.random() - 0.5) * 0.15;
      dx = Math.cos(zombie.wanderAngle) * zombie.speed * 0.4;
      dy = Math.sin(zombie.wanderAngle) * zombie.speed * 0.4;
    }

    moveCircleWithCollisions(zombie, dx, dy, zombie.radius, 0.15);

    if (zombie.isPlayerZombie && zombie.ownerDeviceId) {
      const ownerPlayer = GAME.players.get(zombie.ownerDeviceId);
      if (ownerPlayer) {
        ownerPlayer.x = zombie.x;
        ownerPlayer.y = zombie.y;
        ownerPlayer.hp = zombie.hp;
        ownerPlayer.state = "zombie";
        ownerPlayer.spectatingZombieId = zombie.id;
      }
    }
  }

  const humansAlive = Array.from(GAME.players.values()).some((player) => player.state === "human");
  if (!humansAlive) {
    GAME.gameOver = true;
    GAME.gameOverAt = now;
    broadcast({
      type: "game-over",
      at: nowTime(),
      text: "Todos viraram zumbis."
    });
    return;
  }

  broadcastGameState();
}, 50);

wss.on("connection", (ws, req) => {
  clients.add(ws);
  ws.incomingTransfers = new Map();
  ws.incomingBundles = new Map();
  ws.deviceId = null;
  ws.userName = "Anônimo";
  ws.tabActive = true;
  ws.lastPokeAt = 0;
  ws.clientMode = "chat";
  ws.canBlockNames = isHostMachineAddress(req?.socket?.remoteAddress);
  let isNewUser = false;

  // Primeiro recebemos mensagem com deviceId
  const tempListener = (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "set-device-id" && typeof data.deviceId === "string") {
      const deviceId = String(data.deviceId).slice(0, 64);
      const userName = normalizeName(data.name);
      const tabActive = typeof data.tabActive === "boolean" ? data.tabActive : true;
      const clientMode = data.mode === "game" ? "game" : "chat";

      ws.clientMode = clientMode;

      if (isNameBlocked(userName)) {
        sendNameError(ws, userName, `O nome "${userName}" foi bloqueado pelo host. Escolha outro.`);
        return;
      }

      if (clientMode === "game") {
        ws.removeListener("message", tempListener);
        ws.on("message", onMessage);
        ws.gameDeviceId = deviceId;
        GAME.sockets.add(ws);

        const player = spawnGamePlayer(ws, deviceId, userName);
        emitGameInit(ws, player);
        return;
      }

      // Verifica se outro dispositivo já registrou este nome
      const nameKey = normalizeNameKey(userName);
      if (nameKey && nameToDevice.has(nameKey) && nameToDevice.get(nameKey) !== deviceId) {
        sendNameError(ws, userName);
        return;
      }

      ws.deviceId = deviceId;
      ws.userName = userName;
      ws.tabActive = tabActive;
      ws.removeListener("message", tempListener);
      ws.on("message", onMessage);

      // Verificar se é novo usuário
      if (!activeUsers.has(deviceId)) {
        activeUsers.set(deviceId, new Set());
        isNewUser = true;
      }
      activeUsers.get(deviceId).add(ws);

      if (chatHistory.length) {
        ws.send(JSON.stringify({
          type: "history",
          messages: chatHistory
        }));
      }

      ws.send(JSON.stringify({
        type: "system",
        text: `Conectado. Usuários online: ${activeUsers.size}`,
        at: nowTime()
      }));

      ws.send(JSON.stringify({
        type: "session-info",
        canBlockNames: !!ws.canBlockNames,
        at: nowTime()
      }));

      if (isNewUser) {
        broadcast({
          type: "system",
          text: `Alguém entrou. Online: ${activeUsers.size}`,
          at: nowTime()
        });
      }
      // Registra o nome como pertencente a este deviceId
      if (nameKey) nameToDevice.set(nameKey, deviceId);

      broadcastPeopleList();
    }
  };
  ws.on("message", tempListener);

  // Timeout de 5s para enviar deviceId
  setTimeout(() => {
    if (!ws.deviceId) ws.close();
  }, 5000);

  // Evento de fechamento de conexão
  ws.on("close", () => handleClientClose(ws));
});

function onMessage(raw) {
  const ws = this;
  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (ws.clientMode === "game" && data.type === "game-input") {
    const player = GAME.players.get(ws.gameDeviceId);
    if (!player) return;

    const nextInput = data.input && typeof data.input === "object" ? data.input : data;
    player.input = {
      up: !!nextInput.up,
      down: !!nextInput.down,
      left: !!nextInput.left,
      right: !!nextInput.right,
      shift: !!nextInput.shift,
      aimX: Number(nextInput.aimX) || player.x,
      aimY: Number(nextInput.aimY) || player.y,
      shoot: !!nextInput.shoot,
      melee: !!nextInput.melee
    };
    return;
  }

  if (data.type === "chat") {
    const name = normalizeName(data.name || ws.userName);
      const text = normalizeMessageText(data.text);
      const imageData = typeof data.imageData === "string" ? data.imageData : "";
      const imageName = String(data.imageName || "").slice(0, 80);
      const videoData = typeof data.videoData === "string" ? data.videoData : "";
      const videoName = String(data.videoName || "").slice(0, 80);
      const fileData = typeof data.fileData === "string" ? data.fileData : "";
      const fileName = String(data.fileName || "").slice(0, 120);
      const fileType = String(data.fileType || "").slice(0, 80);
      const fileSize = Number(data.fileSize) || 0;
      const bundleFiles = Array.isArray(data.bundleFiles) ? data.bundleFiles.slice(0, 200) : [];

      const hasText = !!text.trim();
      const hasImage = !!imageData;
      const hasVideo = !!videoData;
      const hasFile = !!fileData;
      const hasBundle = bundleFiles.length > 0;

      if (!hasText && !hasImage && !hasVideo && !hasFile && !hasBundle) return;

      if (hasImage) {
        const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData);
        const maxImageChars = 70_000_000;
        if (!isDataImage || imageData.length > maxImageChars) return;
      }

      if (hasFile) {
        const isDataFile = /^data:[^;]+;base64,/.test(fileData);
        const maxFileChars = 1_500_000_000;
        if (!isDataFile || fileData.length > maxFileChars || fileSize > MAX_FILE_BYTES) return;
      }

      if (hasVideo) {
        const isDataVideo = /^data:video\/[a-zA-Z0-9.+-]+;base64,/.test(videoData);
        const maxVideoChars = 750_000_000;
        if (!isDataVideo || videoData.length > maxVideoChars) return;
      }

      if (hasBundle) {
        for (const item of bundleFiles) {
          const iFileData = typeof item?.fileData === "string" ? item.fileData : "";
          const iFileName = String(item?.fileName || "").slice(0, 120);
          const iFileType = String(item?.fileType || "application/octet-stream").slice(0, 80);
          const iFileSize = Number(item?.fileSize) || 0;
          if (!/^data:[^;]+;base64,/.test(iFileData)) return;
          if (!iFileName) return;
          if (!iFileType) return;
          if (iFileSize <= 0 || iFileSize > MAX_FILE_BYTES) return;
        }
      }

      const at = nowTime();

      publishChat({
        type: "chat",
        name,
        text,
        imageData: hasImage ? imageData : "",
        imageName: hasImage ? imageName : "",
        videoData: hasVideo ? videoData : "",
        videoName: hasVideo ? videoName : "",
        fileData: hasFile ? fileData : "",
        fileName: hasFile ? fileName : "",
        fileType: hasFile ? fileType : "",
        fileSize: hasFile ? fileSize : 0,
        bundleFiles: hasBundle ? bundleFiles : [],
        at
      });
      return;
    }

    if (data.type === "presence-update") {
      const nextName = normalizeName(data.name || ws.userName);
      const nextTabActive = typeof data.tabActive === "boolean" ? data.tabActive : ws.tabActive;

      if (isNameBlocked(nextName)) {
        sendNameError(ws, nextName, `O nome "${nextName}" foi bloqueado pelo host. Escolha outro.`);
        return;
      }

      const oldKey = normalizeNameKey(ws.userName);
      const newKey = normalizeNameKey(nextName);

      // Se houver mudança de nome, verificar se outro device já usou este nome
      if (newKey && newKey !== oldKey && nameToDevice.has(newKey) && nameToDevice.get(newKey) !== ws.deviceId) {
        sendNameError(ws, nextName);
        return;
      }

      const changed = nextName !== ws.userName || nextTabActive !== ws.tabActive;

      // Atualiza mapeamento de nome -> deviceId
      if (newKey && newKey !== oldKey) {
        nameToDevice.set(newKey, ws.deviceId);
      }
      if (oldKey && oldKey !== newKey && nameToDevice.get(oldKey) === ws.deviceId) {
        nameToDevice.delete(oldKey);
      }

      ws.userName = nextName;
      ws.tabActive = nextTabActive;

      if (changed || data.force) {
        broadcastPeopleList();
      }
      return;
    }

    if (data.type === "block-name") {
      if (!ws.canBlockNames) return;

      const targetName = normalizeName(data.name || data.targetName);
      const targetKey = normalizeNameKey(targetName);
      if (!targetKey) return;
      if (blockedNames.has(targetKey)) return;

      blockedNames.add(targetKey);

      const affectedSockets = [];
      for (const sockets of activeUsers.values()) {
        for (const socket of sockets) {
          if (!socket || normalizeNameKey(socket.userName) !== targetKey) continue;
          affectedSockets.push(socket);
        }
      }

      for (const socket of affectedSockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "name-blocked",
            name: targetName,
            text: `O nome "${targetName}" foi bloqueado pelo host.`,
            at: nowTime()
          }));
          socket.close(4003, "blocked-name");
        }
      }

      broadcast({
        type: "system",
        text: `Nome bloqueado pelo host: ${targetName}`,
        at: nowTime()
      });
      broadcastPeopleList();
      return;
    }

    if (data.type === "delete-message") {
      const targetMessageId = String(data.messageId || data.targetMessageId || "").slice(0, 64);
      if (!targetMessageId) return;

      const removedIds = removeMessageCascade(targetMessageId);
      if (!removedIds.length) return;

      broadcast({
        type: "system",
        text: `Mensagem excluída${removedIds.length > 1 ? ` (${removedIds.length} itens removidos)` : ""}`,
        at: nowTime()
      });
      broadcastHistoryRefresh();
      return;
    }

    if (data.type === "poke-user") {
      const targetDeviceId = String(data.targetDeviceId || "").slice(0, 64);
      if (!targetDeviceId) return;
      if (targetDeviceId === ws.deviceId) return;

      const targetSockets = activeUsers.get(targetDeviceId);
      if (!targetSockets || targetSockets.size === 0) return;

      let targetActive = false;
      for (const targetSocket of targetSockets) {
        if (targetSocket && targetSocket.tabActive) {
          targetActive = true;
          break;
        }
      }
      if (targetActive) return;

      const now = Date.now();
      if (now - Number(ws.lastPokeAt || 0) < 1500) return;
      ws.lastPokeAt = now;

      const fromName = normalizeName(ws.userName);
      const payload = JSON.stringify({
        type: "poke",
        fromName,
        fromDeviceId: ws.deviceId,
        at: nowTime()
      });

      for (const targetSocket of targetSockets) {
        if (targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(payload);
        }
      }
      return;
    }

    if (data.type === "bundle-start") {
      const bundleId = String(data.bundleId || "").slice(0, 64);
      const name = normalizeName(data.name);
      const totalInBundle = Number(data.totalInBundle);

      if (!bundleId) return;
      if (!Number.isInteger(totalInBundle) || totalInBundle < 2 || totalInBundle > 200) return;

      ws.incomingBundles.set(bundleId, {
        name,
        totalInBundle,
        items: new Array(totalInBundle).fill(null),
        at: nowTime(),
        startedAt: Date.now()
      });
      return;
    }

    if (data.type === "file-start") {
      const transferId = String(data.transferId || "").slice(0, 64);
      const kind = data.kind === "image" || data.kind === "video" ? data.kind : "file";
      const name = normalizeName(data.name);
      const fileName = String(data.fileName || "arquivo").slice(0, 120);
      const fileType = String(data.fileType || (kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "application/octet-stream")).slice(0, 80);
      const fileSize = Number(data.fileSize) || 0;
      const totalChunks = Number(data.totalChunks) || 0;
      const bundleId = String(data.bundleId || "").slice(0, 64);
      const bundleIndex = Number(data.bundleIndex);
      const totalInBundle = Number(data.totalInBundle);

      if (!transferId || ws.incomingTransfers.has(transferId)) return;
      if (totalChunks < 1 || totalChunks > 100000) return;

      const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : kind === "video" ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
      if (fileSize <= 0 || fileSize > maxBytes) return;

      if (kind === "image" && !/^image\//.test(fileType)) return;
      if (kind === "video" && !/^video\//.test(fileType)) return;
      if (bundleId && (!Number.isInteger(bundleIndex) || bundleIndex < 0)) return;
      if (bundleId && (!Number.isInteger(totalInBundle) || totalInBundle < 2 || totalInBundle > 200)) return;
      if (bundleId && !ws.incomingBundles.has(bundleId)) return;

      ws.incomingTransfers.set(transferId, {
        transferId,
        kind,
        name,
        fileName,
        fileType,
        fileSize,
        totalChunks,
        bundleId,
        bundleIndex,
        totalInBundle,
        chunks: new Array(totalChunks),
        received: 0,
        base64Chars: 0,
        maxBase64Chars: Math.ceil(fileSize * 1.38) + 4096,
        startedAt: Date.now()
      });
      return;
    }

    if (data.type === "file-chunk") {
      const transferId = String(data.transferId || "").slice(0, 64);
      const transfer = ws.incomingTransfers.get(transferId);
      if (!transfer) return;
      if (Date.now() - transfer.startedAt > TRANSFER_TIMEOUT_MS) {
        ws.incomingTransfers.delete(transferId);
        return;
      }

      const index = Number(data.index);
      const chunk = typeof data.data === "string" ? data.data : "";

      if (!Number.isInteger(index) || index < 0 || index >= transfer.totalChunks) return;
      if (!chunk || chunk.length > MAX_CHUNK_BASE64_CHARS) {
        ws.incomingTransfers.delete(transferId);
        return;
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(chunk)) {
        ws.incomingTransfers.delete(transferId);
        return;
      }
      if (transfer.chunks[index]) return;

      transfer.chunks[index] = chunk;
      transfer.received += 1;
      transfer.base64Chars += chunk.length;

      if (transfer.base64Chars > transfer.maxBase64Chars) {
        ws.incomingTransfers.delete(transferId);
      }
      return;
    }

    if (data.type === "file-end") {
      const transferId = String(data.transferId || "").slice(0, 64);
      const transfer = ws.incomingTransfers.get(transferId);
      if (!transfer) {
        console.log(`[FILE-END] Transfer ${transferId} não encontrado`);
        return;
      }
      
      ws.incomingTransfers.delete(transferId);

      console.log(`[FILE-END] Finalizando ${transferId}: tipo=${transfer.kind}, chunks=${transfer.received}/${transfer.totalChunks}`);

      if (Date.now() - transfer.startedAt > TRANSFER_TIMEOUT_MS) {
        console.log(`[FILE-END] ${transferId} expirado (timeout)`);
        return;
      }
      if (transfer.received !== transfer.totalChunks) {
        console.log(`[FILE-END] ${transferId} chunks incompletos: ${transfer.received}/${transfer.totalChunks}`);
        return;
      }
      if (transfer.chunks.some((chunk) => typeof chunk !== "string")) {
        console.log(`[FILE-END] ${transferId} contém chunks inválidos`);
        return;
      }

      const base64 = transfer.chunks.join("");
      console.log(`[FILE-END] ${transferId} base64 size: ${base64.length} bytes, max permitido: ${transfer.maxBase64Chars}`);
      
      if (!base64 || base64.length > transfer.maxBase64Chars) {
        console.log(`[FILE-END] ${transferId} base64 inválido ou muito grande`);
        return;
      }

      const at = nowTime();

      if (transfer.kind === "image") {
        // Para imagens, usar cache com rota HTTP se forem muito grandes (> 5MB)
        // Caso contrário, manter como data URL para imagens pequenas
        if (base64.length > 5_000_000) {
          const mediaId = storeMediaInCache(base64, transfer.fileType, transfer.fileName);
          const imageUrl = `/media/${mediaId}`;
          publishChat({
            type: "chat",
            name: transfer.name,
            text: "",
            imageData: imageUrl, // URL HTTP para imagens grandes
            imageName: transfer.fileName,
            videoData: "",
            videoName: "",
            fileData: "",
            fileName: "",
            fileType: "",
            fileSize: 0,
            bundleFiles: [],
            at
          });
        } else {
          publishChat({
            type: "chat",
            name: transfer.name,
            text: "",
            imageData: `data:${transfer.fileType};base64,${base64}`, // data URL para imagens pequenas
            imageName: transfer.fileName,
            videoData: "",
            videoName: "",
            fileData: "",
            fileName: "",
            fileType: "",
            fileSize: 0,
            bundleFiles: [],
            at
          });
        }
        return;
      }

      if (transfer.kind === "video") {
        // Para vídeos, usar cache com rota HTTP em vez de data URL gigante
        console.log(`[VIDEO-END] Recebido vídeo: ${transfer.fileName}, ${(base64.length / 1024 / 1024).toFixed(2)}MB`);
        const mediaId = storeMediaInCache(base64, transfer.fileType, transfer.fileName);
        
        if (!mediaId) {
          console.error(`[VIDEO-END] Falha ao armazenar vídeo em cache`);
          return;
        }
        
        const videoUrl = `/media/${mediaId}`;
        console.log(`[VIDEO-END] Publicando chat com videoUrl: ${videoUrl}`);

        publishChat({
          type: "chat",
          name: transfer.name,
          text: "",
          imageData: "",
          imageName: "",
          videoData: videoUrl, // URL HTTP ao invés de data URL
          videoName: transfer.fileName,
          fileData: "",
          fileName: "",
          fileType: "",
          fileSize: 0,
          bundleFiles: [],
          at
        });
        return;
      }

      if (transfer.bundleId) {
        const key = transfer.bundleId;
        const bundle = ws.incomingBundles.get(key);
        if (!bundle || transfer.bundleIndex >= bundle.totalInBundle) return;
        if (Date.now() - bundle.startedAt > TRANSFER_TIMEOUT_MS) {
          ws.incomingBundles.delete(key);
          return;
        }

        // Para arquivos grandes em pacote, enviar URL HTTP para evitar mensagem gigante no WebSocket.
        const bundleFileData = base64.length > LARGE_FILE_CACHE_THRESHOLD_BASE64
          ? `/media/${storeMediaInCache(base64, transfer.fileType, transfer.fileName)}`
          : `data:${transfer.fileType};base64,${base64}`;

        if (!bundleFileData || bundleFileData === "/media/null") {
          console.error(`[FILE-END] Falha ao armazenar item de pacote em cache: ${transfer.fileName}`);
          return;
        }

        bundle.items[transfer.bundleIndex] = {
          fileData: bundleFileData,
          fileName: transfer.fileName,
          fileType: transfer.fileType,
          fileSize: transfer.fileSize
        };

        const complete = bundle.items.every((item) => item && typeof item.fileData === "string");
        if (!complete) return;

        ws.incomingBundles.delete(key);
        publishChat({
          type: "chat",
          name: bundle.name,
          text: "",
          imageData: "",
          imageName: "",
          videoData: "",
          videoName: "",
          fileData: "",
          fileName: "",
          fileType: "",
          fileSize: 0,
          bundleFiles: bundle.items,
          at: bundle.at || at
        });
        return;
      }

      // Arquivos grandes (APK, ZIP, etc.) devem ser distribuídos por URL HTTP, não como data URL gigante.
      let outgoingFileData = `data:${transfer.fileType};base64,${base64}`;
      if (base64.length > LARGE_FILE_CACHE_THRESHOLD_BASE64) {
        const mediaId = storeMediaInCache(base64, transfer.fileType, transfer.fileName);
        if (!mediaId) {
          console.error(`[FILE-END] Falha ao armazenar arquivo em cache: ${transfer.fileName}`);
          return;
        }
        outgoingFileData = `/media/${mediaId}`;
        console.log(`[FILE-END] Publicando arquivo grande via URL HTTP: ${outgoingFileData}`);
      }

      publishChat({
        type: "chat",
        name: transfer.name,
        text: "",
        imageData: "",
        imageName: "",
        videoData: "",
        videoName: "",
        fileData: outgoingFileData,
        fileName: transfer.fileName,
        fileType: transfer.fileType,
        fileSize: transfer.fileSize,
        bundleFiles: [],
        at
      });
    }
}

function handleClientClose(ws) {
  clients.delete(ws);
  if (ws.clientMode === "game") {
    GAME.sockets.delete(ws);
    removeGameConnection(ws);
  }
  if (ws.incomingTransfers) ws.incomingTransfers.clear();
  if (ws.incomingBundles) ws.incomingBundles.clear();
  if (!ws.deviceId) return;

  const userConnections = activeUsers.get(ws.deviceId);
  if (userConnections) {
    userConnections.delete(ws);
    // Se não há mais conexões deste usuário, remove do mapa
    if (userConnections.size === 0) {
      activeUsers.delete(ws.deviceId);

      // Remove qualquer nome associado a este deviceId
      for (const [nameKey, dId] of nameToDevice.entries()) {
        if (dId === ws.deviceId) nameToDevice.delete(nameKey);
      }

      if (clients.size === 0) {
        chatHistory.length = 0;
        return;
      }

      broadcast({
        type: "system",
        text: `Alguém saiu. Online: ${activeUsers.size}`,
        at: nowTime()
      });
    }
  }

  broadcastPeopleList();
}

server.listen(PORT, "0.0.0.0", () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) ips.push(i.address);
    }
  }

  console.log(`Chat local rodando na porta ${PORT}`);
  console.log(`Hostname preferido: http://${CHAT_HOSTNAME}:${PORT}`);
  if (ips.length) {
    console.log("Acesse de outros PCs na rede usando um destes links:");
    for (const ip of ips) console.log(`  http://${ip}:${PORT}`);
    console.log(`Se configurar DNS/hosts da rede, use sempre: http://${CHAT_HOSTNAME}:${PORT}`);
  } else {
    console.log(`Acesse: http://localhost:${PORT}`);
  }
});