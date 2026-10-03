'use strict';

const express = require('express');
const gifts = require('./gift-cards');
const { qrPng, cardPdf } = require('./gift-card-pdf');

// Mounted only after loyalty's session, current permissions, subscription,
// same-origin checks and rate limiter. No public balance oracle or bearer URL.
function createGiftCardRouter(deps) {
    const router = express.Router();
    const wrap = fn => async (req, res, next) => {
        try { await fn(req, res, await deps.getPool(), req.loyaltyUserId); }
        catch (error) { next(error); }
    };
    router.post('/gift-cards', wrap(async (req, res, pool, userId) => {
        const result = await gifts.issueCard(pool, userId, req.body);
        res.status(result.replayed ? 200 : 201).json(result);
    }));
    router.post('/gift-cards/lookup', wrap(async (req, res, pool, userId) => {
        res.json(await gifts.lookupCard(pool, userId, req.body?.code));
    }));
    router.post('/gift-cards/expire', wrap(async (req, res, pool, userId) => {
        res.json(await gifts.expireCards(pool, userId));
    }));
    router.get('/gift-cards/:id', wrap(async (req, res, pool, userId) => {
        res.json(await gifts.getCard(pool, userId, req.params.id, req.query.before));
    }));
    router.post('/gift-cards/:id/disable', wrap(async (req, res, pool, userId) => {
        res.json(await gifts.disableCard(pool, userId, req.params.id, req.body));
    }));
    router.get('/gift-cards/:id/qr', wrap(async (req, res, pool, userId) => {
        const { card } = await gifts.getCard(pool, userId, req.params.id);
        res.type('png').send(await qrPng(card.code));
    }));
    router.get('/gift-cards/:id/pdf', wrap(async (req, res, pool, userId) => {
        const { card } = await gifts.getCard(pool, userId, req.params.id);
        let issuer = {};
        try {
            // Reuse the existing business profile; no second copy to maintain.
            const [profile] = await pool.query('SELECT legal_name FROM invoice_company_profiles WHERE id_user=?', [userId]);
            issuer = { name: profile?.legal_name };
        } catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
        const pdf = await cardPdf(card, issuer);
        res.set('Content-Disposition', `attachment; filename="carte-cadeau-${card.id}.pdf"`).type('pdf').send(pdf);
    }));
    return router;
}

module.exports = { createGiftCardRouter };
