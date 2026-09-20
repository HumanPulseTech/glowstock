(() => {
    if (typeof io !== 'function') return;
    const socket = window.glowstockSocket || (window.glowstockSocket = io());
    const report = (message, context = {}) => {
        const safeMessage = String(message || 'Erreur navigateur').slice(0, 500);
        socket.emit('client error', {
            message: safeMessage,
            context: {
                page: window.location.pathname,
                ...context
            }
        });
    };

    window.addEventListener('error', (event) => report(event.message, { source: event.filename, line: event.lineno }));
    window.addEventListener('unhandledrejection', (event) => report(event.reason?.message || String(event.reason), { type: 'promise' }));
})();
