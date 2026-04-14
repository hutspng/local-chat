    const log = document.getElementById("log");
    const systemLog = document.getElementById("systemLog");
    const dot = document.getElementById("dot");
    const statusEl = document.getElementById("status");
    const msgEl = document.getElementById("msg");
    const pickImageBtn = document.getElementById("pickImage");
    const imageInput = document.getElementById("imageInput");
    const pickFileBtn = document.getElementById("pickFile");
    const fileInput = document.getElementById("fileInput");
    const sendBtn = document.getElementById("send");
    const uploadStatus = document.getElementById("uploadStatus");
    const uploadLabel = document.getElementById("uploadLabel");
    const uploadBarFill = document.getElementById("uploadBarFill");
    const linkHint = document.getElementById("linkHint");
    const imageViewer = document.getElementById("imageViewer");
    const viewerClose = document.getElementById("viewerClose");
    const viewerStage = document.getElementById("viewerStage");
    const viewerImage = document.getElementById("viewerImage");

    const nameOverlay = document.getElementById("nameOverlay");
    const namePick = document.getElementById("namePick");
    const enterChat = document.getElementById("enterChat");

    // mostra um "hint" com o host atual
    linkHint.textContent = `${location.origin}`;

    function sanitizeName(s) {
      return (s || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);
    }

    function formatBytes(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function addSystemLine(text) {
      const div = document.createElement("div");
      div.textContent = text;

      div.className = "sysLine";
      systemLog.appendChild(div);
      systemLog.scrollTop = systemLog.scrollHeight;
    }

    function appendTextWithLinks(container, text) {
      // Regex para URLs e mentões
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const mentionRegex = /(@[a-záéíóúãõâêôĉäëïöüñ\w-]+(?:\/\d+)?)/gi;
      
      // Combinar ambos em um único regex
      const combined = /(?:(https?:\/\/[^\s]+)|(@[a-záéíóúãõâêôĉäëïöüñ\w-]+(?:\/\d+)?))/gi;
      let lastIndex = 0;

      for (const match of text.matchAll(combined)) {
        const fullMatch = match[0];
        const index = match.index ?? 0;
        const url = match[1];
        const mention = match[2];

        // Adicionar texto antes do match
        if (index > lastIndex) {
          container.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        }

        if (url) {
          // Processa URL
          let safeUrl = "";
          try {
            const parsed = new URL(url);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
              safeUrl = parsed.href;
            }
          } catch {
            safeUrl = "";
          }

          if (safeUrl) {
            const a = document.createElement("a");
            a.className = "chatLink";
            a.href = safeUrl;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.textContent = url;
            container.appendChild(a);
          } else {
            container.appendChild(document.createTextNode(url));
          }
        } else if (mention) {
          // Processa menção
          const mentionId = parseMention(mention);
          if (mentionId) {
            const a = document.createElement("a");
            a.className = "chatMention";
            a.href = "#";
            a.textContent = mention;
            a.addEventListener("click", (e) => {
              e.preventDefault();
              scrollToMessageAndBlink(mentionId);
            });
            container.appendChild(a);
          } else {
            container.appendChild(document.createTextNode(mention));
          }
        }

        lastIndex = index + fullMatch.length;
      }

      // Adicionar texto restante
      if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
    }

    function addChatLine({ at = "", name = "Anônimo", text = "", imageData = "", imageName = "", fileData = "", fileName = "", fileType = "", fileSize = 0, messageId = "" }) {
      const div = document.createElement("div");
      div.className = "msgLine chat";
      if (messageId) div.dataset.messageId = messageId;
      const hasText = !!String(text || "").trim();
      const hasImage = !!imageData;
      const hasFile = !!fileData;

      if (!hasText && hasImage) {
        div.classList.add("imageOnly");
      }

      // Rastrear mensagem
      if (messageId) {
        allMessages.push({ messageId, name, at, div });
        if (!messagesByAuthor[name]) messagesByAuthor[name] = [];
        messagesByAuthor[name].push(messageId);
      }

      const meta = document.createElement("div");
      meta.className = "msgMeta";
      meta.textContent = `[${at}] ${name}:`;
      div.appendChild(meta);

      if (hasText) {
        const body = document.createElement("div");
        body.className = "msgText";
        appendTextWithLinks(body, text);
        div.appendChild(body);
      }

      if (imageData) {
        const img = document.createElement("img");
        img.className = "chatImage";
        img.src = imageData;
        img.alt = `Imagem enviada por ${name}`;
        img.loading = "lazy";
        img.addEventListener("click", () => openImageViewer(imageData, img.alt));
        div.appendChild(img);

        if (imageName) {
          const caption = document.createElement("div");
          caption.className = "imageCaption";
          caption.textContent = imageName;
          div.appendChild(caption);
        }
      }

      if (hasFile) {
        const fileCard = document.createElement("div");
        fileCard.className = "fileCard";

        const fileMeta = document.createElement("div");
        fileMeta.className = "fileMeta";

        const fileNameEl = document.createElement("div");
        fileNameEl.className = "fileName";
        fileNameEl.textContent = fileName || "arquivo";

        const fileInfoEl = document.createElement("div");
        fileInfoEl.className = "fileInfo";
        fileInfoEl.textContent = `${fileType || "arquivo"} • ${formatBytes(fileSize)}`;

        const downloadLink = document.createElement("a");
        downloadLink.className = "fileDownloadBtn";
        downloadLink.href = fileData;
        downloadLink.download = fileName || "arquivo";
        downloadLink.textContent = "Baixar";
        downloadLink.rel = "noopener noreferrer";

        fileMeta.appendChild(fileNameEl);
        fileMeta.appendChild(fileInfoEl);
        fileCard.appendChild(fileMeta);
        fileCard.appendChild(downloadLink);
        div.appendChild(fileCard);
      }

      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    function addLine(text, kind = "chat") {
      if (kind === "system") {
        addSystemLine(text);
        return;
      }

      addChatLine({ text });
    }

    function setStatus(on, text) {
      dot.classList.toggle("on", on);
      statusEl.textContent = text;
    }

    function enableChatUI(enable) {
      msgEl.disabled = !enable;
      pickImageBtn.disabled = !enable;
      pickFileBtn.disabled = !enable;
      sendBtn.disabled = !enable;
      if (enable) msgEl.focus();
    }

    // ===== Nome obrigatório antes de conectar =====
    let myName = sanitizeName(localStorage.getItem("chat_name"));

    function showNameModal() {
      nameOverlay.classList.add("show");
      namePick.value = myName || "";
      setTimeout(() => namePick.focus(), 0);
      enableChatUI(false);
    }

    function hideNameModal() {
      nameOverlay.classList.remove("show");
    }

    function confirmName() {
      const picked = sanitizeName(namePick.value);
      if (!picked) {
        addLine("[sistema] escolha um nome para entrar.", "system");
        namePick.focus();
        return;
      }
      myName = picked;
      localStorage.setItem("chat_name", myName);

      namePick.value = myName;
      hideNameModal();
      enableChatUI(true);

      // Só conecta depois do nome definido
      if (!ws || ws.readyState === WebSocket.CLOSED) connect();
    }

    enterChat.addEventListener("click", confirmName);
    namePick.addEventListener("keydown", (e) => {
      if (e.key === "Enter") confirmName();
    });

    if (!myName) {
      showNameModal();
    } else {
      namePick.value = myName;
      enableChatUI(true);
    }

    // ===== Funções de menção =====
    function parseMention(mentionStr) {
      // Parse @nome/número ou @nome
      const match = mentionStr.match(/^@([a-záéíóúãõâêôĉäëïöüñ\w-]+)(?:\/(\d+))?$/i);
      if (!match) return null;
      const name = match[1];
      const backCount = parseInt(match[2]) || 1;
      if (!messagesByAuthor[name]) return null;
      const messages = messagesByAuthor[name];
      const idx = messages.length - backCount;
      if (idx < 0) return null;
      return messages[idx];
    }

    function scrollToMessageAndBlink(messageId) {
      const msg = allMessages.find(m => m.messageId === messageId);
      if (!msg) return;
      msg.div.scrollIntoView({ behavior: "smooth", block: "center" });
      msg.div.classList.add("mention-blink");
      setTimeout(() => msg.div.classList.remove("mention-blink"), 1200);
    }

    function showMentionAutocomplete(letter) {
      const autocompleteDiv = document.getElementById("mentionAutocomplete") || createMentionAutocomplete();
      const authors = Object.keys(messagesByAuthor).filter(n => n.toLowerCase().startsWith(letter.toLowerCase()));
      if (authors.length === 0) {
        autocompleteDiv.style.display = "none";
        return;
      }
      autocompleteDiv.innerHTML = authors.map(name => 
        `<div class="mention-option" data-name="${name}">${name}</div>`
      ).join("");
      autocompleteDiv.style.display = "block";
    }

    function createMentionAutocomplete() {
      const div = document.createElement("div");
      div.id = "mentionAutocomplete";
      div.className = "mention-autocomplete";
      msgEl.parentElement.appendChild(div);
      div.addEventListener("click", (e) => {
        if (e.target.dataset.name) {
          insertMention(e.target.dataset.name);
        }
      });
      return div;
    }

    function insertMention(name) {
      const before = msgEl.value.lastIndexOf("@");
      if (before === -1) return;
      msgEl.value = msgEl.value.substring(0, before) + `@${name}/ `;
      msgEl.focus();
      document.getElementById("mentionAutocomplete").style.display = "none";
    }

    function handleMessageContext(messageId, name) {
      const currentText = msgEl.value;
      const backCount = (messagesByAuthor[name] ? messagesByAuthor[name].length - 1 : 0);
      msgEl.value = currentText + (currentText ? " " : "") + `@${name}/${backCount}`;
      msgEl.focus();
    }

    // ===== WebSocket =====
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}`;
    let ws;
    let historyApplied = false;
    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const MAX_FILE_BYTES = 100 * 1024 * 1024;
    const CHUNK_SIZE = 256 * 1024;
    let uploadInProgress = false;

    // Gera ou recupera ID único do dispositivo
    function getOrCreateDeviceId() {
      let deviceId = localStorage.getItem("chat_device_id");
      if (!deviceId) {
        deviceId = "dev_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("chat_device_id", deviceId);
      }
      return deviceId;
    }
    const deviceId = getOrCreateDeviceId();

    function setUploadProgress(visible, label = "", percent = 0) {
      uploadStatus.classList.toggle("show", visible);
      if (!visible) {
        uploadBarFill.style.width = "0%";
        return;
      }

      uploadLabel.textContent = label;
      const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
      uploadBarFill.style.width = `${safePercent}%`;
    }

    function connect() {
      if (!myName) return;

      setStatus(false, "conectando...");
      ws = new WebSocket(wsUrl);
      historyApplied = false;

      ws.addEventListener("open", () => {
        setStatus(true, "online");
        addLine("[sistema] conectado", "system");
        // Envia deviceId para registrar usuário
        ws.send(JSON.stringify({ type: "set-device-id", deviceId }));
      });

      ws.addEventListener("close", () => {
        setStatus(false, "offline (tentando reconectar...)");
        addLine("[sistema] desconectou", "system");
        setTimeout(connect, 800);
      });

      ws.addEventListener("message", (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }

        if (data.type === "system") {
          addSystemLine(`[${data.at}] [sistema] ${data.text}`);
        } else if (data.type === "history") {
          if (!historyApplied) {
            const items = Array.isArray(data.messages) ? data.messages : [];
            log.innerHTML = "";
            for (const item of items) {
              if (item && item.type === "chat") addChatLine(item);
            }
            historyApplied = true;
          }
        } else if (data.type === "chat") {
          addChatLine(data);
        }
      });
    }

    function send() {
      if (!myName) { showNameModal(); return; }
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const text = (msgEl.value || "").trim().slice(0, 500);
      if (!text) return;

      ws.send(JSON.stringify({ type: "chat", name: myName, text }));
      msgEl.value = "";
      msgEl.focus();
    }

    function sendImageFile(file) {
      if (!file) return;

      if (!myName) {
        showNameModal();
        return;
      }

      if (!file.type.startsWith("image/")) {
        addSystemLine("[sistema] selecione um arquivo de imagem válido.");
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        addSystemLine(`[sistema] imagem muito grande (${formatBytes(file.size)}). Limite: 10 MB.`);
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] você está offline. Não foi possível enviar a imagem.");
        return;
      }

      sendFileInChunks(file, "image");
    }

    function isAllowedAttachment(file) {
      const name = (file.name || "").toLowerCase();
      const type = (file.type || "").toLowerCase();
      const byMime = type.startsWith("text/")
        || type === "application/zip"
        || type === "application/x-zip-compressed"
        || type === "application/x-rar-compressed"
        || type === "application/vnd.rar"
        || type === "application/x-7z-compressed";
      const byExt = /\.(txt|md|csv|log|json|xml|zip|rar|7z)$/i.test(name);
      return byMime || byExt;
    }

    function sendAttachmentFile(file) {
      if (!file) return;

      if (!myName) {
        showNameModal();
        return;
      }

      if (!isAllowedAttachment(file)) {
        addSystemLine("[sistema] tipo de arquivo não suportado. Use texto ou compactado (.zip/.rar/.7z).");
        return;
      }

      if (file.size > MAX_FILE_BYTES) {
        addSystemLine(`[sistema] arquivo muito grande (${formatBytes(file.size)}). Limite: 100 MB.`);
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] você está offline. Não foi possível enviar o arquivo.");
        return;
      }

      sendFileInChunks(file, "file");
    }

    function uint8ArrayToBase64(bytes) {
      let binary = "";
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) {
        const chunk = bytes.subarray(i, i + step);
        binary += String.fromCharCode(...chunk);
      }
      return btoa(binary);
    }

    async function sendFileInChunks(file, kind) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] conexão indisponível para enviar arquivo.");
        return;
      }

      if (uploadInProgress) {
        addSystemLine("[sistema] aguarde o envio atual terminar para iniciar outro.");
        return;
      }

      uploadInProgress = true;

      const safeFileName = (file.name || (kind === "image" ? "imagem" : "arquivo")).slice(0, 120);
      const safeFileType = (file.type || (kind === "image" ? "image/png" : "application/octet-stream")).slice(0, 80);
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      setUploadProgress(true, `Enviando ${safeFileName}... 0%`, 0);

      try {
        ws.send(JSON.stringify({
          type: "file-start",
          transferId,
          kind,
          name: myName,
          fileName: safeFileName,
          fileType: safeFileType,
          fileSize: Number(file.size) || 0,
          totalChunks
        }));

        for (let index = 0; index < totalChunks; index += 1) {
          if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("offline");

          const start = index * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const buffer = await file.slice(start, end).arrayBuffer();
          const base64Chunk = uint8ArrayToBase64(new Uint8Array(buffer));

          ws.send(JSON.stringify({
            type: "file-chunk",
            transferId,
            index,
            data: base64Chunk
          }));

          const percent = ((index + 1) / totalChunks) * 100;
          setUploadProgress(true, `Enviando ${safeFileName}... ${Math.round(percent)}%`, percent);
        }

        ws.send(JSON.stringify({ type: "file-end", transferId }));
        setUploadProgress(true, `Enviado ${safeFileName}`, 100);
        setTimeout(() => setUploadProgress(false), 700);
      } catch {
        setUploadProgress(false);
        addSystemLine("[sistema] falha ao enviar arquivo em blocos.");
      } finally {
        uploadInProgress = false;
      }
    }

    let viewerBaseScale = 1;
    let viewerZoom = 1;
    const minZoom = 0.2;
    const maxZoom = 6;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOffsetX = 0;
    let panOffsetY = 0;
    let currentPanX = 0;
    let currentPanY = 0;

    // ===== Rastreamento de menções =====
    const allMessages = []; // { messageId, name, at, div }
    const messagesByAuthor = {}; // { name -> [ messageIds ] }

    function updateImageTransform() {
      const totalScale = viewerBaseScale * viewerZoom;
      const translate = `translate(${currentPanX}px, ${currentPanY}px)`;
      viewerImage.style.transform = `${translate} scale(${totalScale})`;
    }

    function fitViewerImageToStage() {
      if (!viewerImage.naturalWidth || !viewerImage.naturalHeight) return;
      const stageWidth = viewerStage.clientWidth - 32;
      const stageHeight = viewerStage.clientHeight - 72;
      const scaleX = Math.max(0.1, stageWidth / viewerImage.naturalWidth);
      const scaleY = Math.max(0.1, stageHeight / viewerImage.naturalHeight);
      viewerBaseScale = Math.min(1, Math.min(scaleX, scaleY));
    }

    function applyViewerScale() {
      viewerImage.style.cursor = viewerZoom > 1 ? "zoom-out" : "zoom-in";
      updateImageTransform();
    }

    function openImageViewer(src, alt) {
      viewerImage.src = src;
      viewerImage.alt = alt || "Imagem ampliada";
      viewerImage.draggable = false;
      currentPanX = 0;
      currentPanY = 0;

      imageViewer.classList.add("show");
      document.body.style.overflow = "hidden";

      const onLoad = () => {
        requestAnimationFrame(() => {
          fitViewerImageToStage();
          viewerZoom = 1;
          currentPanX = 0;
          currentPanY = 0;
          applyViewerScale();
        });
      };

      if (viewerImage.complete) onLoad();
      else viewerImage.addEventListener("load", onLoad, { once: true });
    }

    function closeImageViewer() {
      imageViewer.classList.remove("show");
      viewerImage.removeAttribute("src");
      viewerZoom = 1;
      viewerBaseScale = 1;
      currentPanX = 0;
      currentPanY = 0;
      isPanning = false;
      viewerStage.classList.remove("panning");
      applyViewerScale();
      document.body.style.overflow = "";
    }

    function changeViewerScale(delta, clientX, clientY) {
      const previous = viewerZoom;
      viewerZoom = Math.max(minZoom, Math.min(maxZoom, viewerZoom + delta));
      if (viewerZoom === previous) return;
      applyViewerScale();
    }

    sendBtn.addEventListener("click", send);
    msgEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });

    msgEl.addEventListener("input", () => {
      const value = msgEl.value;
      const atPos = value.lastIndexOf("@");
      if (atPos === -1) {
        const autocomplete = document.getElementById("mentionAutocomplete");
        if (autocomplete) autocomplete.style.display = "none";
        return;
      }
      const afterAt = value.substring(atPos + 1);
      const letter = afterAt.match(/^[a-záéíóúãõâêôĉäëïöüñ]/i);
      if (letter && !afterAt.includes(" ") && !afterAt.includes("/")) {
        showMentionAutocomplete(letter[0]);
      } else {
        const autocomplete = document.getElementById("mentionAutocomplete");
        if (autocomplete) autocomplete.style.display = "none";
      }
    });

    // Context menu para mencionar
    log.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const msgLine = e.target.closest(".msgLine");
      if (!msgLine || !msgLine.dataset.messageId) return;
      const messageId = msgLine.dataset.messageId;
      const msg = allMessages.find(m => m.messageId === messageId);
      if (!msg) return;
      handleMessageContext(messageId, msg.name);
    });

    pickImageBtn.addEventListener("click", () => {
      if (!myName) {
        showNameModal();
        return;
      }
      imageInput.click();
    });

    pickFileBtn.addEventListener("click", () => {
      if (!myName) {
        showNameModal();
        return;
      }
      fileInput.click();
    });

    imageInput.addEventListener("change", () => {
      const file = imageInput.files && imageInput.files[0];
      imageInput.value = "";
      sendImageFile(file);
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      sendAttachmentFile(file);
    });

    msgEl.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items || !items.length) return;

      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (!file) return;
          e.preventDefault();
          sendImageFile(file);
          return;
        }
      }
    });

    viewerClose.addEventListener("click", closeImageViewer);
    imageViewer.addEventListener("click", (e) => {
      if (e.target === imageViewer) closeImageViewer();
    });

    viewerImage.addEventListener("click", (e) => {
      const delta = viewerZoom > 1 ? -0.5 : 0.5;
      changeViewerScale(delta, e.clientX, e.clientY);
    });

    viewerStage.addEventListener("mousedown", (e) => {
      if (!imageViewer.classList.contains("show")) return;
      if (e.button !== 2) return;
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panOffsetX = currentPanX;
      panOffsetY = currentPanY;
      viewerStage.classList.add("panning");
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      e.preventDefault();
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      currentPanX = panOffsetX + dx;
      currentPanY = panOffsetY + dy;
      updateImageTransform();
    }, { passive: false });

    window.addEventListener("mouseup", (e) => {
      if (!isPanning || e.button !== 2) return;
      isPanning = false;
      panOffsetX = currentPanX;
      panOffsetY = currentPanY;
      viewerStage.classList.remove("panning");
    });

    viewerStage.addEventListener("contextmenu", (e) => {
      if (!imageViewer.classList.contains("show")) return;
      e.preventDefault();
    });

    viewerStage.addEventListener("wheel", (e) => {
      if (!imageViewer.classList.contains("show")) return;
      e.stopPropagation();
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      changeViewerScale(delta, e.clientX, e.clientY);
    }, { passive: false });

    document.addEventListener("keydown", (e) => {
      if (!imageViewer.classList.contains("show")) return;
      if (e.key === "Escape") closeImageViewer();
      if (e.key === "+" || e.key === "=") changeViewerScale(0.2, window.innerWidth / 2, window.innerHeight / 2);
      if (e.key === "-") changeViewerScale(-0.2, window.innerWidth / 2, window.innerHeight / 2);
    });

    window.addEventListener("resize", () => {
      if (!imageViewer.classList.contains("show")) return;
      fitViewerImageToStage();
      applyViewerScale();
    });

    if (myName) connect();