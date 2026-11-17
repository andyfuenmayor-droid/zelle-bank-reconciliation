import crypto from 'node:crypto';
import { buildDedupKey } from '@/lib/email-parser';
import {
  CurrencyType,
  MovementType,
  NormalizedFinancialTx,
} from '@/types/reconciliation';

export interface BinanceClientConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  defaultFeePercentage?: number;
}

interface BinancePayPartyInfo {
  name?: string;
  type?: string;
  binanceId?: string;
  accountId?: string;
}

interface BinancePayFundDetail {
  currency?: string;
  amount?: string;
}

interface BinancePayTransactionItem {
  orderType?: string;
  transactionId?: string;
  orderId?: string;
  transactionTime?: number;
  amount?: string;
  currency?: string;
  walletType?: number;
  fundsDetail?: BinancePayFundDetail[];
  payerInfo?: BinancePayPartyInfo;
  receiverInfo?: BinancePayPartyInfo;
  note?: string;
}

interface BinancePayApiResponse {
  code?: string;
  message?: string;
  data?: BinancePayTransactionItem[];
  success?: boolean;
}

interface BinanceP2POrderItem {
  orderNumber?: string;
  advNo?: string;
  tradeType?: 'BUY' | 'SELL' | string;
  asset?: string;
  fiat?: string;
  amount?: string;
  totalPrice?: string;
  unitPrice?: string;
  orderStatus?: string;
  createTime?: number;
  commission?: string;
  counterPartNickName?: string;
}

interface BinanceP2PApiResponse {
  code?: string;
  message?: string;
  data?: BinanceP2POrderItem[];
  total?: number;
  success?: boolean;
}

interface BinanceDepositItem {
  id?: string;
  amount?: string;
  coin?: string;
  network?: string;
  status?: number;
  address?: string;
  addressTag?: string;
  txId?: string;
  insertTime?: number;
  completeTime?: number;
  transferType?: number;
  confirmTimes?: string;
}

export interface BinanceBatchSyncResult {
  configured: boolean;
  transactions: NormalizedFinancialTx[];
  errors: string[];
}

