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
                <td>${element.prix_centimes == null ? 'Non renseigné' : escapeHtml((Number(element.prix_centimes) / 100).toFixed(2).replace('.', ',') + ' €')}</td>
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

const initialImportButton = document.getElementById('start_stock_import')
const initialImportFile = document.getElementById('initial_stock_file')
const importDialog = document.getElementById('stock_import_dialog')
const importMapping = document.getElementById('stock_import_mapping')
const importFields = document.getElementById('stock_import_fields')
const importSample = document.getElementById('stock_import_sample')
const importReport = document.getElementById('stock_import_report')
const analyzeImportButton = document.getElementById('stock_import_analyze')
const commitImportButton = document.getElementById('stock_import_commit')
const importIntro = document.getElementById('stock_import_intro')
let pendingStockImport = null

const importFieldLabels = {
    reference: 'Référence fournisseur *', name: 'Nom du produit *', category: 'Catégorie', supplier: 'Fournisseur / marque',
    purchasePrice: 'Prix d’achat', salePrice: 'Prix de vente', quantity: 'Quantité initiale *', threshold: 'Seuil d’alerte', barcode: 'Code-barres'
}
const requestJson = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'same-origin', ...options })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Une erreur est survenue.')
    return payload
}
const clearNode = (node) => { while (node?.firstChild) node.removeChild(node.firstChild) }
const addText = (parent, tag, text) => { const child = document.createElement(tag); child.textContent = String(text ?? ''); parent.appendChild(child); return child }
const setImportReport = (message, error = false) => {
    clearNode(importReport); importReport.hidden = !message; importReport.classList.toggle('error', error)
    if (message) addText(importReport, 'p', message)
}
const setImportBusy = (button, busy, label) => { button.disabled = busy; button.textContent = busy ? 'Traitement…' : label }
const renderSample = (headers, rows) => {
    clearNode(importSample); const table = document.createElement('table'); const head = document.createElement('thead'); const headRow = document.createElement('tr')
    headers.forEach((value) => addText(headRow, 'th', value || 'Colonne sans nom')); head.appendChild(headRow); table.appendChild(head)
    const body = document.createElement('tbody'); rows.forEach((row) => { const tr = document.createElement('tr'); headers.forEach((_, index) => addText(tr, 'td', row[index] || '—')); body.appendChild(tr) }); table.appendChild(body); importSample.appendChild(table)
}
const renderMapping = (headers, suggested) => {
    clearNode(importFields)
    Object.entries(importFieldLabels).forEach(([field, label]) => {
        const labelNode = document.createElement('label'); labelNode.htmlFor = `stock_import_${field}`; addText(labelNode, 'span', label)
        const select = document.createElement('select'); select.id = `stock_import_${field}`; select.dataset.stockImportField = field
        const ignored = document.createElement('option'); ignored.value = '-1'; ignored.textContent = 'Ne pas importer'; select.appendChild(ignored)
        headers.forEach((column, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = column || `Colonne ${index + 1}`; if (suggested[field] === index) option.selected = true; select.appendChild(option) })
        labelNode.appendChild(select); importFields.appendChild(labelNode)
    })
}
const selectedMapping = () => Object.fromEntries([...importFields.querySelectorAll('[data-stock-import-field]')].map((input) => [input.dataset.stockImportField, Number(input.value)]))

initialImportButton?.addEventListener('click', () => initialImportFile?.click())
initialImportFile?.addEventListener('change', async () => {
    const file = initialImportFile.files?.[0]; initialImportFile.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return alert('Le fichier doit peser au maximum 5 Mo.')
    if (!/\.(csv|xlsx)$/i.test(file.name)) return alert('Choisis un fichier CSV ou XLSX.')
    try {
        initialImportButton.disabled = true; initialImportButton.textContent = 'Lecture du fichier…'
        const preview = await requestJson('/api/inventory/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Import-Filename': file.name }, body: await file.arrayBuffer() })
        pendingStockImport = preview.importId; importIntro.textContent = `${preview.rowCount} ligne(s) détectée(s). Vérifie les correspondances avant de lancer l’analyse.`
        renderMapping(preview.headers, preview.recommendedMapping); renderSample(preview.headers, preview.sample); importMapping.hidden = false; importReport.hidden = true; analyzeImportButton.hidden = false; commitImportButton.hidden = true
        importDialog.showModal()
    } catch (error) { alert(error.message || 'Impossible de préparer le fichier.') }
    finally { initialImportButton.disabled = false; initialImportButton.textContent = 'Importer un ancien stock' }
})
analyzeImportButton?.addEventListener('click', async () => {
    if (!pendingStockImport) return
    try {
        setImportBusy(analyzeImportButton, true, 'Analyser l’import'); commitImportButton.hidden = true
        const report = await requestJson(`/api/inventory/imports/${encodeURIComponent(pendingStockImport)}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping: selectedMapping() }) })
        const summary = `${report.valid} ligne(s) valides, ${report.existing} produit(s) déjà présents, ${report.invalid} erreur(s), ${report.barcodeConflicts} conflit(s) de code-barres.`
        setImportReport(summary, report.invalid > 0 || report.barcodeConflicts > 0)
        if (report.errors?.length) { const list = document.createElement('ul'); report.errors.slice(0, 10).forEach((entry) => addText(list, 'li', `Ligne ${entry.row} : ${entry.message}`)); importReport.appendChild(list) }
        if (!report.invalid && !report.barcodeConflicts) {
            const strategy = document.createElement('div'); strategy.className = 'stock-import-strategy'; addText(strategy, 'strong', 'Produits déjà présents :')
            [['add_quantity', 'Ajouter la quantité importée au stock actuel'], ['update_and_add', 'Mettre à jour les informations puis ajouter la quantité'], ['skip', 'Ignorer ces produits']].forEach(([value, label]) => { const option = document.createElement('label'); const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'stock_import_strategy'; radio.value = value; if (value === 'add_quantity') radio.checked = true; option.append(radio, document.createTextNode(label)); strategy.appendChild(option) })
            importReport.appendChild(strategy); commitImportButton.hidden = false
        }
    } catch (error) { setImportReport(error.message || 'Analyse impossible.', true) }
    finally { setImportBusy(analyzeImportButton, false, 'Analyser l’import') }
})
commitImportButton?.addEventListener('click', async () => {
    if (!pendingStockImport) return
    const strategy = document.querySelector('input[name="stock_import_strategy"]:checked')?.value
    if (!strategy) return setImportReport('Choisis le traitement des produits déjà présents.', true)
    try {
        setImportBusy(commitImportButton, true, 'Valider l’import')
        const result = await requestJson(`/api/inventory/imports/${encodeURIComponent(pendingStockImport)}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy }) })
        importDialog.close(); pendingStockImport = null; socket.emit('liste inv'); alert(`Import terminé : ${result.created} créé(s), ${result.updated} mis à jour, ${result.skipped} ignoré(s).`)
    } catch (error) { setImportReport(error.message || 'Validation impossible.', true) }
    finally { setImportBusy(commitImportButton, false, 'Valider l’import') }
})

socket.on('auth error', () => window.location.assign('/connexion/'));
socket.on('subscription blocked', (level) => window.location.assign(`/abonnement-expire/?mode=${level === 'limited' ? 'limite' : 'expire'}`));

socket.on('inventaire stats', (stats) => {
    document.getElementById('stat_total').innerText = stats.total
    document.getElementById('stat_marques').innerText = stats.marques
    document.getElementById('stat_bas').innerText = stats.bas
    document.getElementById('stat_alertes_off').innerText = stats.alertesDesactivees
})
