    const log = document.getElementById("log");
    const systemLog = document.getElementById("systemLog");
    const dot = document.getElementById("dot");
    const statusEl = document.getElementById("status");
    const msgEl = document.getElementById("msg");
    const pickImageBtn = document.getElementById("pickImage");
    const imageInput = document.getElementById("imageInput");
    const sendBtn = document.getElementById("send");
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

    function addSystemLine(text) {
      const div = document.createElement("div");
      div.textContent = text;

      div.className = "sysLine";
      systemLog.appendChild(div);
      systemLog.scrollTop = systemLog.scrollHeight;
    }

    function appendTextWithLinks(container, text) {
      const urlRegex = /(https?:\/\/[^\s]+)/gi;
      const matches = text.matchAll(urlRegex);
      let lastIndex = 0;

      for (const match of matches) {
        const urlText = match[0];
        const index = match.index ?? 0;

        if (index > lastIndex) {
          container.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        }

        let safeUrl = "";
        try {
          const parsed = new URL(urlText);
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
          a.textContent = urlText;
          container.appendChild(a);
        } else {
          container.appendChild(document.createTextNode(urlText));
        }

        lastIndex = index + urlText.length;
      }

      if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
    }

    function addChatLine({ at = "", name = "Anônimo", text = "", imageData = "", imageName = "" }) {
      const div = document.createElement("div");
      div.className = "msgLine chat";
      const hasText = !!String(text || "").trim();
      const hasImage = !!imageData;

      if (!hasText && hasImage) {
        div.classList.add("imageOnly");
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

    // ===== WebSocket =====
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${location.host}`;
    let ws;
    let historyApplied = false;

    function connect() {
      if (!myName) return;

      setStatus(false, "conectando...");
      ws = new WebSocket(wsUrl);
      historyApplied = false;

      ws.addEventListener("open", () => {
        setStatus(true, "online");
        addLine("[sistema] conectado", "system");
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

      const maxBytes = 1.5 * 1024 * 1024;
      if (file.size > maxBytes) {
        addSystemLine("[sistema] imagem muito grande. Limite: 1.5 MB.");
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] você está offline. Não foi possível enviar a imagem.");
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const imageData = typeof reader.result === "string" ? reader.result : "";
        if (!imageData) return;

        ws.send(JSON.stringify({
          type: "chat",
          name: myName,
          text: "",
          imageData,
          imageName: (file.name || "imagem-colada.png").slice(0, 80)
        }));
      });
      reader.readAsDataURL(file);
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

    pickImageBtn.addEventListener("click", () => {
      if (!myName) {
        showNameModal();
        return;
      }
      imageInput.click();
    });

    imageInput.addEventListener("change", () => {
      const file = imageInput.files && imageInput.files[0];
      imageInput.value = "";
      sendImageFile(file);
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