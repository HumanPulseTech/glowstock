const socket = window.glowstockSocket || (window.glowstockSocket = io())

const valid = document.getElementById('valid')
const form = valid?.closest('form')
const siretInput = document.getElementById('siret')
const companyNameInput = document.getElementById('company_name')
const siretStatus = document.getElementById('siret_status')
let submitting = false
let companyLookupController = null
let selectedCompany = null

const normaliseSiret = (value) => String(value || '').replace(/\D/g, '').slice(0, 14)
const formatSiret = (value) => {
    const siret = normaliseSiret(value)
    return [siret.slice(0, 3), siret.slice(3, 6), siret.slice(6, 9), siret.slice(9, 14)].filter(Boolean).join(' ')
}
const isValidSiret = (value) => {
    const siret = normaliseSiret(value)
    if (!/^\d{14}$/.test(siret) || /^0{14}$/.test(siret)) return false
    return [...siret].reverse().reduce((sum, character, index) => {
        let digit = Number(character)
        if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2
        return sum + digit
    }, 0) % 10 === 0
}

const showSiretStatus = (text = '', state = '') => {
    if (!siretStatus) return
    siretStatus.hidden = !text
    siretStatus.textContent = text
    siretStatus.dataset.state = state
}

const resetSelectedCompany = () => {
    selectedCompany = null
    if (companyNameInput) companyNameInput.value = ''
}

async function lookupCompany() {
    if (!siretInput) return
    const siret = normaliseSiret(siretInput.value)
    resetSelectedCompany()
    if (companyLookupController) companyLookupController.abort()

    if (!siret) return showSiretStatus()
    if (siret.length < 14) return showSiretStatus(`Encore ${14 - siret.length} chiffre${14 - siret.length > 1 ? 's' : ''} pour rechercher votre entreprise.`)
    if (!isValidSiret(siret)) return showSiretStatus('Ce SIRET ne semble pas valide. Vérifiez les 14 chiffres.', 'error')

    const controller = new AbortController()
    companyLookupController = controller
    showSiretStatus('Recherche de votre entreprise…')
    try {
        const response = await fetch(`/api/company-by-siret?siret=${encodeURIComponent(siret)}`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal: controller.signal
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.company) throw new Error(data.error || 'Aucune entreprise trouvée pour ce SIRET.')
        if (normaliseSiret(siretInput.value) !== siret) return

        selectedCompany = data.company
        if (companyNameInput) companyNameInput.value = data.company.name || ''
        const address = data.company.address ? ` — ${data.company.address}` : ''
        showSiretStatus(`Société sélectionnée : ${data.company.name}${address}`)
    } catch (error) {
        if (error.name === 'AbortError') return
        resetSelectedCompany()
        showSiretStatus(error.message || 'La recherche de l’entreprise est impossible pour le moment.', 'error')
    } finally {
        if (companyLookupController === controller) companyLookupController = null
    }
}

if (siretInput) {
    siretInput.addEventListener('input', () => {
        const formatted = formatSiret(siretInput.value)
        if (siretInput.value !== formatted) siretInput.value = formatted
        void lookupCompany()
    })
}

if (!valid) {
    console.warn('Formulaire d’inscription introuvable.')
} else {
    const submitSignup = (event) => {
        event.preventDefault()
        if (submitting) return

        const nom = document.getElementById('firstname')
        const name = document.getElementById('lastname')
        const email = document.getElementById('email')
        const password = document.getElementById('password')
        const confirm = document.getElementById('confirm')
        const siret = document.getElementById('siret')
        const terms = document.getElementById('terms_accepted')
        const privacy = document.getElementById('privacy_acknowledged')
        if (!nom || !name || !email || !password || !confirm || !siret || !terms || !privacy) {
            return alert('Le formulaire d’inscription est incomplet. Recharge la page puis réessaie.')
        }
        if (password.value !== confirm.value) {
            return alert('Les mots de passe ne correspondent pas.')
        }
        if (!selectedCompany || !isValidSiret(siret.value)) {
            return alert('Saisissez un SIRET valide et attendez la sélection de votre entreprise.')
        }
        if (!terms.checked || !privacy.checked) {
            return alert('Pour créer ton compte, accepte les conditions d’utilisation et prends connaissance de la politique de confidentialité.')
        }

        const new_user = {
            nom: nom.value,
            name: name.value,
            email: email.value,
            password: password.value,
            siret: normaliseSiret(siret.value),
            companyName: selectedCompany.name,
            termsAccepted: terms.checked,
            privacyAcknowledged: privacy.checked,
            offerId: (() => {
                const value = Number(new URLSearchParams(window.location.search).get('offer'))
                return Number.isInteger(value) && value > 0 ? value : null
            })()
        }

        submitting = true
        valid.disabled = true
        valid.setAttribute('aria-busy', 'true')
        socket.emit('inscription', new_user)
    }

    if (form) form.addEventListener('submit', submitSignup)
    else valid.addEventListener('click', submitSignup)
}

socket.on('ins confirme', (result = {}) => {
    const suffix = result.emailSent === false ? '?mail=failed' : ''
    window.location = `/ins/confirme${suffix}`
})

socket.on('ins error', (message) => {
    submitting = false
    if (valid) {
        valid.disabled = false
        valid.removeAttribute('aria-busy')
    }
    alert(message)
})
