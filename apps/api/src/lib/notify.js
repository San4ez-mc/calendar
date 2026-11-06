// Сповіщення в Telegram про запис, зроблений через публічну сторінку. Необовʼязкове: працює, лише якщо в .env є
// CAL_NOTIFY_BOT_TOKEN (бот, у чаті з яким уже є власник і клієнти воронки) і CAL_NOTIFY_CHAT_ID (власник).
// Помилки не валять запис: календар головніший за сповіщення.
const logger = require('@cal/logger');

async function tg(chatId, text) {
  const token = process.env.CAL_NOTIFY_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) logger.warn(`[notify] telegram ${res.status} для чату ${chatId}`);
    return res.ok;
  } catch (e) {
    logger.warn(`[notify] telegram: ${e.message}`);
    return false;
  }
}

// booking — серіалізований запис (startLabel, clientName, ...). Власнику і (якщо відомий Telegram id) клієнту.
async function bookingCreated(tenant, booking, { source, note } = {}) {
  const who = [booking.clientName, booking.clientTelegram ? `@${booking.clientTelegram}` : '', booking.clientPhone].filter(Boolean).join(' · ');
  const owner = process.env.CAL_NOTIFY_CHAT_ID;
  const lines = ['📅 Новий запис у календарі (людина обрала час сама)', '', `Час: ${booking.startLabel}`, `Хто: ${who || '—'}`];
  if (booking.clientTelegramId) lines.push(`Telegram: tg://user?id=${booking.clientTelegramId}`);
  if (source) lines.push(`Звідки: ${source}`);
  if (note) lines.push(`Коментар: ${note}`);
  await tg(owner, lines.join('\n'));
  if (booking.clientTelegramId && /^\d+$/.test(booking.clientTelegramId)) {
    await tg(booking.clientTelegramId, `✅ Записано на ${booking.startLabel} (за Києвом).\n\nПеред зустріччю Олександр напише тобі. Якщо треба змінити час, напиши йому: t.me/olexandrmatsuk`);
  }
}

module.exports = { bookingCreated, tg };
