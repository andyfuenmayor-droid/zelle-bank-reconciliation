import OpenAI from 'openai';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import { decryptAtRest, isAllowedRasterImageDataUrl } from '@/lib/security';
import {
  AssignedReceivingAccount,
  CurrencyType,
  ExpectedPlatformType,
} from '@/types/reconciliation';

export interface ReceiptAiScanResult {
  monto: number | null;
  moneda: CurrencyType;
  plataforma: ExpectedPlatformType;
  fecha?: string | null;
  remitente: string;
  referencia: string;
  cuenta_destino: string | null;
  selected_account_id: string | null;
  confianza: number;
  observaciones: string;
  metodo_ia:
    | 'OPENAI_VISION'
    | 'GEMINI_VISION'
    | 'ANTHROPIC_VISION'
    | 'VECTOR_SVG'
    | 'HEURISTIC'
    | 'MANUAL_FALLBACK';
}

interface RawVisionAiResponse {
  monto?: number | string | null;
  moneda?: string | null;
  fecha?: string | null;
  plataforma?: string | null;
  remitente?: string | null;
  referencia?: string | null;
  cuenta_destino?: string | null;
  confianza?: number | null;
  observaciones?: string | null;
}

export interface SystemAiConfig {
  ai_provider: 'openai' | 'gemini' | 'groq' | 'anthropic';
  openai_api_key: string | null;
  openai_model: string;
  gemini_api_key: string | null;
  gemini_model: string;
  groq_api_key: string | null;
  groq_model: string;
}

/**
 * Obtiene la configuración activa de IA priorizando variables de entorno y luego la base de datos PostgreSQL.
 */
export async function getActiveAiConfig(): Promise<SystemAiConfig> {
  const envOpenAiKey = process.env.OPENAI_API_KEY?.trim() || null;
  const envGeminiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    null;
  const envGroqKey = process.env.GROQ_API_KEY?.trim() || null;
  const envAiProvider = (process.env.AI_PROVIDER?.trim().toLowerCase() ||
    (envGeminiKey ? 'gemini' : envGroqKey ? 'groq' : 'openai')) as
    | 'openai'
    | 'gemini'
    | 'groq'
    | 'anthropic';
  const envOpenAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const envGeminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
  const envGroqModel =
    process.env.GROQ_MODEL?.trim() || 'llama-3.2-11b-vision-preview';

  if (envOpenAiKey || envGeminiKey || envGroqKey) {
    return {
      ai_provider: envAiProvider,
      openai_api_key: envOpenAiKey,
      openai_model: envOpenAiModel,
      gemini_api_key: envGeminiKey,
      gemini_model: envGeminiModel,
      groq_api_key: envGroqKey,
      groq_model: envGroqModel,
    };
  }

  // Si no está en variables de entorno, consultar PostgreSQL si está disponible
  const dbLive = await isDatabaseAvailable();
  if (dbLive) {
    try {
      const result = await dbQuery<{
        ai_provider: string;
        openai_api_key: string | null;
        openai_model: string;
        gemini_api_key: string | null;
        gemini_model: string;
        groq_api_key: string | null;
        groq_model: string | null;
      }>(
        `SELECT ai_provider, openai_api_key, openai_model, gemini_api_key, gemini_model, groq_api_key, groq_model
         FROM system_ai_settings
         WHERE id = 'default'
         LIMIT 1;`
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const prov = (row.ai_provider?.toLowerCase() || 'gemini') as
          | 'openai'
          | 'gemini'
          | 'groq'
          | 'anthropic';
        return {
          ai_provider: prov,
          openai_api_key: decryptAtRest(row.openai_api_key),
          openai_model: row.openai_model?.trim() || 'gpt-4o-mini',
          gemini_api_key: decryptAtRest(row.gemini_api_key),
          gemini_model: row.gemini_model?.trim() || 'gemini-2.5-flash',
          groq_api_key: decryptAtRest(row.groq_api_key),
          groq_model: row.groq_model?.trim() || 'llama-3.2-11b-vision-preview',
        };
      }
    } catch {
      // Si la tabla aún no existe, continúa con los defaults
    }
  }

  return {
    ai_provider: 'gemini',
    openai_api_key: null,
    openai_model: 'gpt-4o-mini',
    gemini_api_key: null,
    gemini_model: 'gemini-2.5-flash',
    groq_api_key: null,
    groq_model: 'llama-3.2-11b-vision-preview',
  };
}

