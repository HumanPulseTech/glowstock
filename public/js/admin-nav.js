(() => {
    const link = document.querySelector('[data-admin-link]');
    if (!link || typeof io !== 'function') return;
    link.style.display = 'none';
    const socket = window.glowstockSocket || (window.glowstockSocket = io());
    socket.emit('information user');
    socket.on('reponse information user', (user) => {
        if (user.role === 'admin') {
            link.hidden = false;
            link.style.display = '';
        }
    });
})();