function normalizeBinanceCurrency(rawCurrency: string | undefined): CurrencyType {
  const upper = (rawCurrency ?? 'USDT').trim().toUpperCase();
  if (upper === 'USD') {
    return 'USD';
  }
  if (upper === 'VES') {
    return 'VES';
  }
  return 'USDT';
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIsoDate(timestampMs: number | undefined): string {
  if (typeof timestampMs === 'number' && Number.isFinite(timestampMs) && timestampMs > 0) {
    return new Date(timestampMs).toISOString();
  }
  return new Date().toISOString();
}

export class BinanceClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private readonly defaultFeePercentage: number;

  constructor(config: BinanceClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = (config.baseUrl ?? 'https://api.binance.com').replace(/\/+$/, '');
    this.defaultFeePercentage =
      typeof config.defaultFeePercentage === 'number' &&
      Number.isFinite(config.defaultFeePercentage)
        ? config.defaultFeePercentage
        : 1.5;
  }

  private signQuery(params: Record<string, string | number>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      search.set(key, String(value));
    }
    search.set('timestamp', String(Date.now()));
    search.set('recvWindow', '10000');

    const queryString = search.toString();
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');

    return `${queryString}&signature=${signature}`;
  }

  private async signedGet<TResponse>(
    endpointPath: string,
    params: Record<string, string | number> = {}
  ): Promise<TResponse> {
    const signedQuery = this.signQuery(params);
    const url = `${this.baseUrl}${endpointPath}?${signedQuery}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Binance API ${endpointPath} respondió ${response.status}: ${errorText.slice(0, 220)}`
      );
    }

    return (await response.json()) as TResponse;
  }

  /**
   * Consulta transacciones de Binance Pay (`GET /sapi/v1/pay/transactions`).
   */
  public async getBinancePayTransactions(): Promise<NormalizedFinancialTx[]> {
    const endTime = Date.now();
    const startTime = endTime - 7 * 24 * 60 * 60 * 1000;

    const payload = await this.signedGet<BinancePayApiResponse>(
      '/sapi/v1/pay/transactions',
      {
        startTime,
        endTime,
        limit: 100,
      }
    );

    const rows = Array.isArray(payload.data) ? payload.data : [];
    const normalized: NormalizedFinancialTx[] = [];

    for (const item of rows) {
      const rawAmountStr = item.amount ?? item.fundsDetail?.[0]?.amount ?? '0';
      const numericAmount = Number.parseFloat(rawAmountStr);
      if (!Number.isFinite(numericAmount) || numericAmount === 0) {
        continue;
      }

      const absAmount = roundTwoDecimals(Math.abs(numericAmount));
      if (absAmount <= 0) {
        continue;
      }

      const isOutgoing =
        numericAmount < 0 ||
        (Boolean(item.receiverInfo?.name || item.receiverInfo?.binanceId) &&
          !item.payerInfo?.name &&
          !item.payerInfo?.binanceId);

      const tipoMovimiento: MovementType = isOutgoing ? 'ENVIADO' : 'RECIBIDO';
      const party = isOutgoing
        ? item.receiverInfo?.name ||
          item.receiverInfo?.binanceId ||
          item.receiverInfo?.accountId ||
          'Destinatario Binance Pay'
        : item.payerInfo?.name ||
          item.payerInfo?.binanceId ||
          item.payerInfo?.accountId ||
          'Remitente Binance Pay';

      const referencia =
        (item.transactionId || item.orderId || `BPAY-${item.transactionTime ?? Date.now()}`)
          .trim()
          .toUpperCase();

      const moneda = normalizeBinanceCurrency(
        item.currency ?? item.fundsDetail?.[0]?.currency
      );

      normalized.push({
        external_unique_id: `BINANCE_PAY:${referencia}`,
        dedup_key: buildDedupKey('BINANCE_PAY', referencia, absAmount),
        plataforma: 'BINANCE_PAY',
        moneda,
        tipo_movimiento: tipoMovimiento,
        monto_bruto: absAmount,
        porcentaje_comision:
          tipoMovimiento === 'RECIBIDO' ? this.defaultFeePercentage : 0.0,
        remitente_o_contraparte: party,
        referencia,
        fecha_transaccion: toIsoDate(item.transactionTime),
        origen_deteccion: 'BINANCE_API',
        raw_payload: {
          source: 'binance_pay_api',
          ...item,
        },
        confianza: 1.0,
      });
    }

    return normalized;
  }

  /**
   * Consulta órdenes P2P completadas (`GET /sapi/v1/c2c/orderMatch/listUserOrderHistory`)
   * tanto para compras (`BUY`) como para ventas (`SELL`).
   */
  public async getP2POrderHistory(): Promise<NormalizedFinancialTx[]> {
    const tradeTypes: ReadonlyArray<'BUY' | 'SELL'> = ['BUY', 'SELL'];
    const endTimestamp = Date.now();
    const startTimestamp = endTimestamp - 14 * 24 * 60 * 60 * 1000;

    const results = await Promise.allSettled(
      tradeTypes.map((tradeType) =>
        this.signedGet<BinanceP2PApiResponse>(
          '/sapi/v1/c2c/orderMatch/listUserOrderHistory',
          {
            tradeType,
            startTimestamp,
            endTimestamp,
            page: 1,
            rows: 50,
          }
        )
      )
    );

    const normalized: NormalizedFinancialTx[] = [];

    for (let idx = 0; idx < results.length; idx++) {
      const res = results[idx];
      const requestedType = tradeTypes[idx] ?? 'BUY';
      if (res.status !== 'fulfilled') {
        continue;
      }

      const rows = Array.isArray(res.value.data) ? res.value.data : [];
      for (const order of rows) {
        if ((order.orderStatus ?? '').toUpperCase() !== 'COMPLETED') {
          continue;
        }

        const parsedAmount = Number.parseFloat(order.amount ?? '0');
        const absAmount = roundTwoDecimals(parsedAmount);
        if (!Number.isFinite(absAmount) || absAmount <= 0) {
          continue;
        }

        const effectiveTradeType = (order.tradeType ?? requestedType).toUpperCase();
        const tipoMovimiento: MovementType =
          effectiveTradeType === 'SELL' ? 'ENVIADO' : 'RECIBIDO';

        const referencia = (
          order.orderNumber || `P2P-${order.createTime ?? Date.now()}`
        )
          .trim()
          .toUpperCase();

        const moneda = normalizeBinanceCurrency(order.asset);
        const counterparty =
          order.counterPartNickName?.trim() || 'Contraparte Binance P2P';

        normalized.push({
          external_unique_id: `BINANCE_P2P:${referencia}`,
          dedup_key: buildDedupKey('BINANCE_P2P', referencia, absAmount),
          plataforma: 'BINANCE_P2P',
          moneda,
          tipo_movimiento: tipoMovimiento,
          monto_bruto: absAmount,
          porcentaje_comision:
            tipoMovimiento === 'RECIBIDO' ? this.defaultFeePercentage : 0.0,
          remitente_o_contraparte: counterparty,
          referencia,
          fecha_transaccion: toIsoDate(order.createTime),
          origen_deteccion: 'BINANCE_API',
          raw_payload: {
            source: 'binance_p2p_api',
            ...order,
          },
          confianza: 1.0,
        });
      }
    }

    return normalized;
  }

  /**
   * Consulta historial de depósitos On-Chain (`GET /sapi/v1/capital/deposit/hisrec`) con `status=1`.
   */
  public async getDepositHistory(): Promise<NormalizedFinancialTx[]> {
    const endTime = Date.now();
    const startTime = endTime - 30 * 24 * 60 * 60 * 1000;

    const deposits = await this.signedGet<BinanceDepositItem[]>(
      '/sapi/v1/capital/deposit/hisrec',
      {
        status: 1,
        startTime,
        endTime,
        limit: 100,
      }
    );

    const rows = Array.isArray(deposits) ? deposits : [];
    const normalized: NormalizedFinancialTx[] = [];

    for (const dep of rows) {
      if (dep.status !== 1) {
        continue;
      }

      const parsedAmount = Number.parseFloat(dep.amount ?? '0');
      const absAmount = roundTwoDecimals(parsedAmount);
      if (!Number.isFinite(absAmount) || absAmount <= 0) {
        continue;
      }

      const referencia = (
        dep.txId ||
        dep.id ||
        `ONCHAIN-${dep.insertTime ?? Date.now()}`
      )
        .trim()
        .toUpperCase();

      const coinLabel = (dep.coin ?? 'USDT').toUpperCase();
      const networkLabel = (dep.network ?? 'MAINNET').toUpperCase();
      const addrShort = dep.address
        ? `${dep.address.slice(0, 6)}...${dep.address.slice(-4)}`
        : 'Wallet';

      normalized.push({
        external_unique_id: `BINANCE_ONCHAIN:${referencia}`,
        dedup_key: buildDedupKey('BINANCE_ONCHAIN', referencia, absAmount),
        plataforma: 'BINANCE_ONCHAIN',
        moneda: normalizeBinanceCurrency(coinLabel),
        tipo_movimiento: 'RECIBIDO',
        monto_bruto: absAmount,
        porcentaje_comision: this.defaultFeePercentage,
        remitente_o_contraparte: `On-Chain ${coinLabel} (${networkLabel}) · ${addrShort}`,
        referencia,
        fecha_transaccion: toIsoDate(dep.completeTime ?? dep.insertTime),
        origen_deteccion: 'BINANCE_API',
        raw_payload: {
          source: 'binance_deposit_hisrec',
          ...dep,
        },
        confianza: 1.0,
      });
    }

    return normalized;
  }
}

