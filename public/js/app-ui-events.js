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
    let currentViewerSrc = "";
    let currentViewerName = "imagem";

    // ===== Rastreamento de menções =====
    const allMessages = []; // { messageId, name, at, div }
    const messageById = new Map();
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
      currentViewerSrc = src;
      currentViewerName = String(alt || "imagem").replace(/^Imagem enviada por\s+/i, "");
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
      currentViewerSrc = "";
      currentViewerName = "imagem";
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

    function downloadCurrentViewerImage() {
      if (!currentViewerSrc) return;
      const a = document.createElement("a");
      a.href = currentViewerSrc;
      a.download = `${String(currentViewerName || "imagem").replace(/[^a-z0-9._-]+/gi, "_") || "imagem"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    sendBtn.addEventListener("click", send);
    msgEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    msgEl.addEventListener("input", () => {
      const normalized = normalizeMessageText(msgEl.value);
      if (normalized !== msgEl.value) {
        msgEl.value = normalized;
      }

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
      const msg = messageById.get(messageId);
      if (!msg) return;
      handleMessageContext(messageId, msg.name);
    });

    pickFileBtn.addEventListener("click", () => {
      if (!myName) {
        showNameModal();
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = "";
      sendFileBundle(files);
    });

    msgEl.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items || !items.length) return;

      for (const item of items) {
        if (item.kind === "file" && (item.type.startsWith("image/") || item.type.startsWith("video/"))) {
          const file = item.getAsFile();
          if (!file) return;
          e.preventDefault();
          sendMediaFiles([file]);
          return;
        }
      }
    });

    viewerClose.addEventListener("click", closeImageViewer);
    if (viewerDownload) {
      viewerDownload.addEventListener("click", downloadCurrentViewerImage);
    }
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

    document.addEventListener("visibilitychange", () => {
      sendPresenceUpdate();
    });

    window.addEventListener("focus", () => {
      sendPresenceUpdate();
    });

    window.addEventListener("blur", () => {
      sendPresenceUpdate();
    });

