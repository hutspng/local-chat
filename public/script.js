(function loadAppModules() {
  const modules = [
    "js/app-core.js",
    "js/app-network-upload.js",
    "js/app-ui-events.js"
  ];

  function loadSequentially(index) {
    if (index >= modules.length) return;

    const script = document.createElement("script");
    script.src = modules[index];
    script.defer = false;
    script.onload = function onLoad() {
      loadSequentially(index + 1);
    };
    script.onerror = function onError() {
      console.error("Falha ao carregar módulo:", modules[index]);
    };
    document.head.appendChild(script);
  }

  loadSequentially(0);
})();
