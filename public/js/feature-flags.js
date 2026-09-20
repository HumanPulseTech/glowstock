(() => {
  const socket = window.glowstockSocket || (typeof io === 'function' ? (window.glowstockSocket = io()) : null);
  if (!socket) return;

  function applyFeatureFlags(flags = {}) {
    ensurePlanningLink();
    document.querySelectorAll('[data-feature]').forEach((element) => {
      const enabled = flags[element.dataset.feature] !== false;
      element.hidden = !enabled;
      element.setAttribute('aria-hidden', String(!enabled));
    });
  }

  function ensurePlanningLink() {
    if (document.querySelector('.sidebar [data-feature="planning"]')) return;
    const ticketsLink = document.querySelector('.sidebar .nav-item[data-feature="tickets"]');
    if (!ticketsLink) return;
    const link = document.createElement('a');
    link.className = 'nav-item';
    link.href = '/dashboard/planning/';
    link.dataset.feature = 'planning';
    link.dataset.planningNav = 'true';
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>Planning';
    ticketsLink.before(link);
  }

  function requestFeatureFlags() {
    socket.emit('feature flags');
  }

  socket.on('feature flags response', applyFeatureFlags);
  socket.on('feature flag updated', ({ flags } = {}) => applyFeatureFlags(flags));
  socket.on('feature disabled', () => requestFeatureFlags());

  if (socket.connected) requestFeatureFlags();
  else socket.on('connect', requestFeatureFlags);
})();
