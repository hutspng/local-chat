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

const PORT = process.env.PORT || 3000;
const CHAT_HOSTNAME = String(process.env.CHAT_HOSTNAME || "local-chat.lan").trim() || "local-chat.lan";

const app = express();
app.use(express.static(path.join(__dirname, "public")));

// Cache para mídia (vídeos/imagens grandes), para evitar data URLs gigantes
const mediaCache = new Map();
let mediaCacheCounter = 0;
const MEDIA_CACHE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutos (aumentado)

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
    // Decodifica base64 para buffer
    const base64 = cached.base64;
    
    if (!base64 || base64.length === 0) {
      console.error(`[MEDIA] ${mediaId} tem base64 vazio`);
      return res.status(500).json({ error: "Mídia corrompida" });
    }
    
    const buffer = Buffer.from(base64, "base64");
    const fileSize = buffer.length;

    console.log(`[MEDIA] Buffer criado: ${fileSize} bytes para ${mediaId}`);

    // Suporte a Range requests para streaming
    const range = req.headers.range;
    res.set("Accept-Ranges", "bytes");
    res.set("Content-Type", cached.mimeType || "application/octet-stream");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.set("Content-Length", chunkSize);
      res.end(buffer.slice(start, end + 1));
    } else {
      res.set("Content-Length", fileSize);
      res.set("Cache-Control", "public, max-age=3600");
      
      // Para arquivos grandes, enviar em chunks para evitar timeout
      const STREAM_CHUNK = 64 * 1024; // 64KB por chunk
      let offset = 0;
      
      const sendChunk = () => {
        if (offset >= fileSize) {
          console.log(`[MEDIA] Finalizado streaming de ${mediaId}`);
          res.end();
          return;
        }
        
        const size = Math.min(STREAM_CHUNK, fileSize - offset);
        const chunk = buffer.slice(offset, offset + size);
        offset += size;
        
        if (!res.write(chunk)) {
          // Se o buffer interno está cheio, aguardar drain
          res.once('drain', sendChunk);
        } else {
          // Enviar próximo chunk no próximo tick
          setImmediate(sendChunk);
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
const wss = new WebSocket.Server({ server });

const clients = new Set();
const activeUsers = new Map(); // deviceId -> Set of WebSocket connections
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

function broadcastPeopleList() {
  broadcast({
    type: "people-list",
    people: buildPeopleList(),
    at: nowTime()
  });
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.incomingTransfers = new Map();
  ws.incomingBundles = new Map();
  ws.deviceId = null;
  ws.userName = "Anônimo";
  ws.tabActive = true;
  ws.lastPokeAt = 0;
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

      if (isNewUser) {
        broadcast({
          type: "system",
          text: `Alguém entrou. Online: ${activeUsers.size}`,
          at: nowTime()
        });
      }

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
      const changed = nextName !== ws.userName || nextTabActive !== ws.tabActive;

      ws.userName = nextName;
      ws.tabActive = nextTabActive;

      if (changed || data.force) {
        broadcastPeopleList();
      }
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

        bundle.items[transfer.bundleIndex] = {
          fileData: `data:${transfer.fileType};base64,${base64}`,
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

      publishChat({
        type: "chat",
        name: transfer.name,
        text: "",
        imageData: "",
        imageName: "",
        videoData: "",
        videoName: "",
        fileData: `data:${transfer.fileType};base64,${base64}`,
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
  if (ws.incomingTransfers) ws.incomingTransfers.clear();
  if (ws.incomingBundles) ws.incomingBundles.clear();
  if (!ws.deviceId) return;

  const userConnections = activeUsers.get(ws.deviceId);
  if (userConnections) {
    userConnections.delete(ws);
    // Se não há mais conexões deste usuário, remove do mapa
    if (userConnections.size === 0) {
      activeUsers.delete(ws.deviceId);

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