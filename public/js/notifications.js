(() => {
  const socket = window.glowstockSocket || (typeof io === 'function' ? (window.glowstockSocket = io()) : null);
  const center = document.querySelector('[data-notification-center]');
  if (!socket || !center) return;

  const trigger = center.querySelector('[data-notification-bell]');
  const menu = center.querySelector('[data-notification-menu]');
  const list = center.querySelector('[data-notification-list]');
  const count = center.querySelector('[data-notification-count]');
  const clearButton = center.querySelector('[data-clear-notifications]');
  const total = center.querySelector('[data-notification-total]');
  const labels = {
    stock_low: 'Stock',
    pao_expiring: 'PAO',
    pao_expired: 'PAO',
    subscription_payment: 'Abonnement',
    subscription_credit: 'Avoir',
    announcement: 'Nouveauté'
  };

  const formatDate = (value) => {
    try { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
    catch (_) { return ''; }
  };

  function render(data = {}) {
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];
    const notificationCount = Number(data.count) || notifications.length;
    count.hidden = notificationCount === 0;
    count.textContent = notificationCount > 99 ? '99+' : String(notificationCount);
    total.textContent = notificationCount ? `${notificationCount} notification${notificationCount > 1 ? 's' : ''}` : 'À jour';
    clearButton.disabled = notificationCount === 0;
    list.textContent = '';

    if (!notifications.length) {
      const empty = document.createElement('p');
      empty.className = 'notification-empty';
      empty.textContent = 'Aucune notification pour le moment.';
      list.appendChild(empty);
      return;
    }

    notifications.forEach((notification) => {
      const item = notification.link ? document.createElement('a') : document.createElement('article');
      item.className = `notification-item type-${String(notification.type || 'announcement')}`;
      if (notification.link) item.href = notification.link;

      const top = document.createElement('div');
      top.className = 'notification-item-top';
      const title = document.createElement('strong');
      title.textContent = notification.title || 'Notification';
      const date = document.createElement('time');
      date.textContent = formatDate(notification.created_at);
      top.append(title, date);

      const message = document.createElement('p');
      message.textContent = notification.message || '';
      const kind = document.createElement('span');
      kind.className = 'notification-kind';
      kind.textContent = labels[notification.type] || 'Information';
      item.append(top, message, kind);
      list.appendChild(item);
    });
  }

  function requestNotifications() {
    socket.emit('notification data');
  }

  function closeMenu() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', () => {
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) requestNotifications();
  });

  clearButton.addEventListener('click', () => {
    if (!clearButton.disabled) socket.emit('clear notifications');
  });

  document.addEventListener('click', (event) => {
    if (!center.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

  socket.on('notifications response', render);
  socket.on('notifications cleared', requestNotifications);
  socket.on('notification created', requestNotifications);
  socket.on('notification error', (message) => {
    console.warn(message);
    if (!menu.hidden) list.textContent = message || 'Impossible de charger les notifications.';
  });

  if (socket.connected) requestNotifications();
  else socket.on('connect', requestNotifications);
})();
