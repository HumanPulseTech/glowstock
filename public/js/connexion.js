const socket = window.glowstockSocket || (window.glowstockSocket = io());

const email = document.getElementById('email')
const password = document.getElementById('password')
const validation = document.getElementById('validation_form')

validation.addEventListener('click', async (e) => {
    e.preventDefault()
    const valeur = {
        email: email.value,
        password: password.value
    }

    socket.emit("connection", valeur)
})

socket.on('connection ac', () => {
    window.location = "/dashboard/"
})

socket.on('auth error', (message) => alert(message));
