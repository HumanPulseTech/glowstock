(() => {
    if (typeof io !== 'function') return;
    if (!window.glowstockSocket) window.glowstockSocket = io();
})();