/**
 * Normaliza la plataforma detectada hacia las plataformas soportadas por el sistema.
 */
function normalizeDetectedPlatform(rawPlatform?: string | null): ExpectedPlatformType {
  const p = (rawPlatform ?? '').toUpperCase();
  if (p.includes('TD') || p.includes('TORONTO')) {
    return 'TD_BANK';
  }
  if (p.includes('CITI')) {
    return 'CITIBANK';
  }
  if (p.includes('P2P')) {
    return 'BINANCE_P2P';
  }
  if (p.includes('ONCHAIN') || p.includes('CHAIN') || p.includes('TXID') || p.includes('BLOCKCHAIN')) {
    return 'BINANCE_ONCHAIN';
  }
  if (p.includes('BINANCE') || p.includes('PAY') || p.includes('PAY_ID')) {
    return 'BINANCE_PAY';
  }
  return 'CITIBANK';
}

/**
 * Normaliza la moneda detectada ('USD', 'USDT' o 'VES').
 */
function normalizeDetectedCurrency(
  rawCurrency?: string | null,
  platform?: ExpectedPlatformType
): CurrencyType {
  const c = (rawCurrency ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (c === 'USDT' || c === 'USDC' || c === 'CRYPTO') {
    return 'USDT';
  }
  if (c === 'VES' || c === 'BS' || c === 'BOLIVARES') {
    return 'VES';
  }
  if (c === 'USD' || c === 'DOLLAR' || c === 'DOLARES') {
    return 'USD';
  }
  return platform?.startsWith('BINANCE') ? 'USDT' : 'USD';
}

/**
 * Normaliza montos a número de coma flotante con 2 decimales.
 */
function normalizeAmount(rawAmount: unknown): number | null {
  if (typeof rawAmount === 'number' && Number.isFinite(rawAmount)) {
    return Math.round(rawAmount * 100) / 100;
  }
  if (typeof rawAmount === 'string') {
    const cleaned = rawAmount.replace(/[^0-9,.]/g, '').replace(/,/g, '');
    const parsed = Number.parseFloat(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed * 100) / 100;
    }
  }
  return null;
}

/**
 * Extrae datos directos si el comprobante es un SVG vectorial o generado con texto legible.
 */
function tryExtractFromSvgDataUrl(dataUrl: string): ReceiptAiScanResult | null {
  if (!dataUrl.startsWith('data:image/svg+xml')) {
    return null;
  }

  try {
    const base64Part = dataUrl.split(',')[1];
    if (!base64Part) {
      return null;
    }
    const decoded = Buffer.from(base64Part, 'base64').toString('utf8');

    // Monto
    const amountMatch = decoded.match(/Monto:\s*([$]?\s*[\d,.]+)/i);
    const rawAmount = amountMatch?.[1] ?? null;
    const monto = normalizeAmount(rawAmount);

    // Moneda
    const monedaMatch = decoded.match(/Moneda:\s*([A-Za-z]+)/i);
    const rawMoneda = monedaMatch?.[1] ?? (decoded.includes('USDT') ? 'USDT' : 'USD');

    // Plataforma
    let plataforma: ExpectedPlatformType = 'CITIBANK';
    if (decoded.includes('TD BANK')) {
      plataforma = 'TD_BANK';
    } else if (decoded.includes('BINANCE P2P')) {
      plataforma = 'BINANCE_P2P';
    } else if (decoded.includes('BINANCE PAY')) {
      plataforma = 'BINANCE_PAY';
    } else if (decoded.includes('BINANCE ON-CHAIN') || decoded.includes('ON-CHAIN')) {
      plataforma = 'BINANCE_ONCHAIN';
    } else if (decoded.includes('CITIBANK')) {
      plataforma = 'CITIBANK';
    }

    // Fecha
    const fechaMatch =
      decoded.match(/(?:Fecha|Date):\s*([^<]+)/i) ||
      decoded.match(/<text[^>]*>\s*(?:Fecha|Date):\s*([^<]+)<\/text>/i);
    const fecha = fechaMatch?.[1]?.trim() || null;

    // Referencia
    const refMatch =
      decoded.match(/(?:Ref|Confirmaci[oó]n|TxID|Order ID):\s*([^<]+)/i) ||
      decoded.match(/<text[^>]*>\s*(?:Ref|Confirmaci[oó]n):\s*([^<]+)<\/text>/i);
    const referencia = refMatch?.[1]?.trim() || '';

    return {
      monto,
      moneda: normalizeDetectedCurrency(rawMoneda, plataforma),
      plataforma,
      fecha,
      remitente: '', // Debe ser colocado obligatoriamente de forma manual
      referencia,
      cuenta_destino: null,
      selected_account_id: null,
      confianza: 0.99,
      observaciones: 'Datos vectoriales extraídos con precisión exacta del comprobante SVG.',
      metodo_ia: 'VECTOR_SVG',
    };
  } catch {
    return null;
  }
}

