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

wss.on("connection", (ws) => {
  clients.add(ws);

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

      const hasText = !!text.trim();
      const hasImage = !!imageData;

      if (!hasText && !hasImage) return;

      if (hasImage) {
        const isDataImage = /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(imageData);
        const maxImageChars = 2_200_000;
        if (!isDataImage || imageData.length > maxImageChars) return;
      }

      const at = nowTime();

      broadcast({
        type: "chat",
        name,
        text,
        imageData: hasImage ? imageData : "",
        imageName: hasImage ? imageName : "",
        at
      });

      chatHistory.push({
        type: "chat",
        name,
        text,
        imageData: hasImage ? imageData : "",
        imageName: hasImage ? imageName : "",
        at
      });

      if (chatHistory.length > MAX_HISTORY) {
        chatHistory.splice(0, chatHistory.length - MAX_HISTORY);
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);

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