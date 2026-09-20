(() => {
    if (typeof io !== 'function') return;
    const socket = window.glowstockSocket || (window.glowstockSocket = io());
    socket.emit('subscription status');
    socket.on('subscription status', (status) => {
        if (status.level !== 'limited') return;
        const banner = document.createElement('aside');
        banner.className = 'subscription-banner';
        banner.innerHTML = `<div><strong>Votre abonnement est en retard</strong><span>Vous conservez l’accès en consultation pendant encore ${Math.max(0, 15 - status.daysExpired)} jour(s). Les ajouts et modifications sont suspendus.</span></div><a href="mailto:contact@glowstock.fr?subject=Renouvellement%20GlowStock">Renouveler</a>`;
        document.querySelector('.main')?.prepend(banner);
        document.querySelectorAll('[data-subscription-full]').forEach((button) => {
            button.classList.add('subscription-disabled');
            button.setAttribute('aria-disabled', 'true');
            button.setAttribute('title', 'Indisponible pendant la période de grâce.');
            button.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
        });
    });
})();
