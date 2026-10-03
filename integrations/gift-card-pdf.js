'use strict';

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { cardCode, day } = require('./gift-cards');

const euro = value => `${(Number(value) / 100).toFixed(2).replace('.', ',')} €`;
const date = value => value ? value.split('-').reverse().join('/') : '';
// Fixed local fonts only. No untrusted HTML, URLs, remote images or file paths.
function printable(value) {
    return String(value || '').replace(/[^\x20-\x7e\u00a0-\u00ff\u0152\u0153\u20ac]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
async function qrPng(code) {
    return QRCode.toBuffer(cardCode(code), { type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 384 });
}
async function cardPdf(card, issuer = {}) {
    const png = await qrPng(card.code);
    const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 24, info: { Title: 'Carte cadeau GlowStock', Author: 'GlowStock' } });
    const chunks = [];
    const ready = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    const width = doc.page.width, height = doc.page.height;
    doc.rect(0, 0, width, height).fill('#FAF8F4');
    doc.roundedRect(22, 22, width - 44, height - 44, 16).fill('#FFFFFF');
    doc.roundedRect(38, 42, 58, 4, 2).fill('#819582');
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#536A56').text('GLOWSTOCK', 38, 60);
    doc.font('Helvetica-Bold').fontSize(32).fillColor('#29352D').text('Un moment pour soi', 38, 84, { width: 510 });
    doc.font('Helvetica').fontSize(12).fillColor('#5F6963').text('CARTE CADEAU', 38, 127);
    const salon = printable(issuer.name) || 'À utiliser auprès de l’établissement émetteur';
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#29352D').text(salon, 38, 154, { width: 345, height: 34, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(40).text(euro(card.initial_cents), 38, 195, { width: 335 });
    doc.font('Helvetica').fontSize(11).fillColor('#5F6963').text('Valeur initiale', 40, 240);
    const status = { active: 'Carte active', disabled: 'CARTE DÉSACTIVÉE', expired: 'CARTE EXPIRÉE' }[card.effective_status || card.status] || 'Statut à vérifier';
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#29352D').text(status, 38, 269, { width: 350 });
    doc.font('Helvetica').fontSize(10).fillColor('#5F6963').text(`Solde au ${date(day())} : ${euro(card.balance_cents)}`, 38, 286);
    doc.text(card.expires_at ? `Valable jusqu’au ${date(card.expires_at)} inclus.` : 'Sans date de fin de validité.', 38, 302);
    doc.image(png, 401, 174, { width: 145, height: 145 });
    doc.font('Courier').fontSize(9).fillColor('#29352D').text(cardCode(card.code), 38, 329, { width: 512, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#5F6963').text('Présentez ce code au salon. Conservez-le à l’abri des regards.', 38, 349, { width: 512, align: 'center' });
    doc.text('Le solde est vérifié à chaque utilisation. Ce document n’est ni un reçu ni une facture.', 38, 363, { width: 512, align: 'center' });
    doc.end();
    return ready;
}

module.exports = { qrPng, cardPdf };
