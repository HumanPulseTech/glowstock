const DEFAULT_HOURS = [
    { dayOfWeek: 0, isOpen: true, opensAt: '09:00', closesAt: '19:00' },
    { dayOfWeek: 1, isOpen: true, opensAt: '09:00', closesAt: '19:00' },
    { dayOfWeek: 2, isOpen: true, opensAt: '09:00', closesAt: '19:00' },
    { dayOfWeek: 3, isOpen: true, opensAt: '09:00', closesAt: '19:00' },
    { dayOfWeek: 4, isOpen: true, opensAt: '09:00', closesAt: '19:00' },
    { dayOfWeek: 5, isOpen: true, opensAt: '09:00', closesAt: '17:00' },
    { dayOfWeek: 6, isOpen: true, opensAt: '09:00', closesAt: '17:00' }
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

const valueToDate = (value) => {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
};

const toDateString = (value) => {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
    const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
};

const normaliseTime = (value) => {
    const match = String(value || '').match(TIME_PATTERN);
    return match ? String(value).slice(0, 5) : null;
};

const minutesFor = (time) => {
    const normalised = normaliseTime(time);
    if (!normalised) return null;
    const [hours, minutes] = normalised.split(':').map(Number);
    return hours * 60 + minutes;
};

function weekStartFor(value) {
    const date = valueToDate(value) || new Date();
    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const mondayOffset = (utcDate.getUTCDay() + 6) % 7;
    utcDate.setUTCDate(utcDate.getUTCDate() - mondayOffset);
    return utcDate.toISOString().slice(0, 10);
}

function addDays(dateValue, amount) {
    const date = valueToDate(dateValue);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
}

function dayOfWeekFor(dateValue) {
    const date = valueToDate(dateValue);
    return date ? (date.getUTCDay() + 6) % 7 : null;
}

function defaultHours() {
    return DEFAULT_HOURS.map((day) => ({ ...day }));
}

function normaliseHours(rows = []) {
    const hours = defaultHours();
    rows.forEach((row) => {
        const day = Number(row.day_of_week ?? row.dayOfWeek);
        if (!Number.isInteger(day) || day < 0 || day > 6) return;
        const isOpen = Number(row.is_open ?? row.isOpen) === 1 || row.isOpen === true;
        const opensAt = normaliseTime(row.opens_at ?? row.opensAt);
        const closesAt = normaliseTime(row.closes_at ?? row.closesAt);
        hours[day] = { dayOfWeek: day, isOpen, opensAt: isOpen ? opensAt : null, closesAt: isOpen ? closesAt : null };
    });
    return hours;
}

function validateHours(input) {
    if (!Array.isArray(input) || input.length !== 7) return null;
    const byDay = new Map();
    for (const item of input) {
        const dayOfWeek = Number(item?.dayOfWeek);
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || byDay.has(dayOfWeek)) return null;
        const isOpen = item?.isOpen === true;
        const opensAt = normaliseTime(item?.opensAt);
        const closesAt = normaliseTime(item?.closesAt);
        if (isOpen && (opensAt === null || closesAt === null || minutesFor(opensAt) >= minutesFor(closesAt))) return null;
        byDay.set(dayOfWeek, { dayOfWeek, isOpen, opensAt: isOpen ? opensAt : null, closesAt: isOpen ? closesAt : null });
    }
    return [...byDay.values()].sort((first, second) => first.dayOfWeek - second.dayOfWeek);
}

async function getBusinessHours(connection, userId) {
    const rows = await connection.query(
        'SELECT day_of_week, is_open, opens_at, closes_at FROM planning_business_hours WHERE id_user = ? ORDER BY day_of_week ASC',
        [userId]
    );
    return normaliseHours(rows);
}

function normaliseEntry(row) {
    return {
        id: Number(row.id), appointmentDate: toDateString(row.appointment_date), startTime: normaliseTime(row.start_time),
        endTime: normaliseTime(row.end_time), clientName: String(row.client_name || ''), serviceName: String(row.service_name || ''), notes: String(row.notes || '')
    };
}

module.exports = { addDays, dayOfWeekFor, getBusinessHours, minutesFor, normaliseEntry, normaliseTime, validateHours, valueToDate, weekStartFor };
