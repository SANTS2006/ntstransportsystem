import type { MomoProvider } from './gateway.js';

/** The wallets a passenger can choose to pay with. */
export const PAY_METHODS = ['ORANGE_MONEY', 'AFRIMONEY', 'QMONEY'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const METHOD_LABEL: Record<PayMethod | 'ONLINE', string> = {
  ORANGE_MONEY: 'Orange Money',
  AFRIMONEY: 'AfriMoney',
  QMONEY: 'QMoney',
  ONLINE: 'Pay online',
};

/** Country Monime is asked about when listing mobile-money providers. */
export const PAYMENT_COUNTRY = 'SL';

/**
 * Monime names its providers (for example "Orange Money"); the app never hard-codes their ids.
 * A provider is recognised by its name, and only counted when Monime says it is active and can
 * take payments, so QMoney is offered online if and when Monime lists it.
 */
const NAME: Record<PayMethod, RegExp> = {
  ORANGE_MONEY: /orange/i,
  AFRIMONEY: /afri/i, // "Afrimoney", "Africell Money"
  QMONEY: /q[\s-]?money|qcell/i,
};

export function findMomo(method: PayMethod, momos: MomoProvider[]): MomoProvider | undefined {
  return momos.find((m) => m.active && m.canPayFrom && NAME[method].test(m.name));
}

/** One way of paying, as shown to the passenger. */
export interface PayOption {
  method: PayMethod | 'ONLINE';
  label: string;
  /** ONLINE goes to Monime's hosted page; MANUAL is paid to the company directly and confirmed by staff. */
  kind: 'ONLINE' | 'MANUAL';
  manual?: { number: string; accountName: string | null };
}