/**
 * Escanea un comprobante con OpenAI Vision (`gpt-4o-mini`).
 */
async function scanWithOpenAiVision(
  base64DataUrl: string,
  apiKey: string,
  modelName: string
): Promise<ReceiptAiScanResult> {
  const openai = new OpenAI({ apiKey });

  const promptSystem = `Eres un auditor FinTech y visión artificial de alta precisión especializado en comprobantes de pago de Zelle (Citibank, TD Bank, Chase, Bank of America, Wells Fargo) y Binance (Binance Pay, Binance P2P, Depósitos On-chain USDT/Crypto).

Analiza la captura de pantalla adjunta y extrae de forma obligatoria un objeto JSON con los siguientes campos:
- "monto": Número flotante con el monto transferido/recibido (ej. 10.00, 20.00, 650.00). Sin comas ni signos de dólar.
- "moneda": "USD", "USDT" o "VES". Por defecto USD para Zelle y USDT para Binance.
- "plataforma": "CITIBANK", "TD_BANK", "BINANCE_PAY", "BINANCE_P2P" o "BINANCE_ONCHAIN".
- "fecha": Fecha visible de la transacción en formato ISO YYYY-MM-DD (ej. "2026-11-15").
- "remitente": "" (dejar siempre cadena vacía, el usuario lo introduce manualmente).
- "referencia": Código de confirmación (ej. "o873zgxcu", "CITI992048112", "rjsnfkdk9", TxID o Order ID).
- "cuenta_destino": Correo electrónico, teléfono o Pay ID donde se recibió el dinero si aparece visible en la imagen.
- "confianza": Número entre 0.0 y 1.0 según la claridad de la imagen.
- "observaciones": Breve resumen de una línea en español de lo detectado.`;

  const completion = await openai.chat.completions.create({
    model: modelName || 'gpt-4o-mini',
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: promptSystem,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extrae con exactitud los datos de este comprobante de pago.',
          },
          {
            type: 'image_url',
            image_url: {
              url: base64DataUrl,
              detail: 'high',
            },
          },
        ],
      },
    ],
  });

  const rawJson = completion.choices[0]?.message?.content;
  if (!rawJson) {
    throw new Error('La respuesta de OpenAI Vision estuvo vacía.');
  }

  const parsed = JSON.parse(rawJson) as RawVisionAiResponse;
  const plataforma = normalizeDetectedPlatform(parsed.plataforma);
  const moneda = normalizeDetectedCurrency(parsed.moneda, plataforma);
  const monto = normalizeAmount(parsed.monto);

  return {
    monto,
    moneda,
    plataforma,
    fecha: (parsed.fecha ?? '').trim() || null,
    remitente: '', // Debe ser colocado obligatoriamente de forma manual por el usuario
    referencia: (parsed.referencia ?? '').trim(),
    cuenta_destino: parsed.cuenta_destino?.trim() || null,
    selected_account_id: null,
    confianza: typeof parsed.confianza === 'number' ? parsed.confianza : 0.92,
    observaciones:
      parsed.observaciones?.trim() ||
      'Comprobante analizado con OpenAI Vision con éxito.',
    metodo_ia: 'OPENAI_VISION',
  };
}

