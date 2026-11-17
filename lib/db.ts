import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';

// OID 1700 corresponde a NUMERIC / DECIMAL en PostgreSQL.
// Convertimos automáticamente a number de punto flotante para montos financieros de 2 decimales.
types.setTypeParser(1700, (value: string): number => Number.parseFloat(value));

declare global {
  // eslint-disable-next-line no-var
  var __fintechPgPool: Pool | undefined;
}

export type SqlPrimitive = string | number | boolean | Date | null | ReadonlyArray<string>;

function createPostgresPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'CRITICAL: La variable de entorno DATABASE_URL no está configurada para el Pool de PostgreSQL.'
    );
  }

  const maxConnections = Number.parseInt(process.env.PG_POOL_MAX ?? '20', 10);
  const sslEnabled = process.env.PG_SSL_ENABLED === 'true';

  const pool = new Pool({
    connectionString,
    max: Number.isFinite(maxConnections) ? maxConnections : 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    maxUses: 7_500,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    application_name: 'fintech-zelle-reconciliation-worker',
  });

  pool.on('error', (err: Error) => {
    console.error('[PostgreSQL Pool Error] Error inesperado en cliente inactivo:', err.message);
  });

  return pool;
}

/**
 * Obtiene la instancia Singleton del Pool de PostgreSQL.
 * En desarrollo reutiliza la referencia en `globalThis` para evitar agotar conexiones con HMR.
 */
export function getDbPool(): Pool {
  if (process.env.NODE_ENV === 'production') {
    if (!globalThis.__fintechPgPool) {
      globalThis.__fintechPgPool = createPostgresPool();
    }
    return globalThis.__fintechPgPool;
  }

  if (!globalThis.__fintechPgPool) {
    globalThis.__fintechPgPool = createPostgresPool();
  }

  return globalThis.__fintechPgPool;
}

/**
 * Ejecuta una consulta SQL parametrizada de forma segura contra inyección SQL.
 */
export async function dbQuery<TRow extends QueryResultRow>(
  sqlText: string,
  params: ReadonlyArray<SqlPrimitive> = []
): Promise<QueryResult<TRow>> {
  const pool = getDbPool();
  return pool.query<TRow>(sqlText, [...params]);
}

/**
 * Ejecuta múltiples operaciones dentro de una transacción ACID (`BEGIN` ... `COMMIT` / `ROLLBACK`).
 */
export async function withTransaction<TResult>(
  callback: (client: PoolClient) => Promise<TResult>
): Promise<TResult> {
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verifica si `DATABASE_URL` está definida y si el Pool responde.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    return false;
  }
  try {
    const pool = getDbPool();
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
