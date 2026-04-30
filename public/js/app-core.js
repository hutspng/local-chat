    const log = document.getElementById("log");
    const systemLog = document.getElementById("systemLog");
    const dot = document.getElementById("dot");
    const statusEl = document.getElementById("status");
    const msgEl = document.getElementById("msg");
    const pickFileBtn = document.getElementById("pickFile");
    const fileInput = document.getElementById("fileInput");
    const sendBtn = document.getElementById("send");
    const uploadStatus = document.getElementById("uploadStatus");
    const uploadLabel = document.getElementById("uploadLabel");
    const uploadBarFill = document.getElementById("uploadBarFill");
    const linkHint = document.getElementById("linkHint");
    const peopleListEl = document.getElementById("peopleList");
    const peopleSummaryEl = document.getElementById("peopleSummary");
    const imageViewer = document.getElementById("imageViewer");
    const viewerDownload = document.getElementById("viewerDownload");
    const viewerClose = document.getElementById("viewerClose");
    const viewerStage = document.getElementById("viewerStage");
    const viewerImage = document.getElementById("viewerImage");

    const nameOverlay = document.getElementById("nameOverlay");
    const namePick = document.getElementById("namePick");
    const enterChat = document.getElementById("enterChat");
    const peopleState = new Map();

    // Mantem a dica no formato antigo para facilitar acesso por IP na rede local.
    linkHint.textContent = "http://IP:3000";

    function sanitizeName(s) {
      return (s || "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 24) || "Anônimo";
    }

    function formatBytes(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    const MAX_MESSAGE_LINES = 100;
    const MAX_MESSAGE_CHARS = 10000;

    function normalizeMessageText(raw) {
      const limitedChars = String(raw || "").slice(0, MAX_MESSAGE_CHARS);
      const normalizedBreaks = limitedChars.replace(/\r\n/g, "\n");
      const lines = normalizedBreaks.split("\n");
      if (lines.length <= MAX_MESSAGE_LINES) {
        return normalizedBreaks;
      }
      return lines.slice(0, MAX_MESSAGE_LINES).join("\n");
    }

    function addSystemLine(text) {
      const div = document.createElement("div");
      div.textContent = text;

      div.className = "sysLine";
      systemLog.appendChild(div);
      systemLog.scrollTop = systemLog.scrollHeight;
    }

    function isTabActiveNow() {
      return !document.hidden;
    }

    function insertPersonMention(name) {
      const safeName = String(name || "").trim();
      if (!safeName) return;
      const current = msgEl.value;
      msgEl.value = `${current}${current ? " " : ""}@${safeName}`;
      msgEl.focus();
      msgEl.selectionStart = msgEl.value.length;
      msgEl.selectionEnd = msgEl.value.length;
    }

    function canPoke(person) {
      if (!person || !person.deviceId) return false;
      if (person.deviceId === deviceId) return false;
      return !person.tabActive;
    }

    function updatePeopleSummary(people) {
      if (!peopleSummaryEl) return;
      const total = people.length;
      const activeCount = people.filter((person) => person.tabActive).length;
      peopleSummaryEl.textContent = `${total} online • ${activeCount} ativos`;
    }

    function renderPeopleList(people) {
      if (!peopleListEl) return;
      const normalized = Array.isArray(people) ? people : [];
      peopleState.clear();
      peopleListEl.innerHTML = "";

      const sorted = normalized
        .slice()
        .sort((a, b) => {
          if (a.tabActive !== b.tabActive) return a.tabActive ? -1 : 1;
          return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" });
        });

      if (!sorted.length) {
        const empty = document.createElement("div");
        empty.className = "small";
        empty.textContent = "Nenhuma pessoa online.";
        peopleListEl.appendChild(empty);
        updatePeopleSummary([]);
        return;
      }

      for (const person of sorted) {
        const item = document.createElement("div");
        item.className = "peopleItem";

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = `peopleDot${person.tabActive ? " active" : ""}`;

        const selfSuffix = person.deviceId === deviceId ? " (você)" : "";
        if (canPoke(person)) {
          dot.classList.add("pokeable");
          dot.title = `Cutucar ${person.name}`;
          dot.addEventListener("click", () => sendPoke(person));
        } else {
          dot.disabled = true;
          dot.title = person.tabActive ? "Guia ativa" : "Guia inativa";
        }

        const nameBtn = document.createElement("button");
        nameBtn.type = "button";
        nameBtn.className = "peopleName";
        nameBtn.textContent = `${person.name}${selfSuffix}`;
        nameBtn.title = `Mencionar @${person.name}`;
        nameBtn.addEventListener("click", () => insertPersonMention(person.name));

        const state = document.createElement("div");
        state.className = "peopleState";
        state.textContent = person.tabActive ? "ativo" : "ausente";

        item.appendChild(dot);
        item.appendChild(nameBtn);
        item.appendChild(state);
        peopleListEl.appendChild(item);
        peopleState.set(person.deviceId, person);
      }

      updatePeopleSummary(sorted);
    }

    function sendPresenceUpdate(force = false) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!myName) return;

      const payload = {
        type: "presence-update",
        name: myName,
        tabActive: isTabActiveNow(),
        force: !!force
      };
      ws.send(JSON.stringify(payload));
    }

    function requestNotificationPermissionIfPossible() {
      if (!("Notification" in window)) return;
      if (Notification.permission !== "default") return;
      Notification.requestPermission().catch(() => {});
    }

    function notifyPoke(fromName) {
      const safeName = String(fromName || "Alguém");
      addSystemLine(`[sistema] ${safeName} cutucou você.`);

      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;

      try {
        const notification = new Notification("Cutucada no chat", {
          body: `${safeName} quer sua atenção.`
        });
        setTimeout(() => notification.close(), 5000);
      } catch {
        // Ignora falhas de notificação do navegador.
      }
    }

    function sendPoke(person) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!canPoke(person)) return;

      ws.send(JSON.stringify({
        type: "poke-user",
        targetDeviceId: person.deviceId,
        targetName: person.name
      }));
      addSystemLine(`[sistema] cutucada enviada para ${person.name}.`);
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
            a.title = getMentionTooltipText(mention);
            a.addEventListener("mouseenter", () => {
              a.title = getMentionTooltipText(mention);
            });
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

    function addChatLine({ at = "", name = "Anônimo", text = "", imageData = "", imageName = "", videoData = "", videoName = "", fileData = "", fileName = "", fileType = "", fileSize = 0, bundleFiles = [], messageId = "" }) {
      const div = document.createElement("div");
      div.className = "msgLine chat";
      if (messageId) div.dataset.messageId = messageId;
      const hasText = !!String(text || "").trim();
      const normalizedFileType = String(fileType || "").toLowerCase();
      const dataMimeMatch = String(fileData || "").match(/^data:([^;]+);base64,/i);
      const fileDataMime = dataMimeMatch ? String(dataMimeMatch[1] || "").toLowerCase() : "";
      const effectiveMime = normalizedFileType || fileDataMime;
      const lowerFileName = String(fileName || "").toLowerCase();
      const isImageByExt = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(lowerFileName);
      const isVideoByExt = /\.(mp4|webm|ogg|mov|m4v|mkv)$/i.test(lowerFileName);

      const inferredImageFromFile = !imageData && !!fileData && (effectiveMime.startsWith("image/") || isImageByExt);
      const inferredVideoFromFile = !videoData && !!fileData && !inferredImageFromFile && (effectiveMime.startsWith("video/") || isVideoByExt);

      const resolvedImageData = imageData || (inferredImageFromFile ? fileData : "");
      const resolvedImageName = imageName || (inferredImageFromFile ? fileName : "");
      const resolvedVideoData = videoData || (inferredVideoFromFile ? fileData : "");
      const resolvedVideoName = videoName || (inferredVideoFromFile ? fileName : "");

      const hasImage = !!resolvedImageData;
      const hasVideo = !!resolvedVideoData;
      const hasFile = !!fileData;
      const shouldRenderAsDownload = hasFile && !inferredImageFromFile && !inferredVideoFromFile;
      const safeBundleFiles = Array.isArray(bundleFiles)
        ? bundleFiles.filter((item) => item && typeof item.fileData === "string")
        : [];
      const hasBundle = safeBundleFiles.length > 0;

      if (!hasText && hasImage) {
        div.classList.add("imageOnly");
      }

      // Rastrear mensagem com deduplicação por messageId
      if (messageId) {
        const existing = messageById.get(messageId);
        if (existing) {
          existing.name = name;
          existing.at = at;
          existing.div = div;
        } else {
          const tracked = { messageId, name, at, div };
          allMessages.push(tracked);
          messageById.set(messageId, tracked);
          if (!messagesByAuthor[name]) messagesByAuthor[name] = [];
          messagesByAuthor[name].push(messageId);
        }
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

      if (resolvedImageData) {
        const img = document.createElement("img");
        img.className = "chatImage";
        img.src = resolvedImageData;
        img.alt = `Imagem enviada por ${name}`;
        img.loading = "lazy";
        img.addEventListener("click", () => openImageViewer(resolvedImageData, img.alt));
        div.appendChild(img);

        if (resolvedImageName) {
          const caption = document.createElement("div");
          caption.className = "imageCaption";
          caption.textContent = resolvedImageName;
          div.appendChild(caption);
        }
      }

      if (resolvedVideoData) {
        const video = document.createElement("video");
        video.className = "chatVideo";
        video.src = resolvedVideoData;
        video.controls = true;
        video.preload = "metadata";
        div.appendChild(video);

        if (resolvedVideoName) {
          const caption = document.createElement("div");
          caption.className = "imageCaption";
          caption.textContent = resolvedVideoName;
          div.appendChild(caption);
        }
      }

      if (shouldRenderAsDownload) {
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

      if (hasBundle) {
        const bundleCard = document.createElement("div");
        bundleCard.className = "bundleCard";

        const bundleMeta = document.createElement("div");
        bundleMeta.className = "fileMeta";

        const bundleTitle = document.createElement("div");
        bundleTitle.className = "fileName";
        bundleTitle.textContent = `${safeBundleFiles.length} arquivos enviados`;

        const totalSize = safeBundleFiles.reduce((acc, item) => acc + (Number(item?.fileSize) || 0), 0);
        const bundleInfo = document.createElement("div");
        bundleInfo.className = "fileInfo";
        bundleInfo.textContent = `Total: ${formatBytes(totalSize)}`;

        const actions = document.createElement("div");
        actions.className = "bundleActions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "fileDownloadBtn";
        openBtn.textContent = "Downloads individuais";
        openBtn.addEventListener("click", () => openBundlePopup(safeBundleFiles));

        const zipBtn = document.createElement("button");
        zipBtn.type = "button";
        zipBtn.className = "fileDownloadBtn";
        zipBtn.textContent = "Baixar tudo (.zip)";
        zipBtn.addEventListener("click", () => downloadBundleAsZip(safeBundleFiles));

        bundleMeta.appendChild(bundleTitle);
        bundleMeta.appendChild(bundleInfo);
        actions.appendChild(openBtn);
        actions.appendChild(zipBtn);
        bundleCard.appendChild(bundleMeta);
        bundleCard.appendChild(actions);
        div.appendChild(bundleCard);
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
      requestNotificationPermissionIfPossible();

      namePick.value = myName;
      hideNameModal();
      enableChatUI(true);

      if (ws && ws.readyState === WebSocket.OPEN) {
        sendPresenceUpdate(true);
      }

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
    function getAuthorMessageIds(authorRef) {
      if (messagesByAuthor[authorRef]) return messagesByAuthor[authorRef];
      const normalized = String(authorRef || "").toLowerCase();
      const matchedKey = Object.keys(messagesByAuthor).find((name) => name.toLowerCase() === normalized);
      return matchedKey ? messagesByAuthor[matchedKey] : null;
    }

    function parseMention(mentionStr) {
      // Parse @nome/número ou @nome
      const match = mentionStr.match(/^@([a-záéíóúãõâêôĉäëïöüñ\w-]+)(?:\/(\d+))?$/i);
      if (!match) return null;
      const name = match[1];
      const backCount = Number.isInteger(Number(match[2])) ? Number(match[2]) : 0;
      const messages = getAuthorMessageIds(name);
      if (!messages || !messages.length) return null;
      const idx = messages.length - 1 - backCount;
      if (idx < 0 || idx >= messages.length) return null;
      return messages[idx];
    }

    function getMentionTooltipText(mentionStr) {
      const targetMessageId = parseMention(mentionStr);
      if (!targetMessageId) return "Referência não encontrada";
      const target = messageById.get(targetMessageId);
      if (!target) return "Referência não encontrada";
      return `${target.name} às ${target.at}`;
    }

    function scrollToMessageAndBlink(messageId) {
      const msg = messageById.get(messageId);
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
      msgEl.value = msgEl.value.substring(0, before) + `@${name}/0 `;
      msgEl.focus();
      document.getElementById("mentionAutocomplete").style.display = "none";
    }

    function handleMessageContext(messageId, name) {
      const currentText = msgEl.value;
      const messages = getAuthorMessageIds(name) || [];
      const pos = messages.lastIndexOf(messageId);
      const backCount = pos >= 0 ? (messages.length - 1 - pos) : 0;
      msgEl.value = currentText + (currentText ? " " : "") + `@${name}/${backCount}`;
      msgEl.focus();
    }

    // ===== WebSocket =====
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}`;
    let ws;
    let historyApplied = false;
    const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
    const MAX_FILE_BYTES = 1024 * 1024 * 1024;
    const MAX_MEDIA_PER_BATCH = 10;
    // Must be divisible by 3 so concatenated per-chunk base64 remains valid.
    const CHUNK_SIZE = 255 * 1024;
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

    function resetMessageTracking() {
      allMessages.length = 0;
      messageById.clear();
      for (const author of Object.keys(messagesByAuthor)) {
        delete messagesByAuthor[author];
      }
    }

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

    function ensureBundlePopup() {
      let overlay = document.getElementById("bundlePopup");
      if (overlay) return overlay;

      overlay = document.createElement("div");
      overlay.id = "bundlePopup";
      overlay.className = "bundlePopup";
      overlay.innerHTML = `
        <div class="bundlePopupCard">
          <div class="bundlePopupHeader">
            <strong>Downloads individuais</strong>
            <button type="button" id="bundlePopupClose">Fechar</button>
          </div>
          <div id="bundlePopupList" class="bundlePopupList"></div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("show");
      });

      const closeBtn = overlay.querySelector("#bundlePopupClose");
      closeBtn.addEventListener("click", () => overlay.classList.remove("show"));

      return overlay;
    }

    function openBundlePopup(bundleFiles) {
      const overlay = ensureBundlePopup();
      const list = overlay.querySelector("#bundlePopupList");
      list.innerHTML = "";

      for (const file of bundleFiles) {
        const row = document.createElement("div");
        row.className = "bundlePopupItem";

        const info = document.createElement("div");
        info.className = "bundlePopupInfo";
        info.textContent = `${file.fileName || "arquivo"} (${formatBytes(file.fileSize || 0)})`;

        const link = document.createElement("a");
        link.className = "fileDownloadBtn";
        link.href = file.fileData;
        link.download = file.fileName || "arquivo";
        link.textContent = "Baixar";
        link.rel = "noopener noreferrer";

        row.appendChild(info);
        row.appendChild(link);
        list.appendChild(row);
      }

      overlay.classList.add("show");
    }

    async function downloadBundleAsZip(bundleFiles) {
      if (!window.JSZip) {
        addSystemLine("[sistema] biblioteca de ZIP não carregada para baixar tudo.");
        return;
      }

      try {
        const zip = new window.JSZip();
        for (const file of bundleFiles) {
          const fileData = String(file.fileData || "");
          const commaIndex = fileData.indexOf(",");
          if (commaIndex === -1) continue;
          const base64 = fileData.slice(commaIndex + 1);
          zip.file(file.fileName || "arquivo", base64, { base64: true });
        }

        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `arquivos-${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        addSystemLine("[sistema] falha ao gerar o ZIP para baixar tudo.");
      }
    }

