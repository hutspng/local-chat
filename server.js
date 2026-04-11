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

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Set();
const chatHistory = [];
const MAX_HISTORY = 200;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_CHUNK_BASE64_CHARS = 500_000;
const TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;

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
  broadcast(entry);
  pushChatHistory(entry);
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.incomingTransfers = new Map();

  if (chatHistory.length) {
    ws.send(JSON.stringify({
      type: "history",
      messages: chatHistory
    }));
  }

  ws.send(JSON.stringify({
    type: "system",
    text: `Conectado. Usuários online: ${clients.size}`,
    at: nowTime()
  }));

  broadcast({
    type: "system",
    text: `Alguém entrou. Online: ${clients.size}`,
    at: nowTime()
  });

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "chat") {
      const name = String(data.name || "Anônimo").slice(0, 24);
      const text = String(data.text || "").slice(0, 500);
      const imageData = typeof data.imageData === "string" ? data.imageData : "";
      const imageName = String(data.imageName || "").slice(0, 80);
      const fileData = typeof data.fileData === "string" ? data.fileData : "";
      const fileName = String(data.fileName || "").slice(0, 120);
      const fileType = String(data.fileType || "").slice(0, 80);
      const fileSize = Number(data.fileSize) || 0;

      const hasText = !!text.trim();
      const hasImage = !!imageData;
      const hasFile = !!fileData;

      if (!hasText && !hasImage && !hasFile) return;

      if (hasImage) {
        const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData);
        const maxImageChars = 14_000_000;
        if (!isDataImage || imageData.length > maxImageChars) return;
      }

      if (hasFile) {
        const isDataFile = /^data:[^;]+;base64,/.test(fileData);
        const maxFileChars = 145_000_000;
        const allowedType = /^text\//.test(fileType)
          || fileType === "application/zip"
          || fileType === "application/x-zip-compressed"
          || fileType === "application/x-rar-compressed"
          || fileType === "application/vnd.rar"
          || fileType === "application/x-7z-compressed"
          || /\.(txt|md|csv|log|json|xml|zip|rar|7z)$/i.test(fileName);

        if (!isDataFile || fileData.length > maxFileChars || !allowedType || fileSize > 100 * 1024 * 1024) return;
      }

      const at = nowTime();

      publishChat({
        type: "chat",
        name,
        text,
        imageData: hasImage ? imageData : "",
        imageName: hasImage ? imageName : "",
        fileData: hasFile ? fileData : "",
        fileName: hasFile ? fileName : "",
        fileType: hasFile ? fileType : "",
        fileSize: hasFile ? fileSize : 0,
        at
      });
      return;
    }

    if (data.type === "file-start") {
      const transferId = String(data.transferId || "").slice(0, 64);
      const kind = data.kind === "image" ? "image" : "file";
      const name = String(data.name || "Anônimo").slice(0, 24);
      const fileName = String(data.fileName || "arquivo").slice(0, 120);
      const fileType = String(data.fileType || (kind === "image" ? "image/png" : "application/octet-stream")).slice(0, 80);
      const fileSize = Number(data.fileSize) || 0;
      const totalChunks = Number(data.totalChunks) || 0;

      if (!transferId || ws.incomingTransfers.has(transferId)) return;
      if (totalChunks < 1 || totalChunks > 100000) return;

      const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
      if (fileSize <= 0 || fileSize > maxBytes) return;

      if (kind === "image" && !/^image\//.test(fileType)) return;
      if (kind === "file") {
        const allowed = /^text\//.test(fileType)
          || fileType === "application/zip"
          || fileType === "application/x-zip-compressed"
          || fileType === "application/x-rar-compressed"
          || fileType === "application/vnd.rar"
          || fileType === "application/x-7z-compressed"
          || /\.(txt|md|csv|log|json|xml|zip|rar|7z)$/i.test(fileName);
        if (!allowed) return;
      }

      ws.incomingTransfers.set(transferId, {
        transferId,
        kind,
        name,
        fileName,
        fileType,
        fileSize,
        totalChunks,
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
      if (!transfer) return;
      ws.incomingTransfers.delete(transferId);

      if (Date.now() - transfer.startedAt > TRANSFER_TIMEOUT_MS) return;
      if (transfer.received !== transfer.totalChunks) return;
      if (transfer.chunks.some((chunk) => typeof chunk !== "string")) return;

      const base64 = transfer.chunks.join("");
      if (!base64 || base64.length > transfer.maxBase64Chars) return;

      const at = nowTime();

      if (transfer.kind === "image") {
        publishChat({
          type: "chat",
          name: transfer.name,
          text: "",
          imageData: `data:${transfer.fileType};base64,${base64}`,
          imageName: transfer.fileName,
          fileData: "",
          fileName: "",
          fileType: "",
          fileSize: 0,
          at
        });
        return;
      }

      publishChat({
        type: "chat",
        name: transfer.name,
        text: "",
        imageData: "",
        imageName: "",
        fileData: `data:${transfer.fileType};base64,${base64}`,
        fileName: transfer.fileName,
        fileType: transfer.fileType,
        fileSize: transfer.fileSize,
        at
      });
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (ws.incomingTransfers) ws.incomingTransfers.clear();

    if (clients.size === 0) {
      chatHistory.length = 0;
      return;
    }

    broadcast({
      type: "system",
      text: `Alguém saiu. Online: ${clients.size}`,
      at: nowTime()
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) ips.push(i.address);
    }
  }

  console.log(`Chat local rodando na porta ${PORT}`);
  if (ips.length) {
    console.log("Acesse de outros PCs na rede usando um destes links:");
    for (const ip of ips) console.log(`  http://${ip}:${PORT}`);
  } else {
    console.log(`Acesse: http://localhost:${PORT}`);
  }
});