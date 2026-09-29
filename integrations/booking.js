const express = require('express');
const crypto = require('node:crypto');
const { BrevoClient, BrevoEnvironment } = require('@getbrevo/brevo');
const { InputError } = require('./crm-data');
const { dayOfWeekFor, getBusinessHours, minutesFor, normaliseTime, valueToDate } = require('../Miku/planning');
const slugFor = value => { const slug = String(value || '').trim().toLowerCase(); if (!/^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/.test(slug)) throw new InputError('Choisis une adresse de 3 à 80 caractères : lettres, chiffres et tirets.'); return slug; };
const idFor = value => { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1) throw new InputError('Identifiant invalide.'); return id; };
const clean = (value, max, required = false) => { const text = typeof value === 'string' ? value.trim() : ''; if (text.length > max || (required && !text)) throw new InputError('Un champ est manquant ou trop long.'); return text; };
const emailFor = value => { const email = clean(value, 254, true).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Adresse e-mail invalide.'); return email; };
const parisDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('/').reverse().join('-');
function parisMinutesUntil(date, time, now = new Date()) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now).map(part => [part.type, part.value])); const [year,month,day]=String(date).split('-').map(Number), [hour,minute]=String(time).slice(0,5).split(':').map(Number); return Math.round((Date.UTC(year,month-1,day,hour,minute)-Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute)))/60000); }
const addMinutes = (time, amount) => { const total = minutesFor(time) + amount; return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; };
async function sendConfirmation({ email, name, appointment, token }) {
    if (!process.env.BREVO_API_KEY) return false;
    const base = String(process.env.PUBLIC_URL || 'https://glowstock.fr').replace(/\/+$/, '');
    const cancelUrl = `${base}/annulation/?token=${encodeURIComponent(token)}`;
    const client = new BrevoClient({ apiKey: process.env.BREVO_API_KEY, environment: BrevoEnvironment.PRODUCTION });
    await client.transactionalEmails.sendTransacEmail({ sender: { name: 'GlowStock', email: 'contact@glowstock.fr' }, to: [{ email, name }], subject: 'Votre réservation est confirmée', textContent: `Bonjour ${name},\n\nVotre rendez-vous ${appointment.service} est confirmé le ${appointment.date} à ${appointment.start}.\n\nPour annuler : ${cancelUrl}`, htmlContent: `<p>Bonjour ${name.replace(/[&<>"']/g, '')},</p><p>Votre rendez-vous <strong>${appointment.service.replace(/[&<>"']/g, '')}</strong> est confirmé le ${appointment.date} à ${appointment.start}.</p><p><a href="${cancelUrl}">Annuler ma réservation</a></p>` }); return true;
}
function availableStarts(hours, entries, duration, buffer) {
    const start = minutesFor(hours.opensAt), end = minutesFor(hours.closesAt), result = [];
    for (let value = start; value + duration <= end; value += 15) {
        const blocked = entries.some(entry => value < minutesFor(entry.end_time) + buffer && value + duration > minutesFor(entry.start_time) - buffer);
        if (!blocked) result.push(`${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`);
    } return result;
}
async function publicSalon(pool, slug) {
    const rows = await pool.query('SELECT b.id_user,b.slug,b.buffer_minutes,b.cancellation_hours,u.company_name,u.nom FROM booking_settings b JOIN users u ON u.id=b.id_user WHERE b.slug=? AND b.is_enabled=1', [slug]);
    if (!rows.length) throw new InputError('Cette page de réservation est indisponible.', 404); return rows[0];
}
async function slots(pool, salon, date, serviceId) {
    if (!valueToDate(date) || date < parisDate()) throw new InputError('Date indisponible.');
    const [service, closures, entries] = await Promise.all([
        pool.query('SELECT id,name,price_cents,duration_minutes FROM crm_services WHERE id=? AND id_user=?', [serviceId, salon.id_user]),
        pool.query('SELECT id FROM booking_closures WHERE id_user=? AND closure_date=?', [salon.id_user, date]),
        pool.query('SELECT start_time,end_time FROM planning_entries WHERE id_user=? AND appointment_date=?', [salon.id_user, date])
    ]);
    if (!service.length) throw new InputError('Prestation indisponible.', 404);
    const hours = (await getBusinessHours(pool, salon.id_user))[dayOfWeekFor(date)];
    if (!hours?.isOpen || closures.length) return { service: service[0], starts: [] };
    return { service: service[0], starts: availableStarts(hours, entries, Number(service[0].duration_minutes), Number(salon.buffer_minutes)) };
}
function createPublicRouter({ getPool, limitRequest }) {
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); if (!limitRequest(`booking-public:${req.ip}`, 40, 60000)) return res.sendStatus(429); next(); });
    router.get('/:slug', async (req, res, next) => { try { const pool = await getPool(), salon = await publicSalon(pool, slugFor(req.params.slug)); const services = await pool.query('SELECT id,name,price_cents,duration_minutes,description FROM crm_services WHERE id_user=? ORDER BY name LIMIT 101', [salon.id_user]); res.json({ salon: { name: salon.company_name || salon.nom || 'Votre salon', slug: salon.slug }, services: services.map(item => ({ id:Number(item.id), name:item.name, priceCents:Number(item.price_cents), durationMinutes:Number(item.duration_minutes), description:item.description || '' })) }); } catch (error) { next(error); } });
    router.get('/:slug/slots', async (req, res, next) => { try { const pool = await getPool(), salon = await publicSalon(pool, slugFor(req.params.slug)); const result = await slots(pool, salon, String(req.query.date || ''), idFor(req.query.serviceId)); res.json({ starts: result.starts, durationMinutes:Number(result.service.duration_minutes) }); } catch (error) { next(error); } });
    router.post('/:slug', express.json({ limit: '4kb' }), async (req, res, next) => {
        let connection, lockName; try {
            if (req.body?.website) throw new InputError('Réservation refusée.', 400);
            const pool = await getPool(), salon = await publicSalon(pool, slugFor(req.params.slug)), date = String(req.body?.date || ''), serviceId = idFor(req.body?.serviceId), start = normaliseTime(req.body?.start), name = clean(req.body?.name, 150, true), email = emailFor(req.body?.email), phone = clean(req.body?.phone, 40);
            if (!start || !valueToDate(date)) throw new InputError('Créneau invalide.'); lockName = `glowstock-booking-${salon.id_user}-${date}`; connection = await pool.getConnection(); const locked = await connection.query('SELECT GET_LOCK(?, 5) AS locked', [lockName]); if (Number(locked[0]?.locked) !== 1) throw new InputError('Ce créneau est en cours de réservation. Réessaie.', 409);
            await connection.beginTransaction(); const freshSalon = await publicSalon(connection, salon.slug), choice = await slots(connection, freshSalon, date, serviceId); if (!choice.starts.includes(start)) throw new InputError('Ce créneau vient d’être réservé. Choisis-en un autre.', 409);
            const end = addMinutes(start, Number(choice.service.duration_minutes)); const customers = await connection.query('SELECT id FROM crm_customers WHERE id_user=? AND email=? ORDER BY id LIMIT 2 FOR UPDATE', [salon.id_user, email]);
            let customerId = Number(customers[0]?.id); if (!customerId) customerId = Number((await connection.query('INSERT INTO crm_customers (id_user,name,email,phone,address,notes) VALUES (?,?,?,?,?,?)', [salon.id_user, name, email, phone, '', 'Réservation en ligne'])).insertId);
            const appointmentId = Number((await connection.query('INSERT INTO planning_entries (id_user,appointment_date,start_time,end_time,client_name,service_name,notes) VALUES (?,?,?,?,?,?,?)', [salon.id_user, date, start, end, name, choice.service.name, 'Réservation en ligne'])).insertId);
            await connection.query('INSERT INTO crm_appointment_links (appointment_id,id_user,customer_id,service_id) VALUES (?,?,?,?)', [appointmentId, salon.id_user, customerId, serviceId]);
            const token = crypto.randomBytes(32).toString('base64url'); await connection.query('INSERT INTO booking_requests (id,id_user,appointment_id,customer_id,service_id,email,cancellation_token_hash) VALUES (?,?,?,?,?,?,?)', [crypto.randomUUID(), salon.id_user, appointmentId, customerId, serviceId, email, crypto.createHash('sha256').update(token).digest('hex')]);
            await connection.commit(); const appointment = { date, start, end, service: choice.service.name }; void sendConfirmation({ email, name, appointment, token }).catch(() => {}); res.status(201).json({ ok:true, appointment, emailConfirmation: Boolean(process.env.BREVO_API_KEY) });
        } catch (error) { if (connection) await connection.rollback().catch(() => {}); next(error); } finally { if (connection && lockName) await connection.query('DO RELEASE_LOCK(?)', [lockName]).catch(() => {}); if (connection) connection.release(); }
    });
    router.post('/cancel/:token', express.json({ limit: '1kb' }), async (req, res, next) => { let c; try { const token = String(req.params.token || ''); if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) throw new InputError('Lien d’annulation invalide.', 404); const hash = crypto.createHash('sha256').update(token).digest('hex'); c = await (await getPool()).getConnection(); await c.beginTransaction(); const row = await c.query("SELECT b.id,b.appointment_id,b.status,s.cancellation_hours,DATE_FORMAT(p.appointment_date,'%Y-%m-%d') AS day,TIME_FORMAT(p.start_time,'%H:%i') AS start FROM booking_requests b JOIN booking_settings s ON s.id_user=b.id_user JOIN planning_entries p ON p.id=b.appointment_id WHERE b.cancellation_token_hash=? FOR UPDATE", [hash]); if (!row.length || row[0].status !== 'confirmed') throw new InputError('Réservation introuvable ou déjà annulée.', 404); if (parisMinutesUntil(row[0].day,row[0].start) < Number(row[0].cancellation_hours)*60) throw new InputError('Le délai d’annulation de ce salon est dépassé.', 409); await c.query('UPDATE booking_requests SET status="cancelled",cancelled_at=NOW() WHERE id=? AND status="confirmed"', [row[0].id]); await c.query('DELETE FROM planning_entries WHERE id=?', [row[0].appointment_id]); await c.commit(); res.json({ ok:true }); } catch (error) { if(c) await c.rollback().catch(()=>{}); next(error); } finally { if(c)c.release(); } });
    router.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(error.status || 503).json({ error: error instanceof InputError ? error.message : error.code === 'ER_NO_SUCH_TABLE' ? 'La réservation doit être initialisée par la migration 026.' : 'Réservation impossible. Réessaie plus tard.' }); }); return router;
}
function createAdminRouter({ getPool, hasPermission, getSubscriptionStatus, requireSameOrigin }) {
 const router = express.Router(); router.use(express.json({ limit:'4kb' })); router.use(async (req,res,next) => { try { const id=req.session?.userId; if(!id) throw new InputError('Session expirée.',401); if(!(await hasPermission(id,'manage_products')) || (await getSubscriptionStatus(id)).level!=='full') throw new InputError('Accès refusé.',403); req.bookingUserId=id; next(); } catch(e){ next(e); } });
 router.get('/settings', async (req,res,next) => { try { const rows=await (await getPool()).query('SELECT slug,is_enabled,buffer_minutes,cancellation_hours FROM booking_settings WHERE id_user=?',[req.bookingUserId]); res.json(rows[0]||null); } catch(e){next(e);} });
 router.post('/settings', requireSameOrigin, async (req,res,next) => { try { const body=req.body||{}, slug=slugFor(body.slug), enabled=body.enabled===true?1:0, buffer=Number(body.bufferMinutes), cancellation=Number(body.cancellationHours); if(!Number.isInteger(buffer)||buffer<0||buffer>120||!Number.isInteger(cancellation)||cancellation<0||cancellation>720) throw new InputError('Paramètres de réservation invalides.'); await (await getPool()).query('INSERT INTO booking_settings (id_user,slug,is_enabled,buffer_minutes,cancellation_hours) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE slug=VALUES(slug),is_enabled=VALUES(is_enabled),buffer_minutes=VALUES(buffer_minutes),cancellation_hours=VALUES(cancellation_hours)',[req.bookingUserId,slug,enabled,buffer,cancellation]); res.json({ok:true}); } catch(e){next(e);} });
 router.use((error,req,res,next)=>res.status(error.status||503).json({error:error instanceof InputError?error.message:'Paramètres impossibles à enregistrer.'})); return router;
}
module.exports = { createPublicRouter, createAdminRouter, availableStarts, slugFor, parisMinutesUntil };
