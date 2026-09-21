const email = document.getElementById('email')
const password = document.getElementById('password')
const validation = document.getElementById('validation_form')

validation.addEventListener('click', async (e) => {
    e.preventDefault()
    const valeur = {
        email: email.value,
        password: password.value
    }

    if (validation.disabled) return;
    validation.disabled = true;
    try {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valeur) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Connexion impossible.');
        let destination = '/dashboard/';
        try {
            const status = await fetch('/api/caisse/status', { signal: AbortSignal.timeout(3000) });
            if (status.ok && (await status.json()).enabled) destination = '/dashboard/caisse/';
        } catch (_) { /* La caisse indisponible ne doit jamais bloquer la connexion. */ }
        window.location.assign(destination);
    } catch (error) { alert(error.message); }
    finally { validation.disabled = false; }
})
