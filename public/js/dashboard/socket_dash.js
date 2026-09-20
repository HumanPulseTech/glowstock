import socket from './socket.js'

const table_ps = document.getElementById('table_ps')
const add_art = document.getElementById('add_art')
const quickRestockForm = document.getElementById('quick_restock_form')
const quickRestockReference = document.getElementById('quick_restock_reference')
const quickRestockQuantity = document.getElementById('quick_restock_quantity')
const quickRestockMessage = document.getElementById('quick_restock_message')
const setupTitle = document.querySelector('.welcome h3')
const setupDescription = document.querySelector('.welcome p')
const setupProductsAction = document.querySelector('[data-setup-products]')
const setupAlertsAction = document.querySelector('[data-setup-alerts]')

const setQuickRestockMessage = (message, isError = false) => {
    if (!quickRestockMessage) return
    quickRestockMessage.textContent = message
    quickRestockMessage.classList.toggle('is-error', isError)
}

const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count > 1 ? pluralForm : singular}`

function renderSetupStep(name, { label, status = '', done = false }) {
    const step = document.querySelector(`[data-setup-step="${name}"]`)
    if (!step) return
    step.classList.toggle('done', done)
    const labelElement = step.querySelector('[data-setup-label]')
    const statusElement = step.querySelector('[data-setup-status]')
    if (labelElement) labelElement.textContent = label
    if (statusElement) {
        statusElement.hidden = !status
        statusElement.textContent = status
    }
}

function renderDashboardSetup(setup = {}) {
    const productCount = Math.max(0, Number(setup.productCount) || 0)
    const alertsPending = Math.max(0, Number(setup.alertsPending) || 0)
    const canManageProducts = setup.canManageProducts === true
    const hasProducts = productCount > 0
    const alertsReady = hasProducts && alertsPending === 0

    renderSetupStep('account', { label: 'Premier compte créé', status: '✓', done: true })
    renderSetupStep('products', {
        label: hasProducts ? 'Produits ajoutés' : 'Ajoutez votre premier produit',
        status: hasProducts ? plural(productCount, 'produit') : (canManageProducts ? '' : 'Accès requis'),
        done: hasProducts
    })
    if (setupProductsAction) setupProductsAction.hidden = hasProducts || !canManageProducts

    if (!hasProducts) {
        renderSetupStep('alerts', { label: 'Alertes de stock', status: 'Ajoutez d’abord un produit', done: false })
        if (setupAlertsAction) setupAlertsAction.hidden = true
    } else if (alertsReady) {
        renderSetupStep('alerts', { label: 'Alertes de stock activées', status: '✓', done: true })
        if (setupAlertsAction) setupAlertsAction.hidden = true
    } else {
        renderSetupStep('alerts', {
            label: 'Alertes de stock',
            status: `${plural(alertsPending, 'produit')} restant${alertsPending > 1 ? 's' : ''}`,
            done: false
        })
        if (setupAlertsAction) {
            setupAlertsAction.hidden = !canManageProducts
            setupAlertsAction.disabled = false
            setupAlertsAction.textContent = 'Activer'
        }
    }

    if (setupTitle) setupTitle.textContent = alertsReady ? 'Votre espace est prêt.' : 'Votre espace prend forme.'
    if (setupDescription) setupDescription.textContent = alertsReady
        ? 'Vos produits sont suivis et les alertes de stock sont actives.'
        : 'Terminez ces quelques étapes pour obtenir un suivi de stock fiable au quotidien.'
}

socket.emit("information user")

socket.on('reponse information user', (inf) => {
    const bv = document.getElementById('bv_user')

    bv.innerText = `Bonjour ${inf.nom} ✨`
})

socket.on('charge information', (inf) => {
    document.getElementById('val_stock').innerText = inf
})

socket.on('dashboard stats', (stats) => {
    document.getElementById('val_stock_faible').innerText = stats.lowStock
})

socket.on('dashboard setup', renderDashboardSetup)

socket.emit('produit a surveiller')

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

socket.on('rep produit a surveiller', (liste) => {
    table_ps.textContent = ''
    liste.forEach(element => {

        let etat = ""

        if (element.quantite === 0) {
            etat = `<span class="badge danger">Rupture</span>`
        } else {
            etat = '<span class="badge warning">Stock Bas</span>'
        }

        let newEl = document.createElement('tr')
        newEl.innerHTML = `    <td>
        <div class="product-cell">
            <span class="swatch" style="background:#d97777"></span>
            <div>
            <div>${escapeHtml(element.nom)}</div>
                <div class="mono">${escapeHtml(element.marque || 'Sans marque')}</div>
            </div>
        </div>
    </td>
    <td class="mono">${escapeHtml(element.ref_fournisseur)}</td>
        <td>${escapeHtml(element.quantite)}</td>
    <td>${etat}</td>`

    table_ps.appendChild(newEl)
    });
})

quickRestockForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    const reference = quickRestockReference?.value.trim()
    const quantity = Number(quickRestockQuantity?.value)
    if (!reference) return setQuickRestockMessage('Saisis une référence fournisseur.', true)
    add_art.disabled = true
    setQuickRestockMessage('Mise à jour du stock…')
    socket.emit('quick restock', { reference, quantity })
})

socket.on('stock restock success', (result) => {
    add_art.disabled = false
    if (quickRestockReference) quickRestockReference.value = ''
    setQuickRestockMessage(`${result.name} : +${result.quantityAdded} ajouté(s). Stock actuel : ${result.newQuantity}.`)
    socket.emit('information user')
    socket.emit('produit a surveiller')
})

socket.on('stock restock error', (message) => {
    add_art.disabled = false
    setQuickRestockMessage(message || 'Impossible de mettre le stock à jour.', true)
})

setupAlertsAction?.addEventListener('click', () => {
    if (setupAlertsAction.disabled) return
    setupAlertsAction.disabled = true
    setupAlertsAction.textContent = 'Activation…'
    socket.emit('activate stock alerts')
})

socket.on('dashboard setup updated', () => {
    socket.emit('information user')
    socket.emit('produit a surveiller')
})

socket.on('dashboard setup error', (message) => {
    if (setupAlertsAction) {
        setupAlertsAction.disabled = false
        setupAlertsAction.textContent = 'Activer'
    }
    window.alert(message || 'Impossible de mettre à jour la configuration.')
})

socket.on('auth error', () => window.location.assign('/connexion/'));
socket.on('subscription blocked', (level) => window.location.assign(`/abonnement-expire/?mode=${level === 'limited' ? 'limite' : 'expire'}`));
