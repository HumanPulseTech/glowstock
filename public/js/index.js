(() => {
  const offersList = document.getElementById('offers_list');
  if (!offersList) return;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
  const formatPrice = (value) => new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR'
  }).format(Number(value) || 0);
  const accessLabels = {
    dashboard: 'Tableau de bord',
    inventory: 'Inventaire',
    products: 'Création de produits',
    scanner: 'Scanner',
    pao: 'PAO',
    tickets: 'Tickets',
    notifications: 'Notifications'
  };

  const buildOffer = (offer) => {
    const price = Number(offer.price);
    const originalPrice = Number(offer.originalPrice);
    const hasReduction = Number.isFinite(originalPrice) && originalPrice > price;
    const reduction = offer.discountLabel || (hasReduction ? `-${Math.round((1 - (price / originalPrice)) * 100)} %` : '');
    const features = Array.isArray(offer.features) ? offer.features.filter(Boolean) : [];
    const includedAccess = Array.isArray(offer.includedAccess)
      ? offer.includedAccess.map((key) => accessLabels[key]).filter(Boolean)
      : [];
    const safeName = escapeHtml(offer.name);
    const safeDescription = escapeHtml(offer.description || '');
    const safePeriod = escapeHtml(offer.billingPeriod || '');
    const safeCta = escapeHtml(offer.ctaLabel || 'Commencer l’essai');
    return `<article class="w-full md:w-[calc(50%-12px)] xl:w-[calc(33.333%-16px)] bg-brand-surface rounded-3xl p-8 border border-brand-border shadow-soft relative overflow-hidden">
      <div class="absolute top-0 left-0 w-full h-2 bg-brand-sage"></div>
      ${reduction ? `<span class="absolute top-5 right-5 rounded-full bg-brand-sage text-white px-3 py-1 text-xs font-bold">${escapeHtml(reduction)}</span>` : ''}
      <div class="text-center pt-7 mb-8">
        <h3 class="text-xl font-bold mb-2">${safeName}</h3>
        <div class="flex items-baseline justify-center gap-2 flex-wrap">
          <span class="text-5xl font-black">${formatPrice(price)}</span>
          ${hasReduction ? `<span class="text-brand-muted line-through">${formatPrice(originalPrice)}</span>` : ''}
          <span class="text-brand-muted">${safePeriod}</span>
        </div>
        ${safeDescription ? `<p class="text-sm text-brand-muted mt-2">${safeDescription}</p>` : ''}
      </div>
      <ul class="space-y-4 mb-8">
        ${features.map((feature) => `<li class="flex items-center gap-3"><i data-lucide="check-circle-2" class="w-5 h-5 text-brand-sage flex-shrink-0"></i><span class="text-brand-text">${escapeHtml(feature)}</span></li>`).join('')}
      </ul>
      ${includedAccess.length ? `<div class="border-t border-brand-border pt-4 mb-8"><p class="text-xs font-bold uppercase tracking-wide text-brand-muted mb-2">Accès inclus</p><div class="flex flex-wrap gap-2">${includedAccess.map((label) => `<span class="rounded-full bg-brand-bg border border-brand-border px-3 py-1 text-xs text-brand-text">${escapeHtml(label)}</span>`).join('')}</div></div>` : ''}
      <a href="/ins/?offer=${encodeURIComponent(String(offer.id))}" class="block w-full py-4 text-center bg-brand-sage text-white rounded-xl font-bold hover:bg-brand-sageHover transition-colors shadow-sm">${safeCta}</a>
    </article>`;
  };

  fetch('/api/offers')
    .then((response) => {
      if (!response.ok) throw new Error('Impossible de charger les offres.');
      return response.json();
    })
    .then((data) => {
      const offers = Array.isArray(data.offers) ? data.offers : [];
      if (!offers.length) return;
      offersList.innerHTML = offers.map(buildOffer).join('');
      offersList.closest('#pricing')?.removeAttribute('hidden');
      window.lucide?.createIcons();
    })
    .catch(() => {});
})();
