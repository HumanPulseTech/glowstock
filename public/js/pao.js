const socket = window.glowstockSocket || (window.glowstockSocket = io());
const table = document.getElementById('liste');
const modal = document.getElementById('pao_modal');
const form = document.getElementById('pao_form');
const productSelect = document.getElementById('pao_produit');
const productSearch = document.getElementById('pao_produit_recherche');
const productResults = document.getElementById('pao_resultats');
const startInput = document.getElementById('pao_debut');
const durationInput = document.getElementById('pao_duree');
const message = document.getElementById('pao_message');
let produits = [];
let submitTimer;
let selectedProduct = null;
let submissionPending = false;
const submitButton = form.querySelector('button[type="submit"]');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const formatDate = (value) => value ? new Intl.DateTimeFormat('fr-FR').format(new Date(value)) : '—';
const today = () => new Date().toISOString().slice(0, 10);
const showMessage = (text) => { message.textContent = text; message.classList.add('is-visible'); };
const clearMessage = () => { message.textContent = ''; message.classList.remove('is-visible'); };

function paoState(pao) {
    const now = new Date();
    const start = new Date(pao.dStart);
    const end = new Date(pao.dFin);
    end.setHours(23, 59, 59, 999);
    if (!pao.active || now > end) return { order: 0, label: 'Périmée', className: 'danger' };
    const progress = (now - start) / (end - start);
    if (progress >= 0.75) return { order: 1, label: 'À surveiller', className: 'warning' };
    return { order: 2, label: 'En cours', className: 'success' };
}

function closeModal() { clearTimeout(submitTimer); modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true'); }
function selectProduct(produit) { selectedProduct = produit; productSelect.value = produit.id; productSearch.value = `${produit.nom} — ${produit.ref_fournisseur}`; productResults.hidden = true; }
function renderResults() {
    const query = productSearch.value.trim().toLocaleLowerCase('fr');
    const matches = produits.filter((produit) => `${produit.nom} ${produit.ref_fournisseur} ${produit.code_barres || ''}`.toLocaleLowerCase('fr').includes(query)).slice(0, 8);
    productResults.replaceChildren();
    if (!matches.length) {
        const empty = document.createElement('div'); empty.className = 'product-empty'; empty.textContent = 'Aucun produit trouvé.'; productResults.appendChild(empty);
    } else matches.forEach((produit) => {
        const button = document.createElement('button'); const label = document.createElement('strong'); const reference = document.createElement('small');
        button.type = 'button'; button.className = 'product-result'; button.setAttribute('role', 'option'); label.textContent = produit.nom; reference.textContent = [produit.ref_fournisseur, produit.code_barres].filter(Boolean).join(' · ');
        button.append(label, reference); button.addEventListener('click', () => selectProduct(produit)); productResults.appendChild(button);
    });
    productResults.hidden = false;
}
function openModal() {
    if (!produits.length) return alert('Ajoute d’abord un produit à ton inventaire.');
    form.reset(); productSelect.value = ''; selectedProduct = null; startInput.value = today(); clearMessage(); modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false'); productSearch.focus(); renderResults();
}

socket.emit('liste pao');
socket.on('reponse liste pao', (data) => {
    produits = data.produits; table.replaceChildren();
    const requestedProductId = Number(new URLSearchParams(window.location.search).get('produit'));
    const requestedProduct = Number.isInteger(requestedProductId) ? produits.find((produit) => Number(produit.id) === requestedProductId) : null;
    if (requestedProduct) { openModal(); selectProduct(requestedProduct); }
    if (!data.paos.length) { const row = document.createElement('tr'); row.innerHTML = '<td colspan="6">Aucune PAO enregistrée.</td>'; table.appendChild(row); return; }
    data.paos.map((pao) => ({ pao, state: paoState(pao) })).sort((a, b) => a.state.order - b.state.order || new Date(a.pao.dFin) - new Date(b.pao.dFin)).forEach(({ pao, state }) => {
        const row = document.createElement('tr'); row.className = `pao-row ${state.className}`; const status = `<span class="badge ${state.className}">${state.label}</span>`;
        row.innerHTML = `<td><strong>${escapeHtml(pao.nom)}</strong></td><td class="mono">${escapeHtml(pao.ref_fournisseur)}</td><td>${formatDate(pao.dStart)}</td><td>${formatDate(pao.dFin)}</td><td class="mono">${escapeHtml(pao.ref)}</td><td>${status}</td>`; table.appendChild(row);
    });
});

document.getElementById('add_pao').addEventListener('click', openModal);
document.getElementById('fermer_pao').addEventListener('click', closeModal);
document.getElementById('annuler_pao').addEventListener('click', closeModal);
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
productSearch.addEventListener('input', () => { productSelect.value = ''; selectedProduct = null; renderResults(); });
productSearch.addEventListener('focus', renderResults);
productSearch.addEventListener('blur', () => setTimeout(() => { productResults.hidden = true; }, 150));
function unlockSubmission() {
    submissionPending = false;
    if (submitButton) submitButton.disabled = false;
}

function finishSubmission() {
    clearTimeout(submitTimer);
    unlockSubmission();
    closeModal();
    socket.emit('liste pao');
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submissionPending) return;
    const search = productSearch.value.trim().toLocaleLowerCase('fr');
    const typedProduct = produits.find((produit) => produit.nom.toLocaleLowerCase('fr') === search || produit.ref_fournisseur.toLocaleLowerCase('fr') === search || (produit.code_barres && produit.code_barres.toLocaleLowerCase('fr') === search) || `${produit.nom} — ${produit.ref_fournisseur}`.toLocaleLowerCase('fr') === search);
    const produit = selectedProduct || typedProduct || produits.find((item) => String(item.id) === productSelect.value);
    if (!produit) return showMessage('Choisis un produit dans les suggestions, ou saisis son nom ou sa référence exacte.');
    submissionPending = true;
    if (submitButton) submitButton.disabled = true;
    clearMessage(); submitTimer = setTimeout(() => { unlockSubmission(); showMessage('Le serveur ne répond pas. Vérifie qu’il a bien été redémarré.'); }, 5000);
    socket.emit('ajout pao', { produitId: produit.id, ref: document.getElementById('pao_ref').value, dateStart: startInput.value, durationMonths: durationInput.value }, (result) => {
        if (result?.ok) { if (submissionPending) finishSubmission(); return; }
        if (!submissionPending) return;
        clearTimeout(submitTimer); unlockSubmission(); showMessage('La PAO n’a pas pu être enregistrée.');
    });
});
socket.on('pao ajoute', () => { if (submissionPending) finishSubmission(); });
socket.on('pao error', (error) => { if (!submissionPending) return; clearTimeout(submitTimer); unlockSubmission(); showMessage(error); });
socket.on('auth error', () => window.location.assign('/connexion/'));
socket.on('subscription blocked', (level) => window.location.assign(`/abonnement-expire/?mode=${level === 'limited' ? 'limite' : 'expire'}`));
