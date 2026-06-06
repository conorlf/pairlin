import { createMollieClient } from '@mollie/api-client';
import 'dotenv/config';

const mollie = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });

export interface PaymentParams {
  orderId: string;
  amountEur: number;
  description: string;
  redirectUrl: string;
  webhookUrl: string;
  metadata?: Record<string, string>;
}

export async function createPayment(params: PaymentParams) {
  const payment = await mollie.payments.create({
    amount: {
      currency: 'EUR',
      value: params.amountEur.toFixed(2),
    },
    description: params.description,
    redirectUrl: params.redirectUrl,
    webhookUrl: params.webhookUrl,
    metadata: {
      orderId: params.orderId,
      ...params.metadata,
    },
  });
  return payment;
}

export async function getPayment(id: string) {
  return mollie.payments.get(id);
}

export async function refundSurplus(paymentId: string, surplusEur: number, description: string) {
  if (surplusEur <= 0) return null;
  const refund = await mollie.paymentRefunds.create({
    paymentId,
    amount: {
      currency: 'EUR',
      value: surplusEur.toFixed(2),
    },
    description,
  });
  return refund;
}

export async function getBalance(): Promise<number> {
  // Mollie v4 balance access via REST — @mollie/api-client does not expose balances binder
  // Use for ops monitoring only; not called in critical path
  return 0;
}
