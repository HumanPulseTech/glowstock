const { getPool } = require('../db.js');
const { getSubscriptionStatus, allows } = require('../subscription.js');
const { hasPermission } = require('../permissions.js');
const { dayOfWeekFor, getBusinessHours, minutesFor, normaliseEntry, normaliseTime, valueToDate } = require('../planning.js');
const serverLogger = require('../serverLogger.js');

const cleanText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const entryIdFor = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

module.exports = async function savePlanningEntry(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const subscription = await getSubscriptionStatus(userId);
        if (!allows(subscription, 'full')) return socket.emit('subscription blocked', subscription.level);
        if (!(await hasPermission(userId, 'manage_products'))) return socket.emit('planning entry error', 'Ce rôle ne peut pas modifier le planning.');

        const entryId = entryIdFor(input?.id);
        const appointmentDate = typeof input?.appointmentDate === 'string' ? input.appointmentDate : '';
        const startTime = normaliseTime(input?.startTime);
        const endTime = normaliseTime(input?.endTime);
        const clientName = cleanText(input?.clientName, 150);
        const serviceName = cleanText(input?.serviceName, 150);
        const notes = cleanText(input?.notes, 2000);
        if (!valueToDate(appointmentDate) || !startTime || !endTime || !clientName || minutesFor(startTime) >= minutesFor(endTime)) {
            return socket.emit('planning entry error', 'Renseigne une cliente, une date et des horaires valides.');
        }
        if (minutesFor(endTime) - minutesFor(startTime) > 480) return socket.emit('planning entry error', 'Un rendez-vous ne peut pas dépasser huit heures.');

        connection = await (await getPool()).getConnection();
        await connection.beginTransaction();
        const hours = await getBusinessHours(connection, userId);
        const businessDay = hours[dayOfWeekFor(appointmentDate)];
        if (!businessDay?.isOpen || minutesFor(startTime) < minutesFor(businessDay.opensAt) || minutesFor(endTime) > minutesFor(businessDay.closesAt)) {
            await connection.rollback();
            return socket.emit('planning entry error', 'Ce créneau est en dehors de tes horaires d’ouverture.');
        }
        if (entryId) {
            const owned = await connection.query('SELECT id FROM planning_entries WHERE id = ? AND id_user = ? FOR UPDATE', [entryId, userId]);
            if (!owned.length) {
                await connection.rollback();
                return socket.emit('planning entry error', 'Ce rendez-vous est introuvable.');
            }
        }
        const conflicts = await connection.query(
            `SELECT id FROM planning_entries
             WHERE id_user = ? AND appointment_date = ? AND start_time < ? AND end_time > ?${entryId ? ' AND id <> ?' : ''}
             FOR UPDATE`,
            entryId ? [userId, appointmentDate, endTime, startTime, entryId] : [userId, appointmentDate, endTime, startTime]
        );
        if (conflicts.length) {
            await connection.rollback();
            return socket.emit('planning entry error', 'Ce créneau chevauche déjà un rendez-vous.');
        }

        let savedId = entryId;
        if (entryId) {
            await connection.query(
                'UPDATE planning_entries SET appointment_date = ?, start_time = ?, end_time = ?, client_name = ?, service_name = ?, notes = ? WHERE id = ? AND id_user = ?',
                [appointmentDate, startTime, endTime, clientName, serviceName || null, notes || null, entryId, userId]
            );
        } else {
            const result = await connection.query(
                'INSERT INTO planning_entries (id_user, appointment_date, start_time, end_time, client_name, service_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, appointmentDate, startTime, endTime, clientName, serviceName || null, notes || null]
            );
            savedId = Number(result.insertId);
        }
        const saved = await connection.query('SELECT id, appointment_date, start_time, end_time, client_name, service_name, notes FROM planning_entries WHERE id = ? AND id_user = ?', [savedId, userId]);
        await connection.commit();
        void serverLogger.info('planning.entry_saved', 'Rendez-vous du planning enregistré.', { entryId: savedId }, { userId, socketId: socket.id });
        socket.emit('planning entry saved', normaliseEntry(saved[0]));
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        void serverLogger.error('planning.entry_save_failed', 'Impossible d’enregistrer un rendez-vous.', { code: error?.code || null }, { userId: userId || null, socketId: socket.id });
        socket.emit('planning entry error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Le planning doit être initialisé : applique la migration 019.' : 'Impossible d’enregistrer ce rendez-vous pour le moment.');
    } finally { if (connection) connection.release(); }
};
