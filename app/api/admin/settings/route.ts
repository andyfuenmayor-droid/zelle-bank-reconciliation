import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { isDatabaseAvailable, dbQuery } from '@/lib/db';
import { getActiveAiConfig } from '@/lib/receipt-scanner';
import {
  checkRateLimit,
  encryptAtRest,
  requireSuperAdminSession,
} from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function maskApiKey(key: string | null | undefined): string {
  if (!key || key.length < 8) {
    return '';
  }
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = requireSuperAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const config = await getActiveAiConfig();

    return NextResponse.json({
      ok: true,
      hasOpenAiKey: Boolean(config.openai_api_key),
      openAiKeyPreview: maskApiKey(config.openai_api_key),
      openAiModel: config.openai_model,
      hasGeminiKey: Boolean(config.gemini_api_key),
      geminiKeyPreview: maskApiKey(config.gemini_api_key),
      geminiModel: config.gemini_model,
      hasGroqKey: Boolean(config.groq_api_key),
      groqKeyPreview: maskApiKey(config.groq_api_key),
      groqModel: config.groq_model,
      aiProvider: config.ai_provider,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error obteniendo configuración de IA';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

interface UpdateSettingsBody {
  action?: 'SAVE' | 'VERIFY';
  openai_api_key?: string;
  openai_model?: string;
  gemini_api_key?: string;
  gemini_model?: string;
  groq_api_key?: string;
  groq_model?: string;
  ai_provider?: 'gemini' | 'openai' | 'groq';
}

/**
 * Valida en vivo una API Key llamando a la API respectiva.
 */
async function verifyApiKeyLive(
  provider: 'gemini' | 'openai' | 'groq',
  apiKey: string
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const start = Date.now();
  const cleanKey = apiKey.trim();

  if (cleanKey.includes(' ') || cleanKey.length < 15) {
    return {
      ok: false,
      message: 'La clave ingresada contiene espacios o es demasiado corta para ser una API Key real.',
    };
  }

  if (provider === 'gemini') {
    const isGeminiFormat = cleanKey.startsWith('AIzaSy') || cleanKey.startsWith('AQ.');
    if (!isGeminiFormat) {
      return {
        ok: false,
        message: 'Una API Key de Google Gemini empieza por "AQ." o "AIzaSy...". Asegúrate de copiar la clave desde Google AI Studio.',
      };
    }
    const testModels = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash-preview',
      'gemini-flash-lite-latest',
    ];
    let lastError = '';
    let latencyMs = 0;

    for (const m of testModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${cleanKey}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
          }),
        });
        latencyMs = Date.now() - start;
        if (res.ok) {
          return {
            ok: true,
            message: `¡Conexión con Google Gemini exitosa (${m})! (Latencia: ${latencyMs}ms)`,
            latencyMs,
          };
        }
        lastError = await res.text();
        if (lastError.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')) {
          break;
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Error de conexión';
      }
    }

    if (lastError.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED')) {
      return {
        ok: false,
        message: 'Google rechazó la clave con ACCESS_TOKEN_TYPE_UNSUPPORTED. Esto ocurre cuando la clave tiene restricciones en Google Cloud. Solución: en aistudio.google.com/app/apikey haz clic en "Create API key in new project" (Crear clave en proyecto nuevo), o en Google Cloud Console > Credenciales desmarca restricciones.',
      };
    }
    return {
      ok: false,
      message: `Google Gemini rechazó la clave: ${lastError.slice(0, 150)}`,
    };
  }

  if (provider === 'groq') {
    if (!cleanKey.startsWith('gsk_')) {
      return {
        ok: false,
        message: 'Una API Key de Groq siempre empieza por "gsk_...". Asegúrate de copiarla desde console.groq.com.',
      };
    }
    const groq = new OpenAI({ apiKey: cleanKey, baseURL: 'https://api.groq.com/openai/v1' });
    await groq.models.list();
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      message: `¡Conexión con Groq Cloud verificada con éxito! (Latencia: ${latencyMs}ms)`,
      latencyMs,
    };
  }

  if (provider === 'openai') {
    if (!cleanKey.startsWith('sk-')) {
      return {
        ok: false,
        message: 'Una API Key de OpenAI siempre empieza por "sk-...". Asegúrate de copiarla desde platform.openai.com.',
      };
    }
    const openai = new OpenAI({ apiKey: cleanKey });
    await openai.models.list();
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      message: `¡Conexión con OpenAI verificada con éxito! (Latencia: ${latencyMs}ms)`,
      latencyMs,
    };
  }

  return { ok: false, message: 'Proveedor no soportado.' };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = requireSuperAdminSession(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  try {
    const body = (await request.json()) as UpdateSettingsBody;
    const action = body.action || 'SAVE';

    // Acción: VERIFY
    if (action === 'VERIFY') {
      const rl = checkRateLimit(`ai-verify:${auth.session.userId}`, 15, 10 * 60 * 1000);
      if (!rl.allowed) {
        return NextResponse.json(
          { ok: false, error: `Espera ${rl.retryAfterSec}s antes de probar otra clave.` },
          { status: 429 }
        );
      }
      const provider = body.ai_provider || 'gemini';
      const testKey =
        provider === 'gemini'
          ? body.gemini_api_key
          : provider === 'groq'
            ? body.groq_api_key
            : body.openai_api_key;

      if (!testKey || !testKey.trim()) {
        return NextResponse.json(
          { ok: false, error: 'Ingresa una clave para verificar.' },
          { status: 400 }
        );
      }

      const verifyResult = await verifyApiKeyLive(provider, testKey);
      return NextResponse.json({
        ok: verifyResult.ok,
        message: verifyResult.message,
        error: !verifyResult.ok ? verifyResult.message : undefined,
      });
    }

    // Acción: SAVE
    const dbLive = await isDatabaseAvailable();
    if (!dbLive) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Base de datos no disponible para guardar ajustes de IA en modo demo.',
        },
        { status: 503 }
      );
    }

    // Validación preventiva de formato de claves
    if (body.gemini_api_key) {
      const k = body.gemini_api_key.trim();
      const isGemini = k.startsWith('AIzaSy') || k.startsWith('AQ.');
      if (k.length > 0 && (!isGemini || k.includes(' '))) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Ese texto no es una clave de Google Gemini válida. La clave debe empezar por "AQ." o "AIzaSy..." sin espacios (obtenida en aistudio.google.com/app/apikey).',
          },
          { status: 400 }
        );
      }
    }

    if (body.openai_api_key) {
      const k = body.openai_api_key.trim();
      if (k.length > 0 && (!k.startsWith('sk-') || k.includes(' '))) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'La clave de OpenAI debe empezar por "sk-..." sin espacios.',
          },
          { status: 400 }
        );
      }
    }

    if (body.groq_api_key) {
      const k = body.groq_api_key.trim();
      if (k.length > 0 && (!k.startsWith('gsk_') || k.includes(' '))) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'La clave de Groq debe empezar por "gsk_..." sin espacios.',
          },
          { status: 400 }
        );
      }
    }

    // Asegurar tabla con columnas
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS system_ai_settings (
        id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
        ai_provider VARCHAR(30) NOT NULL DEFAULT 'gemini',
        openai_api_key TEXT,
        openai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
        gemini_api_key TEXT,
        gemini_model VARCHAR(50) NOT NULL DEFAULT 'gemini-3.5-flash-lite',
        groq_api_key TEXT,
        groq_model VARCHAR(50) NOT NULL DEFAULT 'llama-3.2-11b-vision-preview',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await dbQuery(`ALTER TABLE system_ai_settings ADD COLUMN IF NOT EXISTS groq_api_key TEXT;`);
    await dbQuery(`ALTER TABLE system_ai_settings ADD COLUMN IF NOT EXISTS groq_model VARCHAR(50) NOT NULL DEFAULT 'llama-3.2-11b-vision-preview';`);

    // Insertar o actualizar
    const current = await getActiveAiConfig();
    const newOpenAiKey =
      body.openai_api_key !== undefined
        ? body.openai_api_key.trim() || null
        : current.openai_api_key;
    const newOpenAiModel = body.openai_model?.trim() || current.openai_model || 'gpt-4o-mini';
    const newGeminiKey =
      body.gemini_api_key !== undefined
        ? body.gemini_api_key.trim() || null
        : current.gemini_api_key;
    const deprecatedGeminiModels = new Set([
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
    const newGeminiModel =
      body.gemini_model?.trim() ||
      (current.gemini_model &&
      !deprecatedGeminiModels.has(current.gemini_model.trim())
        ? current.gemini_model.trim()
        : 'gemini-3.5-flash-lite');
    const newGroqKey =
      body.groq_api_key !== undefined
        ? body.groq_api_key.trim() || null
        : current.groq_api_key;
    const newGroqModel = body.groq_model?.trim() || current.groq_model || 'llama-3.2-11b-vision-preview';
    const newProvider = body.ai_provider?.trim() || current.ai_provider || 'gemini';

    await dbQuery(
      `INSERT INTO system_ai_settings (id, ai_provider, openai_api_key, openai_model, gemini_api_key, gemini_model, groq_api_key, groq_model, updated_at)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         ai_provider = EXCLUDED.ai_provider,
         openai_api_key = EXCLUDED.openai_api_key,
         openai_model = EXCLUDED.openai_model,
         gemini_api_key = EXCLUDED.gemini_api_key,
         gemini_model = EXCLUDED.gemini_model,
         groq_api_key = EXCLUDED.groq_api_key,
         groq_model = EXCLUDED.groq_model,
         updated_at = NOW();`,
      [
        newProvider,
        encryptAtRest(newOpenAiKey),
        newOpenAiModel,
        encryptAtRest(newGeminiKey),
        newGeminiModel,
        encryptAtRest(newGroqKey),
        newGroqModel,
      ]
    );

    return NextResponse.json({
      ok: true,
      message: 'Configuración de Inteligencia Artificial actualizada con éxito.',
      hasOpenAiKey: Boolean(newOpenAiKey),
      openAiKeyPreview: maskApiKey(newOpenAiKey),
      openAiModel: newOpenAiModel,
      hasGeminiKey: Boolean(newGeminiKey),
      geminiKeyPreview: maskApiKey(newGeminiKey),
      geminiModel: newGeminiModel,
      hasGroqKey: Boolean(newGroqKey),
      groqKeyPreview: maskApiKey(newGroqKey),
      groqModel: newGroqModel,
      aiProvider: newProvider,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error guardando ajustes de IA';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