/**
 * Escanea un comprobante con Google Gemini Vision API (REST nativo).
 */
async function scanWithGeminiVision(
  base64DataUrl: string,
  apiKey: string,
  modelName: string
): Promise<ReceiptAiScanResult> {
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Formato Base64 inválido para Gemini.');
  }
  const mimeType = match[1];
  const base64Data = match[2];

  const validCustomModel =
    modelName &&
    !modelName.startsWith('gemini-3.') &&
    modelName !== 'gemini-1.5-flash'
      ? modelName
      : null;

  const candidateModels = Array.from(
    new Set(
      [
        validCustomModel,
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
      ].filter(Boolean) as string[]
    )
  );

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Eres un auditor FinTech de comprobantes bancarios Zelle y Binance. Analiza esta captura de pantalla de comprobante de pago y responde ÚNICAMENTE con un JSON con los siguientes campos:
{
  "monto": 20.00,
  "moneda": "USD",
  "plataforma": "CITIBANK",
  "fecha": "2026-11-15",
  "remitente": "",
  "referencia": "Codigo de confirmacion o TxID",
  "cuenta_destino": "correo o telefono receptor",
  "confianza": 0.95,
  "observaciones": "Comprobante identificado con exito"
}`,
          },
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  let lastError = '';
  let jsonResponse: {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  } | null = null;

  for (const targetModel of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        jsonResponse = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };
        break;
      }
      const errText = await response.text();
      lastError = `Error en Gemini Vision ${targetModel} (${response.status}): ${errText.slice(0, 150)}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Error de red con Gemini';
    }
  }

  if (!jsonResponse) {
    throw new Error(lastError || 'Gemini Vision no pudo procesar la imagen con ninguno de los modelos.');
  }

  const textOutput = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) {
    throw new Error('Gemini no devolvió texto en su respuesta.');
  }

  const cleanOutput = textOutput
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleanOutput) as RawVisionAiResponse;
  const plataforma = normalizeDetectedPlatform(parsed.plataforma);
  const moneda = normalizeDetectedCurrency(parsed.moneda, plataforma);
  const monto = normalizeAmount(parsed.monto);

  return {
    monto,
    moneda,
    plataforma,
    fecha: (parsed.fecha ?? '').trim() || null,
    remitente: '', // Debe ser colocado obligatoriamente de forma manual por el usuario
    referencia: (parsed.referencia ?? '').trim(),
    cuenta_destino: parsed.cuenta_destino?.trim() || null,
    selected_account_id: null,
    confianza: typeof parsed.confianza === 'number' ? parsed.confianza : 0.9,
    observaciones: parsed.observaciones?.trim() || 'Identificado con Gemini Vision.',
    metodo_ia: 'GEMINI_VISION',
  };
}

/**
 * Escanea un comprobante con Groq Cloud Vision (`llama-3.2-11b-vision-preview`).
 */
