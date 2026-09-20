const socket = window.glowstockSocket || (window.glowstockSocket = io())

const urlParams = new URLSearchParams(window.location.search)
const token = urlParams.get("token")

socket.emit('valid mail', token)

socket.on('connection ac', (result = {}) => {
    const offerId = Number(result.checkoutOfferId);
    window.location = Number.isInteger(offerId) && offerId > 0
        ? `/parametres/?checkout_offer=${encodeURIComponent(offerId)}`
        : "/dashboard/"
})

socket.on('verification error', (message) => alert(message));
