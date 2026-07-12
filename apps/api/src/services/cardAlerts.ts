import { budgetPercentUsed } from '../lib/budgets';
import { CARD_LIMIT_ALERT_THRESHOLD, cardCycleSpent, currentCycle } from '../lib/cards';
import { moneyLabel } from '../lib/currency';
import { startOfTodayUTC } from '../lib/dates';
import { prisma } from '../prisma';
import { notifyUser } from './notifications';

/**
 * Tras registrar un gasto en una cuenta CARD, avisa si el consumo del ciclo actual
 * alcanzó el umbral fijo del límite de crédito (mismo patrón que `budgetAlerts`).
 * Máximo una alerta por ciclo: `cardLastAlertCycle` guarda el cierre (YYYY-MM-DD)
 * del ciclo ya alertado — análogo a `Budget.lastAlertMonth`. Si el usuario cambia
 * el día de cierre, la clave deja de coincidir y la alerta se rearma sola.
 *
 * No convierte monedas: el consumo y el límite están ambos en la moneda de la cuenta.
 */
export async function checkCardLimitAlert(userId: string, accountId: string): Promise<void> {
  const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!account || account.type !== 'CARD' || account.creditLimit === null || account.closingDay === null) {
    return;
  }

  const cycle = currentCycle(account.closingDay, startOfTodayUTC());
  const cycleKey = cycle.closing.toISOString().slice(0, 10);
  if (account.cardLastAlertCycle === cycleKey) return;

  const spent = await cardCycleSpent(account.id, cycle);
  const limit = account.creditLimit.toNumber();
  const percent = budgetPercentUsed(spent, limit);
  if (percent < CARD_LIMIT_ALERT_THRESHOLD) return;

  await prisma.account.update({ where: { id: account.id }, data: { cardLastAlertCycle: cycleKey } });

  const title = `Tarjeta ${account.name} al ${percent}% del límite`;
  const body = `Llevás consumidos ${moneyLabel(spent, account.currency)} de ${moneyLabel(limit, account.currency)} en el ciclo que cierra el ${cycleKey} (umbral: ${CARD_LIMIT_ALERT_THRESHOLD}%).`;
  await notifyUser(userId, {
    title,
    body,
    emailHtml: `<h2>${title}</h2><p>${body}</p>`,
  });
}
