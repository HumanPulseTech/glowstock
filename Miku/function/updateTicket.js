const serverLogger = require('../serverLogger.js');
const logError = require('./logError.js');
const {
    getTicketAccess,
    ticketScope,
    getPoolConnection,
    normalizeTicketUpdate,
    isTeam,
    parsePermissions
} = require('../ticketAccess.js');

module.exports = async function updateTicket(input, socket) {
    let connection;
    const userId = socket.request.session?.userId;
    try {
        if (!userId) return socket.emit('auth error', 'Session expirée.');
        const ticketId = Number(input?.ticketId);
        if (!Number.isSafeInteger(ticketId) || ticketId < 1) return socket.emit('ticket error', 'Ticket invalide.');
        connection = await getPoolConnection();
        const access = await getTicketAccess(connection, userId);
        if (!access?.canManage) return socket.emit('ticket error', 'Tu n’as pas le droit de modifier ce ticket.');

        const ticketRows = await connection.query(
            `SELECT id, titre, equipe, statut, assigne_id, cout_total, temps_total_minutes
             FROM tickets WHERE id = ?${access.canSeeAll ? '' : ' AND equipe = ?'}`,
            access.canSeeAll ? [ticketId] : [ticketId, access.team]
        );
        const current = ticketRows[0];
        if (!current) return socket.emit('ticket error', 'Ticket introuvable ou inaccessible.');
        if (current.statut === 'reclamation') return socket.emit('ticket error', 'Cette réclamation doit être traitée depuis le panneau de décision du fondateur.');

        const update = normalizeTicketUpdate(input);
        const hasStatus = update.status !== null;
        const hasTeam = update.team !== null;
        const hasAssignee = Object.prototype.hasOwnProperty.call(input || {}, 'assigneeId');
        const hasCost = update.cost !== null;
        const hasMinutes = update.minutes !== null;
        const targetTeam = hasTeam ? update.team : current.equipe;
        const targetStatus = hasStatus ? update.status : current.statut;
        const targetAssignee = hasAssignee ? update.assigneeId : current.assigne_id;

        if (!update.note && !hasStatus && !hasTeam && !hasAssignee && !hasCost && !hasMinutes) {
            return socket.emit('ticket error', 'Ajoute une modification ou une information.');
        }
        if (!isTeam(targetTeam)) return socket.emit('ticket error', 'Équipe de ticket invalide.');
        if (!access.canSeeAll && targetTeam !== access.team) return socket.emit('ticket error', 'Tu ne peux pas déplacer ce ticket dans une autre équipe.');
        if ((hasTeam || hasAssignee) && !access.canAssign) return socket.emit('ticket error', 'Tu n’as pas le droit de gérer l’attribution de ce ticket.');

        if (targetAssignee !== null) {
            const assigneeRows = await connection.query('SELECT u.id, u.ticket_team, r.permissions FROM users u LEFT JOIN roles r ON r.slug = u.role WHERE u.id = ?', [targetAssignee]);
            const assignee = assigneeRows[0];
            const canReceiveTicket = assignee && (assignee.ticket_team === 'fondateur' || parsePermissions(assignee.permissions).includes('tickets_view'));
            if (!assignee || !canReceiveTicket || !assignee.ticket_team || (assignee.ticket_team !== targetTeam && assignee.ticket_team !== 'fondateur')) {
                return socket.emit('ticket error', 'La personne sélectionnée ne fait pas partie de cette équipe.');
            }
        }

        const targetCost = hasCost ? update.cost : Number(current.cout_total || 0);
        const targetMinutes = hasMinutes ? update.minutes : Number(current.temps_total_minutes || 0);
        const costDelta = Math.round((targetCost - Number(current.cout_total || 0)) * 100) / 100;
        const minutesDelta = targetMinutes - Number(current.temps_total_minutes || 0);
        const resolvedAt = targetStatus === 'termine' ? 'NOW()' : 'NULL';

        await connection.beginTransaction();
        await connection.query(
            `UPDATE tickets SET equipe = ?, statut = ?, assigne_id = ?, cout_total = ?, temps_total_minutes = ?, resolved_at = ${resolvedAt} WHERE id = ?`,
            [targetTeam, targetStatus, targetAssignee, targetCost, targetMinutes, ticketId]
        );
        await connection.query(
            'INSERT INTO ticket_updates (ticket_id, user_id, action, contenu, statut, equipe, assigne_id, cout_delta, temps_delta_minutes, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [ticketId, userId, 'mise_a_jour', update.note || null, targetStatus, targetTeam, targetAssignee, costDelta, minutesDelta, JSON.stringify({ costTotal: targetCost, minutesTotal: targetMinutes })]
        );
        await connection.commit();
        void serverLogger.info('ticket.updated', 'Ticket mis à jour.', { ticketId, status: targetStatus, team: targetTeam, assigneeId: targetAssignee }, { userId, socketId: socket.id });
        socket.emit('ticket updated', { ticketId });
        // Les pages « Mes tickets » ouvertes rechargent automatiquement leur suivi.
        socket.broadcast.emit('ticket updated', { ticketId });
    } catch (error) {
        if (connection) await connection.rollback().catch(() => {});
        const context = { code: error?.code || null, message: error?.message || null };
        void serverLogger.error('ticket.update_failed', 'Erreur lors de la mise à jour du ticket.', context, { userId, socketId: socket.id });
        void logError(userId || null, 'ticket_modification', 'Impossible de modifier le ticket.', context);
        socket.emit('ticket error', error?.code === 'ER_NO_SUCH_TABLE' ? 'Les tables de tickets manquent en base. Applique la migration 009.' : 'Impossible de modifier le ticket.');
    } finally {
        if (connection) connection.release();
    }
};