/**
 * Ejecuta en paralelo los 3 canales de Binance API (`Pay`, `P2P`, `On-Chain`) usando `Promise.allSettled`.
 */
export async function fetchAllBinanceTransactions(): Promise<BinanceBatchSyncResult> {
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';

  if (!apiKey || !apiSecret) {
    return {
      configured: false,
      transactions: [],
      errors: [],
    };
  }

  const feePercent = Number.parseFloat(
    process.env.BINANCE_DEFAULT_FEE_PERCENT ?? '1.50'
  );

  const client = new BinanceClient({
    apiKey,
    apiSecret,
    baseUrl: process.env.BINANCE_API_BASE_URL,
    defaultFeePercentage: Number.isFinite(feePercent) ? feePercent : 1.5,
  });

  const channelNames = ['Binance Pay', 'Binance P2P', 'Binance On-Chain'] as const;
  const settled = await Promise.allSettled([
    client.getBinancePayTransactions(),
    client.getP2POrderHistory(),
    client.getDepositHistory(),
  ]);

  const transactions: NormalizedFinancialTx[] = [];
  const errors: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const channelLabel = channelNames[i] ?? 'Binance';
    if (result.status === 'fulfilled') {
      transactions.push(...result.value);
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : 'Error consultando Binance API';
      errors.push(`${channelLabel}: ${msg}`);
    }
  }

  return {
    configured: true,
    transactions,
    errors,
  };
}
