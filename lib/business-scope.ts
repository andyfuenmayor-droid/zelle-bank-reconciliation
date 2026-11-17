import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { dbQuery } from '@/lib/db';
import { BusinessUserRecord } from '@/types/reconciliation';

let schemaEnsured = false;

export function hashPasswordSha256(password: string): string {
  return crypto.createHash('sha256').update(password.trim()).digest('hex');
}

async function ensureMultiTenantColumnsAndTable(): Promise<void> {
  if (schemaEnsured) {
    return;
  }

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS usuarios_negocios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre_negocio VARCHAR(160) NOT NULL,
      nombre_usuario VARCHAR(140) NOT NULL,
      email VARCHAR(180) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      telefono VARCHAR(40),
      rol VARCHAR(30) NOT NULL DEFAULT 'NEGOCIO' CHECK (rol IN ('SUPER_ADMIN', 'NEGOCIO')),
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbQuery(
    'ALTER TABLE clientes_titulares ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;'
  );
  await dbQuery(
    'ALTER TABLE imap_monitored_accounts ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;'
  );
  await dbQuery(
    'ALTER TABLE ordenes_pago_pendientes ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;'
  );
  await dbQuery(
    'ALTER TABLE financial_transactions_reconciliation ADD COLUMN IF NOT EXISTS negocio_id UUID REFERENCES usuarios_negocios(id) ON DELETE CASCADE;'
  );

  schemaEnsured = true;
}

/**
 * Garantiza que exista el usuario/negocio principal (`SUPER_ADMIN`) y asigna
 * su `negocio_id` a cualquier registro existente sin negocio asignado.
 */
export async function ensureDefaultAdminBusinessUser(): Promise<BusinessUserRecord | null> {
  try {
    await ensureMultiTenantColumnsAndTable();

    const defaultEmail = (
      process.env.ADMIN_EMAIL ?? 'admin@conciliacion.com'
    )
      .trim()
      .toLowerCase();
    const defaultPassword = (
      process.env.ADMIN_PASSWORD ?? 'admin1234'
    ).trim();
    const defaultHash = hashPasswordSha256(defaultPassword);

    const existingCount = await dbQuery<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM usuarios_negocios;'
    );

    if ((existingCount.rows[0]?.total ?? 0) === 0) {
      await dbQuery(
        `
        INSERT INTO usuarios_negocios (
          nombre_negocio,
          nombre_usuario,
          email,
          password_hash,
          telefono,
          rol,
          activo
        )
        VALUES ($1, $2, $3, $4, $5, 'SUPER_ADMIN', TRUE)
        ON CONFLICT (email) DO NOTHING;
        `,
        [
          'Operadora Principal',
          'Administrador Principal',
          defaultEmail,
          defaultHash,
          null,
        ]
      );
    }

    const adminRes = await dbQuery<BusinessUserRecord>(
      `
      SELECT
        id,
        nombre_negocio,
        nombre_usuario,
        email,
        telefono,
        rol,
        activo,
        last_login_at,
        created_at
      FROM usuarios_negocios
      WHERE activo = TRUE
      ORDER BY CASE WHEN rol = 'SUPER_ADMIN' THEN 0 ELSE 1 END, created_at ASC
      LIMIT 1;
      `
    );

    const primaryAdmin = adminRes.rows[0] ?? null;
    if (primaryAdmin) {
      await Promise.all([
        dbQuery(
          'UPDATE imap_monitored_accounts SET negocio_id = $1::uuid WHERE negocio_id IS NULL;',
          [primaryAdmin.id]
        ),
        dbQuery(
          'UPDATE clientes_titulares SET negocio_id = $1::uuid WHERE negocio_id IS NULL;',
          [primaryAdmin.id]
        ),
        dbQuery(
          'UPDATE ordenes_pago_pendientes SET negocio_id = $1::uuid WHERE negocio_id IS NULL;',
          [primaryAdmin.id]
        ),
        dbQuery(
          'UPDATE financial_transactions_reconciliation SET negocio_id = $1::uuid WHERE negocio_id IS NULL;',
          [primaryAdmin.id]
        ),
      ]);
    }

    return primaryAdmin;
  } catch {
    return null;
  }
}

export async function listBusinessUsersWithCounts(): Promise<
  BusinessUserRecord[]
> {
  await ensureDefaultAdminBusinessUser();

  const res = await dbQuery<BusinessUserRecord>(
    `
    SELECT
      u.id,
      u.nombre_negocio,
      u.nombre_usuario,
      u.email,
      u.telefono,
      u.rol,
      u.activo,
      u.last_login_at,
      u.created_at,
      (
        SELECT COUNT(*)::int
        FROM imap_monitored_accounts m
        WHERE m.negocio_id = u.id
      ) AS mailboxes_count,
      (
        SELECT COUNT(*)::int
        FROM clientes_titulares c
        WHERE c.negocio_id = u.id
      ) AS clients_count,
      (
        SELECT COUNT(*)::int
        FROM financial_transactions_reconciliation t
        WHERE t.negocio_id = u.id
      ) AS transactions_count
    FROM usuarios_negocios u
    ORDER BY CASE WHEN u.rol = 'SUPER_ADMIN' THEN 0 ELSE 1 END, u.created_at ASC;
    `
  );

  return res.rows;
}

export async function resolveRequestNegocioScope(
  request: NextRequest,
  explicitNegocioId?: string | null
): Promise<{ negocioId: string | null; isPrimaryAdmin: boolean }> {
  const primaryAdmin = await ensureDefaultAdminBusinessUser();
  const { searchParams } = new URL(request.url);
  const candidateId = (
    explicitNegocioId ??
    request.headers.get('x-negocio-id') ??
    searchParams.get('negocioId') ??
    ''
  ).trim();

  if (candidateId) {
    try {
      const checkRes = await dbQuery<{ id: string; rol: string }>(
        `
        SELECT id, rol
        FROM usuarios_negocios
        WHERE id = $1::uuid AND activo = TRUE
        LIMIT 1;
        `,
        [candidateId]
      );
      const found = checkRes.rows[0];
      if (found) {
        return {
          negocioId: found.id,
          isPrimaryAdmin: found.rol === 'SUPER_ADMIN',
        };
      }
    } catch {
      // Si el UUID no es válido o no existe, usar principal
    }
  }

  return {
    negocioId: primaryAdmin?.id ?? null,
    isPrimaryAdmin: primaryAdmin?.rol === 'SUPER_ADMIN',
  };
}