async function scanWithGroqVision(
  base64DataUrl: string,
  apiKey: string,
  modelName: string
): Promise<ReceiptAiScanResult> {
  const groq = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  const completion = await groq.chat.completions.create({
    model: modelName || 'llama-3.2-11b-vision-preview',
    temperature: 0.1,
    max_tokens: 500,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Eres un auditor FinTech de comprobantes bancarios Zelle y Binance. Analiza la imagen y extrae un JSON con: monto (numero), moneda ("USD" o "USDT"), plataforma ("CITIBANK", "TD_BANK", "BINANCE_PAY", "BINANCE_P2P" o "BINANCE_ONCHAIN"), fecha (string YYYY-MM-DD), remitente (""), referencia (string), cuenta_destino (string o null), confianza (numero de 0 a 1), observaciones (string).`,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extrae con exactitud los datos de este comprobante.' },
          { type: 'image_url', image_url: { url: base64DataUrl } },
        ],
      },
    ],
  });

  const rawJson = completion.choices[0]?.message?.content;
  if (!rawJson) {
    throw new Error('La respuesta de Groq Vision estuvo vacía.');
  }

  const clean = rawJson
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(clean) as RawVisionAiResponse;
  const plataforma = normalizeDetectedPlatform(parsed.plataforma);
  const moneda = normalizeDetectedCurrency(parsed.moneda, plataforma);
  const monto = normalizeAmount(parsed.monto);

  return {
    monto,
    moneda,
    plataforma,
    fecha: (parsed.fecha ?? '').trim() || null,
    remitente: '', // Debe ser colocado obligatoriamente de forma manual por el usuario
    referencia: (parsed.referencia ?? '').trim(),
    cuenta_destino: parsed.cuenta_destino?.trim() || null,
    selected_account_id: null,
    confianza: typeof parsed.confianza === 'number' ? parsed.confianza : 0.9,
    observaciones: parsed.observaciones?.trim() || 'Identificado con Groq Vision.',
    metodo_ia: 'OPENAI_VISION',
  };
}

/**
 * Función principal para escanear e identificar comprobantes de pago con IA.
 * Combina SVG extractor, Google Gemini, OpenAI Vision, Groq Vision y auto-asignación inteligente de cuentas.
 */
export async function scanReceiptWithAi(params: {
  comprobanteBase64: string;
  cuentasAsignadas?: AssignedReceivingAccount[];
}): Promise<{
  ok: boolean;
  detected: boolean;
  data: ReceiptAiScanResult;
  message: string;
}> {
  const { comprobanteBase64, cuentasAsignadas = [] } = params;

  if (!isAllowedRasterImageDataUrl(comprobanteBase64)) {
    return {
      ok: false,
      detected: false,
      data: {
        monto: null,
        moneda: 'USD',
        plataforma: 'CITIBANK',
        remitente: '',
        referencia: '',
        cuenta_destino: null,
        selected_account_id: null,
        confianza: 0,
        observaciones: 'Formato de imagen no permitido. Solo se aceptan capturas PNG, JPG o WEBP.',
        metodo_ia: 'MANUAL_FALLBACK',
      },
      message: 'Formato de comprobante inválido. Sube una imagen PNG, JPG o WEBP.',
    };
  }

  // 1. Obtener configuración de IA activa (se omite SVG por seguridad anti-falsificación)
  void tryExtractFromSvgDataUrl;
  const config = await getActiveAiConfig();

  // Función interna para intentar Gemini
  const tryGemini = async (): Promise<ReceiptAiScanResult | null> => {
    if (!config.gemini_api_key) return null;
    try {
      return await scanWithGeminiVision(
        comprobanteBase64,
        config.gemini_api_key,
        config.gemini_model
      );
    } catch (err: unknown) {
      console.error('[Gemini Vision Scan Error]:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  // Función interna para intentar OpenAI
  const tryOpenAi = async (): Promise<ReceiptAiScanResult | null> => {
    if (!config.openai_api_key) return null;
    try {
      return await scanWithOpenAiVision(
        comprobanteBase64,
        config.openai_api_key,
        config.openai_model
      );
    } catch (err: unknown) {
      console.error('[OpenAI Vision Scan Error]:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  // Función interna para intentar Groq
  const tryGroq = async (): Promise<ReceiptAiScanResult | null> => {
    if (!config.groq_api_key) return null;
    try {
      return await scanWithGroqVision(
        comprobanteBase64,
        config.groq_api_key,
        config.groq_model
      );
    } catch (err: unknown) {
      console.error('[Groq Vision Scan Error]:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  let scanResult: ReceiptAiScanResult | null = null;
  let providerUsed = '';

  if (config.ai_provider === 'gemini') {
    scanResult = await tryGemini();
    if (scanResult) providerUsed = 'Google Gemini Vision';
    if (!scanResult) {
      scanResult = await tryOpenAi();
      if (scanResult) providerUsed = 'OpenAI Vision';
    }
    if (!scanResult) {
      scanResult = await tryGroq();
      if (scanResult) providerUsed = 'Groq Cloud Vision';
    }
  } else if (config.ai_provider === 'groq') {
    scanResult = await tryGroq();
    if (scanResult) providerUsed = 'Groq Cloud Vision';
    if (!scanResult) {
      scanResult = await tryGemini();
      if (scanResult) providerUsed = 'Google Gemini Vision';
    }
    if (!scanResult) {
      scanResult = await tryOpenAi();
      if (scanResult) providerUsed = 'OpenAI Vision';
    }
  } else {
    // OpenAI por defecto
    scanResult = await tryOpenAi();
    if (scanResult) providerUsed = 'OpenAI Vision';
    if (!scanResult) {
      scanResult = await tryGemini();
      if (scanResult) providerUsed = 'Google Gemini Vision';
    }
    if (!scanResult) {
      scanResult = await tryGroq();
      if (scanResult) providerUsed = 'Groq Cloud Vision';
    }
  }

  if (scanResult) {
    autoMatchAssignedAccount(scanResult, cuentasAsignadas);
    return {
      ok: true,
      detected: true,
      data: scanResult,
      message: `¡Comprobante escaneado e identificado con Inteligencia Artificial (${providerUsed})!`,
    };
  }

  // 5. Fallback amigable cuando no hay llave configurada
  const defaultPlat = cuentasAsignadas[0]?.plataforma ?? 'CITIBANK';
  const defaultMon = cuentasAsignadas[0]?.moneda ?? 'USD';

  return {
    ok: true,
    detected: false,
    data: {
      monto: null,
      moneda: defaultMon,
      plataforma: defaultPlat,
      remitente: '',
      referencia: '',
      cuenta_destino: cuentasAsignadas[0]?.cuenta_receptora ?? null,
      selected_account_id: cuentasAsignadas[0]?.id ?? null,
      confianza: 0.3,
      observaciones:
        'Captura guardada. Para activación de lectura visual con IA en tiempo real, configura OPENAI_API_KEY en .env o en el panel administrativo.',
      metodo_ia: 'MANUAL_FALLBACK',
    },
    message:
      'Captura cargada. Por favor confirma o completa los datos del comprobante a continuación.',
  };
}

/**
 * Empareja automáticamente la cuenta asignada del cliente con los datos detectados por la IA.
 */
function autoMatchAssignedAccount(
  result: ReceiptAiScanResult,
  cuentasAsignadas: AssignedReceivingAccount[]
): void {
  if (cuentasAsignadas.length === 0) {
    return;
  }

  // Coincidencia 1: Por correo o cuenta receptora exacta o parcial
  if (result.cuenta_destino) {
    const cleanDestino = result.cuenta_destino.toLowerCase().trim();
    const matchedByDestino = cuentasAsignadas.find((acc) => {
      const rawAcc =
        acc.cuenta_receptora ||
        (acc as unknown as { identificador_cuenta?: string }).identificador_cuenta ||
        '';
      const cleanAcc = rawAcc.toLowerCase().trim();
      if (!cleanAcc || !cleanDestino) return false;
      return (
        cleanAcc === cleanDestino ||
        cleanAcc.includes(cleanDestino) ||
        cleanDestino.includes(cleanAcc)
      );
    });

    if (matchedByDestino) {
      result.selected_account_id = matchedByDestino.id;
      result.plataforma = matchedByDestino.plataforma;
      result.moneda = matchedByDestino.moneda;
      return;
    }
  }

  // Coincidencia 2: Por plataforma y moneda
  const matchedByPlatformAndCurrency = cuentasAsignadas.find(
    (acc) =>
      acc.plataforma === result.plataforma && acc.moneda === result.moneda
  );
  if (matchedByPlatformAndCurrency) {
    result.selected_account_id = matchedByPlatformAndCurrency.id;
    return;
  }

  // Coincidencia 3: Por plataforma solamente
  const matchedByPlatform = cuentasAsignadas.find(
    (acc) => acc.plataforma === result.plataforma
  );
  if (matchedByPlatform) {
    result.selected_account_id = matchedByPlatform.id;
    result.moneda = matchedByPlatform.moneda;
    return;
  }

  // Fallback: Primer cuenta asignada
  result.selected_account_id = cuentasAsignadas[0].id;
}
