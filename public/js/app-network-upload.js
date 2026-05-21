    let wasBlockedByHost = false;

    function connect() {
      if (!myName) return;

      setStatus(false, "conectando...");
      ws = new WebSocket(wsUrl);
      historyApplied = false;
      wasBlockedByHost = false;

      function sendIdentity() {
        if (!ws || ws.readyState !== WebSocket.OPEN || !myName) return;
        ws.send(JSON.stringify({
          type: "set-device-id",
          deviceId,
          name: myName,
          tabActive: isTabActiveNow()
        }));
      }

      window.__chatSendIdentity = sendIdentity;

      ws.addEventListener("open", () => {
        setStatus(true, "online");
        addLine("[sistema] conectado", "system");
        // Envia deviceId e presença inicial para registrar usuário.
        sendIdentity();
      });

      ws.addEventListener("close", () => {
        setStatus(false, "offline (tentando reconectar...)");
        addLine("[sistema] desconectou", "system");
        if (wasBlockedByHost) return;
        setTimeout(connect, 800);
      });

      ws.addEventListener("message", (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }

        function applyHistory(items) {
          if (typeof hideMessageContextMenu === "function") {
            hideMessageContextMenu();
          }
          resetMessageTracking();
          log.innerHTML = "";
          for (const item of items) {
            if (item && item.type === "chat") addChatLine(item);
          }
          historyApplied = true;
        }

        if (data.type === "system") {
          addSystemLine(`[${data.at}] [sistema] ${data.text}`);
        } else if (data.type === "session-info") {
          if (typeof setCanBlockNames === "function") {
            setCanBlockNames(!!data.canBlockNames);
          }
        } else if (data.type === "history") {
          if (!historyApplied) {
            applyHistory(Array.isArray(data.messages) ? data.messages : []);
          }
        } else if (data.type === "history-refresh") {
          applyHistory(Array.isArray(data.messages) ? data.messages : []);
        } else if (data.type === "chat") {
          addChatLine(data);
        } else if (data.type === "people-list") {
          renderPeopleList(Array.isArray(data.people) ? data.people : []);
        } else if (data.type === "poke") {
          notifyPoke(data.fromName);
        } else if (data.type === "name-error") {
          const msg = String(data.text || "Nome já está em uso. Escolha outro.");
          addSystemLine(`[${data.at || "--:--:--"}] [sistema] ${msg}`);
          setStatus(false, "nome em conflito");
          showNameModal();
        } else if (data.type === "name-blocked") {
          const msg = String(data.text || "Nome bloqueado pelo host.");
          wasBlockedByHost = true;
          myName = null;
          localStorage.removeItem("chat_name");
          addSystemLine(`[${data.at || "--:--:--"}] [sistema] ${msg}`);
          setStatus(false, "nome bloqueado");
          showNameModal();
        }
      });
    }

    if (window.__chatAutoConnectPending) {
      window.__chatAutoConnectPending = false;
      connect();
    }

    function send() {
      if (!myName) { showNameModal(); return; }
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const text = normalizeMessageText(msgEl.value).trim();
      if (!text) return;

      ws.send(JSON.stringify({ type: "chat", name: myName, text }));
      msgEl.value = "";
      msgEl.focus();
    }

    function detectFileKind(file) {
      if (!file) return "file";
      const type = String(file.type || "").toLowerCase();
      const name = String(file.name || "").toLowerCase();

      if (type.startsWith("image/")) return "image";
      if (type.startsWith("video/")) return "video";
      if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(name)) return "image";
      if (/\.(mp4|webm|ogg|mov|m4v|mkv)$/i.test(name)) return "video";
      return "file";
    }

    function isImageFile(file) {
      return detectFileKind(file) === "image";
    }

    function isVideoFile(file) {
      return detectFileKind(file) === "video";
    }

    async function sendMediaFiles(files) {
      const selected = Array.from(files || []).filter((file) => isImageFile(file) || isVideoFile(file));
      if (!selected.length) return;

      if (!myName) {
        showNameModal();
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] você está offline. Não foi possível enviar mídia.");
        return;
      }

      if (selected.length > MAX_MEDIA_PER_BATCH) {
        addSystemLine(`[sistema] máximo de ${MAX_MEDIA_PER_BATCH} mídias por envio. As primeiras serão enviadas.`);
      }

      const limited = selected.slice(0, MAX_MEDIA_PER_BATCH);
      for (let i = 0; i < limited.length; i += 1) {
        const file = limited[i];
        if (isImageFile(file) && file.size > MAX_IMAGE_BYTES) {
          addSystemLine(`[sistema] imagem muito grande (${formatBytes(file.size)}). Limite: 50 MB.`);
          continue;
        }

        if (isVideoFile(file) && file.size > MAX_VIDEO_BYTES) {
          addSystemLine(`[sistema] vídeo muito grande (${formatBytes(file.size)}). Limite: 500 MB.`);
          continue;
        }

        const kind = isImageFile(file) ? "image" : "video";
        await sendFileInChunks(file, kind, {
          batchLabelPrefix: `Mídia ${i + 1}/${limited.length}`,
          finishLabel: `Mídia ${i + 1}/${limited.length} enviada`
        });
      }
    }

    async function sendFileBundle(files) {
      const selected = Array.from(files || []);
      if (!selected.length) return;

      if (!myName) {
        showNameModal();
        return;
      }

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] você está offline. Não foi possível enviar o arquivo.");
        return;
      }

      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) {
          addSystemLine(`[sistema] arquivo muito grande (${formatBytes(file.size)}). Limite: 1 GB.`);
          return;
        }
      }

      if (selected.length === 1) {
        const kind = detectFileKind(selected[0]);
        await sendFileInChunks(selected[0], kind);
        return;
      }

      const bundleId = `bundle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const totalInBundle = selected.length;
      ws.send(JSON.stringify({
        type: "bundle-start",
        bundleId,
        name: myName,
        totalInBundle
      }));

      addSystemLine(`[sistema] enviando pacote com ${totalInBundle} arquivos...`);

      for (let i = 0; i < selected.length; i += 1) {
        await sendFileInChunks(selected[i], "file", {
          bundleId,
          bundleIndex: i,
          totalInBundle,
          batchLabelPrefix: `Arquivo ${i + 1}/${totalInBundle}`,
          finishLabel: i === totalInBundle - 1 ? "Pacote enviado" : `Arquivo ${i + 1}/${totalInBundle} enviado`
        });
      }
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

    async function sendFileInChunks(file, kind, options = {}) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        addSystemLine("[sistema] conexão indisponível para enviar arquivo.");
        return;
      }

      if (uploadInProgress) {
        addSystemLine("[sistema] aguarde o envio atual terminar para iniciar outro.");
        return;
      }

      uploadInProgress = true;

      const safeFileName = (file.name || (kind === "image" ? "imagem" : kind === "video" ? "video" : "arquivo")).slice(0, 120);
      const safeFileType = (file.type || (kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "application/octet-stream")).slice(0, 80);
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const batchPrefix = options.batchLabelPrefix ? `${options.batchLabelPrefix} • ` : "";
      setUploadProgress(true, `${batchPrefix}Enviando ${safeFileName}... 0%`, 0);

      try {
        ws.send(JSON.stringify({
          type: "file-start",
          transferId,
          kind,
          name: myName,
          fileName: safeFileName,
          fileType: safeFileType,
          fileSize: Number(file.size) || 0,
          totalChunks,
          bundleId: options.bundleId || "",
          bundleIndex: Number.isInteger(options.bundleIndex) ? options.bundleIndex : -1,
          totalInBundle: Number.isInteger(options.totalInBundle) ? options.totalInBundle : 0
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
          setUploadProgress(true, `${batchPrefix}Enviando ${safeFileName}... ${Math.round(percent)}%`, percent);
        }

        ws.send(JSON.stringify({ type: "file-end", transferId }));
        setUploadProgress(true, options.finishLabel || `Enviado ${safeFileName}`, 100);
        setTimeout(() => setUploadProgress(false), 700);
      } catch {
        setUploadProgress(false);
        addSystemLine("[sistema] falha ao enviar arquivo em blocos.");
      } finally {
        uploadInProgress = false;
      }
    }

