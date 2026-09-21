const { getPool } = require('../db.js');
const data = require('../array.js');
const { hashPassword } = require('../../security/runtime.js');
const { assertPasswordStorage } = require('../../security/password-storage.js');
const crypto = require('crypto');
const mailBrevo = require('./mailBrevo.js');
const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const { ensureSchema: ensureStripeSchema } = require('../stripeBilling.js');
const {
    CompanyLookupError,
    ensureSchema: ensureCompanySchema,
    lookupCompanyBySiret,
    normaliseSiret
} = require('../companyRegistry.js');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const LEGAL_VERSION = '2026-08-09';

module.exports = async function addUser(input, id) {
    let connexion;
    let createdUserId = null;
    let legalAcceptanceStored = true;
    try {
        const prenom = cleanText(input?.nom, 80);
        const nom = cleanText(input?.name, 80);
        const email = cleanText(input?.email, 254).toLowerCase();
        const password = typeof input?.password === 'string' ? input.password : '';
        const siret = normaliseSiret(input?.siret);
        const termsAccepted = input?.termsAccepted === true;
        const privacyAcknowledged = input?.privacyAcknowledged === true;
        const selectedOffer = Number(input?.offerId);
        const pendingOfferId = Number.isInteger(selectedOffer) && selectedOffer > 0 ? selectedOffer : null;
        if (!prenom || !nom || !emailPattern.test(email) || Array.from(password).length < 12 || password.length > 128 || siret.length !== 14) {
            const validationContext = { emailDomain: email.split('@')[1] || null };
            void serverLogger.warn('signup.validation_failed', 'Données d’inscription invalides.', validationContext, { socketId: id });
            void logError(null, 'inscription_validation', 'Données d’inscription invalides.', validationContext);
            return data.io.to(id).emit('ins error', 'Utilisez un e-mail valide et un mot de passe d’au moins 12 caractères.');
        }
        if (!termsAccepted || !privacyAcknowledged) {
            const legalContext = {
                termsAccepted,
                privacyAcknowledged,
                legalVersion: LEGAL_VERSION
            };
            void serverLogger.warn('signup.legal_acceptance_failed', 'Inscription refusée sans validation des documents légaux.', legalContext, { socketId: id });
            void logError(null, 'inscription_legal', 'Conditions d’utilisation ou politique de confidentialité non validées.', legalContext);
            return data.io.to(id).emit('ins error', 'Pour créer un compte, accepte les conditions d’utilisation et prends connaissance de la politique de confidentialité.');
        }

        let company;
        try {
            company = await lookupCompanyBySiret(siret);
        } catch (error) {
            if (error instanceof CompanyLookupError) return data.io.to(id).emit('ins error', error.message);
            throw error;
        }
        if (!company) return data.io.to(id).emit('ins error', 'Aucune entreprise trouvée pour ce SIRET.');

        const pool = await getPool();
        await ensureStripeSchema();
        await ensureCompanySchema();
        connexion = await pool.getConnection();
        await assertPasswordStorage(connexion);
        const hash = await hashPassword(password);
        const token = crypto.randomBytes(32).toString('hex');
        let result;
        try {
            result = await connexion.query(
                'INSERT INTO users (email, password, nom, siret, company_name, role, email_verified, terms_accepted_at, privacy_acknowledged_at, legal_version, verification_token, Token, abo, date_abo, pending_offer_id) VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, NULL, 1, DATE_ADD(CURRENT_DATE, INTERVAL 14 DAY), ?)',
                [email, hash, `${prenom} ${nom}`, siret, company.name, 'user', LEGAL_VERSION, token, pendingOfferId]
            );
        } catch (insertError) {
            const legalColumnMissing = insertError?.code === 'ER_BAD_FIELD_ERROR'
                && /terms_accepted_at|privacy_acknowledged_at|legal_version/i.test(insertError?.message || '');
            if (!legalColumnMissing) throw insertError;

            // La migration 008 doit être appliquée avant la production. Ce
            // repli évite de bloquer les inscriptions pendant une mise à jour
            // et conserve l’acceptation dans le journal serveur en attendant.
            legalAcceptanceStored = false;
            void serverLogger.error('signup.legal_migration_missing', 'Les colonnes de preuve légale manquent en base. Applique la migration 008.', {
                legalVersion: LEGAL_VERSION,
                code: insertError.code
            }, { socketId: id });
            result = await connexion.query(
                'INSERT INTO users (email, password, nom, siret, company_name, role, email_verified, verification_token, Token, abo, date_abo, pending_offer_id) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, 1, DATE_ADD(CURRENT_DATE, INTERVAL 14 DAY), ?)',
                [email, hash, `${prenom} ${nom}`, siret, company.name, 'user', token, pendingOfferId]
            );
        }
        createdUserId = Number(result?.insertId) || null;
        void serverLogger.info('signup.account_created', 'Compte créé, en attente de confirmation e-mail.', {
            emailDomain: email.split('@')[1] || null,
            trialDays: 14,
            pendingOfferId,
            companyName: company.name,
            legalVersion: LEGAL_VERSION,
            legalAcceptanceStored
        }, { userId: createdUserId, socketId: id });

        // L’envoi de l’e-mail est une étape secondaire. Il ne doit pas faire
        // croire à l’utilisatrice que son compte n’existe pas si Brevo échoue.
        if (connexion) {
            connexion.release();
            connexion = null;
        }
        try {
            await mailBrevo(email, `${prenom} ${nom}`, token);
            void serverLogger.info('signup.email_sent', 'E-mail de confirmation envoyé.', {
                emailDomain: email.split('@')[1] || null,
                trialDays: 14
            }, { userId: createdUserId, socketId: id });
            data.io.to(id).emit('ins confirme', { emailSent: true, trialDays: 14 });
        } catch (mailError) {
            const mailContext = {
                emailDomain: email.split('@')[1] || null,
                code: mailError?.code || mailError?.response?.statusCode || null,
                trialDays: 14
            };
            void serverLogger.error('signup.email_failed', 'Compte créé mais e-mail de confirmation non envoyé.', mailContext, {
                userId: createdUserId,
                socketId: id
            });
            if (createdUserId) {
                void logError(createdUserId, 'inscription_email', 'Compte créé mais e-mail de confirmation non envoyé.', mailContext);
            }
            data.io.to(id).emit('ins confirme', { emailSent: false, trialDays: 14 });
        }
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') {
            const duplicateContext = {
                emailDomain: cleanText(input?.email, 254).toLowerCase().split('@')[1] || null
            };
            void serverLogger.warn('signup.duplicate_email', 'Tentative d’inscription avec une adresse déjà utilisée.', duplicateContext, { socketId: id });
            void logError(null, 'inscription_duplicate', 'Adresse e-mail déjà utilisée.', duplicateContext);
            return data.io.to(id).emit('ins error', 'Cette adresse e-mail est déjà utilisée.');
        }
        void serverLogger.error('signup.failed', 'Erreur lors de la création du compte.', {
            code: error?.code || null,
            // SQL messages can contain credentials or verification tokens.
        }, { userId: createdUserId, socketId: id });
        if (createdUserId) {
            void logError(createdUserId, 'inscription', 'Erreur lors de la création du compte.', {
                code: error?.code || null
            });
        }
        data.io.to(id).emit('ins error', 'Impossible de créer le compte pour le moment.');
    } finally {
        if (connexion) connexion.release();
    }
};
