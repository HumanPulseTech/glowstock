const socket = window.glowstockSocket || (window.glowstockSocket = io());
const saveButton = document.getElementById('enregistrer_produit');
let saving = false;

const params = new URLSearchParams(window.location.search);
const scannedBarcode = params.get('barcode') || params.get('code_barres');
const scannedReference = params.get('reference');
if (scannedBarcode) document.getElementById('code_barres').value = scannedBarcode.slice(0, 100);
else if (scannedReference) document.getElementById('reference').value = scannedReference.slice(0, 100);

socket.emit('liste marques');
socket.on('marques disponibles', (brands = []) => {
    const datalist = document.getElementById('marques_suggestions');
    if (!datalist) return;
    datalist.innerHTML = brands.map((brand) => `<option value="${String(brand).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]))}"></option>`).join('');
});
socket.on('marques error', (message) => {
    // Les suggestions restent facultatives : la saisie libre reste disponible.
    console.warn(message || 'Suggestions de marques indisponibles.');
});

function updateProductPreview() {
    const read = (id) => document.getElementById(id)?.value.trim() || '';
    const previewName = document.getElementById('preview_nom');
    const previewReference = document.querySelector('.preview-title span');
    const previewBrand = document.getElementById('preview_marque');
    const previewCategory = document.getElementById('preview_categorie');
    const previewValues = document.querySelectorAll('.preview-meta .meta-box strong');
    const previewStockPill = document.querySelector('.summary-card .pill');
    const previewStockMessage = document.querySelector('.summary-card .pill')?.nextElementSibling;
    const name = read('nom');
    const reference = read('reference');
    const brand = read('marque');
    const category = read('categorie');
    const quantity = Math.max(0, Number(read('quantite')) || 0);
    const threshold = Math.max(0, Number(read('seuil')) || 0);
    if (previewName) previewName.textContent = name || 'Nom du produit';
    if (previewReference) previewReference.textContent = `Réf. ${reference || '—'}`;
    if (previewBrand) previewBrand.textContent = brand || 'Sans marque';
    if (previewCategory) previewCategory.textContent = category || 'Sans catégorie';
    if (previewValues[2]) previewValues[2].textContent = `${quantity} ${quantity > 1 ? 'unités' : 'unité'}`;
    if (previewValues[3]) previewValues[3].textContent = `${threshold} ${threshold > 1 ? 'unités' : 'unité'}`;
    if (previewStockPill) {
        const lowStock = quantity <= threshold;
        previewStockPill.classList.toggle('warning', lowStock);
        previewStockPill.classList.toggle('success', !lowStock);
        previewStockPill.textContent = quantity === 0 ? 'Stock initial vide' : (lowStock ? 'Stock sous le seuil' : 'Stock disponible');
    }
    if (previewStockMessage) previewStockMessage.textContent = quantity === 0
        ? 'Le produit peut être créé avant réception, puis alimenté via un mouvement d’entrée plus tard.'
        : (quantity <= threshold ? 'La quantité saisie déclenchera une alerte de stock faible.' : 'La quantité saisie est au-dessus du seuil d’alerte.');
}

['nom', 'reference', 'marque', 'categorie', 'quantite', 'seuil'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateProductPreview);
    document.getElementById(id)?.addEventListener('change', updateProductPreview);
});
updateProductPreview();

if (saveButton) saveButton.addEventListener('click', () => {
    if (saving) return;
    saving = true;
    saveButton.disabled = true;
    saveButton.setAttribute('aria-busy', 'true');
    saveButton.dataset.defaultLabel = saveButton.textContent;
    saveButton.textContent = 'Enregistrement…';
    socket.emit('ajout produit', {
        nom: document.getElementById('nom').value,
        reference: document.getElementById('reference').value,
        codeBarres: document.getElementById('code_barres').value,
        marque: document.getElementById('marque').value,
        categorie: document.getElementById('categorie').value,
        description: document.getElementById('description').value,
        quantite: document.getElementById('quantite').value,
        prix: document.getElementById('prix').value,
        seuil: document.getElementById('seuil').value,
        alertes: document.getElementById('alertes').checked
    });
});

socket.on('produit ajoute', () => window.location.assign('/dashboard/inv/'));
socket.on('produit error', (message) => {
    saving = false;
    if (saveButton) {
        saveButton.disabled = false;
        saveButton.removeAttribute('aria-busy');
        saveButton.textContent = saveButton.dataset.defaultLabel || 'Enregistrer le produit';
    }
    alert(message);
});
socket.on('auth error', () => window.location.assign('/connexion/'));
socket.on('subscription blocked', (level) => window.location.assign(`/abonnement-expire/?mode=${level === 'limited' ? 'limite' : 'expire'}`));
