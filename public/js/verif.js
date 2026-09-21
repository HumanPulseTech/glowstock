const urlParams = new URLSearchParams(window.location.search)
const token = urlParams.get("token")

history.replaceState(null, '', window.location.pathname);
fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
    .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Validation impossible.');
        const offerId = Number(result.checkoutOfferId);
        window.location.assign(Number.isInteger(offerId) && offerId > 0 ? `/parametres/?checkout_offer=${encodeURIComponent(offerId)}` : '/dashboard/');
    }).catch(error => alert(error.message));
