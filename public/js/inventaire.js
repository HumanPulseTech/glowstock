const socket = window.glowstockSocket || (window.glowstockSocket = io())

let liste = document.getElementById('liste')
const exportButton = document.getElementById('export_inventory_csv')
const importButton = document.getElementById('import_inventory_csv')
const importFile = document.getElementById('import_inventory_file')
let inventory = []

socket.emit('liste inv')

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

socket.on('reponse liste inv', (resultat) => {
    inventory = Array.isArray(resultat) ? resultat : []
    liste.textContent = ''
    if (exportButton) exportButton.disabled = false
    inventory.forEach(element => {
        let newElement = document.createElement('tr')

        newElement.innerHTML = `
                  <td>
                    <div class="product-cell">
                        <div class="thumb"><div class="bottle" style="background:#d9b0b7"></div></div>
                    <div class="product-meta">
                        <strong>${escapeHtml(element.nom)}</strong>
                        <span>${escapeHtml(element.marque || 'Sans marque')}</span>
                    </div>
                </div>
                </td>
                <td class="mono">${escapeHtml(element.ref_fournisseur)}</td>
                <td class="mono">${escapeHtml(element.code_barres || '—')}</td>
                <td>${escapeHtml(element.categorie)}</td>
                <td class="stock-num">${escapeHtml(element.quantite)}</td>
                <td>${escapeHtml(element.seuil_alerte)}</td>
                <td><span class="badge ${element.suive_alertes && element.quantite <= element.seuil_alerte ? 'warning' : 'success'}">${element.suive_alertes && element.quantite <= element.seuil_alerte ? 'Stock bas' : 'OK'}</span></td>
        `

        liste.appendChild(newElement)
    });
})

const csvCell = (value) => {
    const text = String(value ?? '')
    const safe = /^[\s\u0000]*[=+@-]|^[\t\r\n\u0000]/.test(text) ? "'" + text : text
    return `"${safe.replace(/"/g, '""')}"`
}
const formatFileDate = () => new Date().toISOString().slice(0, 10)

exportButton?.addEventListener('click', () => {
    const headers = [
        'Produit',
        'Référence fournisseur',
        'Code-barres',
        'Marque',
        'Catégorie',
        'Stock théorique',
        'Seuil alerte',
        'Stock compté',
        'Écart',
        'Notes'
    ]
    const rows = inventory.map((product) => [
        product.nom,
        product.ref_fournisseur,
        product.code_barres || '',
        product.marque || '',
        product.categorie || '',
        product.quantite,
        product.seuil_alerte,
        '',
        '',
        ''
    ])
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `inventaire-glowstock-${formatFileDate()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
})

const normalizeHeader = (value) => String(value ?? '')
    .replace(/^\uFEFF/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('fr')
    .replace(/[_\s-]+/g, ' ')

const parseCsv = (text) => {
    const rows = []
    let row = []
    let cell = ''
    let quoted = false
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index]
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1 }
            else if (character === '"') quoted = false
            else cell += character
            continue
        }
        if (character === '"') quoted = true
        else if (character === ';' || character === ',') { row.push(cell.trim()); cell = '' }
        else if (character === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = '' }
        else if (character !== '\r') cell += character
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
    return rows.filter((row) => row.some((cell) => cell !== ''))
}

const parseCount = (value) => {
    const normalized = String(value ?? '').trim().replace(',', '.')
    return /^\d+$/.test(normalized) ? Number(normalized) : null
}

importButton?.addEventListener('click', () => importFile?.click())

importFile?.addEventListener('change', async () => {
    const file = importFile.files?.[0]
    importFile.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return alert('Le fichier CSV est trop volumineux (2 Mo maximum).')
    try {
        const rows = parseCsv(await file.text())
        const headers = rows.shift()?.map(normalizeHeader) || []
        const referenceIndex = headers.findIndex((header) => ['reference fournisseur', 'ref fournisseur', 'ref'].includes(header))
        const countedIndex = headers.findIndex((header) => ['stock compte', 'quantite comptee', 'quantite compte'].includes(header))
        if (referenceIndex < 0 || countedIndex < 0) return alert('Le CSV doit contenir les colonnes « Référence fournisseur » et « Stock compté ».')
        const entries = rows
            .map((row) => {
                const rawCount = row[countedIndex]?.trim() || ''
                return { reference: row[referenceIndex]?.trim() || '', rawCount, counted: parseCount(rawCount) }
            })
            .filter((entry) => entry.rawCount !== '')
        if (!entries.length) return alert('Aucun stock compté n’a été trouvé dans ce fichier.')
        if (entries.some((entry) => !entry.reference || entry.counted === null)) return alert('Chaque ligne à importer doit avoir une référence fournisseur et un stock compté entier.')
        if (!confirm(`Mettre à jour le stock de ${entries.length} produit(s) avec ce comptage ?`)) return
        importButton.disabled = true
        importButton.textContent = 'Import en cours…'
        socket.emit('import inventory count', { rows: entries })
    } catch (_) {
        alert('Impossible de lire ce fichier CSV.')
    }
})

const resetImportButton = () => {
    if (!importButton) return
    importButton.disabled = false
    importButton.textContent = 'Importer'
}

socket.on('inventory import success', (result = {}) => {
    resetImportButton()
    const missing = Number(result.missingCount) || 0
    const details = missing ? ` ${missing} référence(s) introuvable(s) n’ont pas été modifiée(s).` : ''
    alert(`${Number(result.updated) || 0} stock(s) mis à jour.${details}`)
    socket.emit('liste inv')
})

socket.on('inventory import error', (message) => {
    resetImportButton()
    alert(message || 'Impossible d’importer le comptage.')
})

socket.on('auth error', () => window.location.assign('/connexion/'));
socket.on('subscription blocked', (level) => window.location.assign(`/abonnement-expire/?mode=${level === 'limited' ? 'limite' : 'expire'}`));

socket.on('inventaire stats', (stats) => {
    document.getElementById('stat_total').innerText = stats.total
    document.getElementById('stat_marques').innerText = stats.marques
    document.getElementById('stat_bas').innerText = stats.bas
    document.getElementById('stat_alertes_off').innerText = stats.alertesDesactivees
})
