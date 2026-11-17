import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { dbQuery, isDatabaseAvailable } from '@/lib/db';
import {
  ensureDefaultAdminBusinessUser,
  hashPasswordSha256,
  listBusinessUsersWithCounts,
} from '@/lib/business-scope';
import { DemoBusinessUserInternal, getDemoStore } from '@/lib/mock-seed-data';
import { BusinessUserRecord, BusinessUserRole } from '@/types/reconciliation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mapDemoBusinessUserWithCounts(
  u: DemoBusinessUserInternal
): BusinessUserRecord {
  const store = getDemoStore();
  const { password_plain: _ignored, ...publicUser } = u;
  void _ignored;

  return {
    ...publicUser,
    mailboxes_count: 0,
    clients_count: store.clients.filter(
      (c) => (c.negocio_id ?? store.businessUsers[0]?.id) === u.id
    ).length,
    transactions_count: store.transactions.filter(
      (t) => (t.negocio_id ?? store.businessUsers[0]?.id) === u.id
    ).length,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId')?.trim() ?? '';

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: 'El parámetro userId es obligatorio.' },
      { status: 400 }
    );
  }

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    const store = getDemoStore();
    const matched = store.businessUsers.find(
      (u) => u.id === userId && u.activo
    );
    if (!matched) {
      return NextResponse.json(
        { ok: false, error: 'Sesión de negocio no encontrada.' },
        { status: 404 }
      );
    }

    const mappedUser = mapDemoBusinessUserWithCounts(matched);
    const allMapped = store.businessUsers.map(mapDemoBusinessUserWithCounts);

    return NextResponse.json({
      ok: true,
      mode: 'DEMO_FALLBACK',
      user: mappedUser,
      businessUsers:
        mappedUser.rol === 'SUPER_ADMIN' ? allMapped : [mappedUser],
    });
  }

  try {
    await ensureDefaultAdminBusinessUser();
    const allUsers = await listBusinessUsersWithCounts();
    const matched = allUsers.find((u) => u.id === userId && u.activo);

    if (!matched) {
      return NextResponse.json(
        { ok: false, error: 'Cuenta de negocio no encontrada o inactiva.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      mode: 'POSTGRESQL_LIVE',
      user: matched,
      businessUsers: matched.rol === 'SUPER_ADMIN' ? allUsers : [matched],
    });
  } catch (error: unknown) {
    const msg =
      error instanceof Error
        ? error.message
        : 'Error consultando sesión de negocio.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

interface BusinessAuthPostBody {
  action?: 'LOGIN' | 'CREATE_BUSINESS_USER' | 'UPDATE_BUSINESS_USER';
  userId?: string;
  email?: string;
  password?: string;
  nombreNegocio?: string;
  nombreUsuario?: string;
  telefono?: string;
  rol?: BusinessUserRole;
  activo?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as BusinessAuthPostBody;
    const action = body.action ?? 'LOGIN';
    const dbConnected = await isDatabaseAvailable();

    if (action === 'LOGIN') {
      const email = (body.email ?? '').trim().toLowerCase();
      const password = (body.password ?? '').trim();

      if (!email || !email.includes('@')) {
        return NextResponse.json(
          { ok: false, error: 'Ingresa un correo electrónico válido.' },
          { status: 400 }
        );
      }

      if (password.length < 4) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Ingresa la contraseña de acceso (mínimo 4 caracteres).',
          },
          { status: 400 }
        );
      }

      if (!dbConnected) {
        const store = getDemoStore();
        const matched = store.businessUsers.find(
          (u) =>
            u.email.toLowerCase() === email &&
            u.password_plain === password &&
            u.activo
        );
        if (!matched) {
          return NextResponse.json(
            {
              ok: false,
              error:
                'Credenciales inválidas. Verifica el correo y la contraseña del negocio.',
            },
            { status: 401 }
          );
        }

        matched.last_login_at = new Date().toISOString();
        const mappedUser = mapDemoBusinessUserWithCounts(matched);
        const allMapped = store.businessUsers.map(mapDemoBusinessUserWithCounts);

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          user: mappedUser,
          businessUsers:
            mappedUser.rol === 'SUPER_ADMIN' ? allMapped : [mappedUser],
        });
      }

      await ensureDefaultAdminBusinessUser();
      const passwordHash = hashPasswordSha256(password);

      const authRes = await dbQuery<{ id: string }>(
        `
        UPDATE usuarios_negocios
        SET last_login_at = NOW()
        WHERE LOWER(email) = LOWER($1)
          AND password_hash = $2
          AND activo = TRUE
        RETURNING id;
        `,
        [email, passwordHash]
      );

      const userId = authRes.rows[0]?.id;
      if (!userId) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Correo o contraseña incorrectos. Verifica tus datos de acceso.',
          },
          { status: 401 }
        );
      }

      const allUsers = await listBusinessUsersWithCounts();
      const loggedUser = allUsers.find((u) => u.id === userId);
      if (!loggedUser) {
        return NextResponse.json(
          { ok: false, error: 'Usuario de negocio no disponible.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        user: loggedUser,
        businessUsers:
          loggedUser.rol === 'SUPER_ADMIN' ? allUsers : [loggedUser],
      });
    }

    if (action === 'CREATE_BUSINESS_USER') {
      const nombreNegocio = (body.nombreNegocio ?? '').trim();
      const nombreUsuario = (body.nombreUsuario ?? '').trim();
      const email = (body.email ?? '').trim().toLowerCase();
      const telefono = (body.telefono ?? '').trim() || null;
      const password = (body.password ?? '').trim();
      const rol: BusinessUserRole =
        body.rol === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'NEGOCIO';

      if (nombreNegocio.length < 2) {
        return NextResponse.json(
          { ok: false, error: 'El nombre del negocio es obligatorio.' },
          { status: 400 }
        );
      }
      if (nombreUsuario.length < 2) {
        return NextResponse.json(
          { ok: false, error: 'El nombre del usuario responsable es obligatorio.' },
          { status: 400 }
        );
      }
      if (!email || !email.includes('@')) {
        return NextResponse.json(
          { ok: false, error: 'El correo de inicio de sesión es obligatorio.' },
          { status: 400 }
        );
      }
      if (password.length < 4) {
        return NextResponse.json(
          {
            ok: false,
            error: 'La contraseña debe tener al menos 4 caracteres.',
          },
          { status: 400 }
        );
      }

      if (!dbConnected) {
        const store = getDemoStore();
        const duplicate = store.businessUsers.find(
          (u) => u.email.toLowerCase() === email
        );
        if (duplicate) {
          return NextResponse.json(
            { ok: false, error: `Ya existe un usuario con el correo ${email}.` },
            { status: 409 }
          );
        }

        const created: DemoBusinessUserInternal = {
          id: crypto.randomUUID(),
          nombre_negocio: nombreNegocio,
          nombre_usuario: nombreUsuario,
          email,
          telefono,
          rol,
          password_plain: password,
          activo: true,
          last_login_at: null,
          created_at: new Date().toISOString(),
        };
        store.businessUsers.push(created);

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          user: mapDemoBusinessUserWithCounts(created),
          businessUsers: store.businessUsers.map(mapDemoBusinessUserWithCounts),
        });
      }

      await ensureDefaultAdminBusinessUser();

      const dupCheck = await dbQuery<{ id: string }>(
        'SELECT id FROM usuarios_negocios WHERE LOWER(email) = LOWER($1) LIMIT 1;',
        [email]
      );
      if (dupCheck.rows[0]) {
        return NextResponse.json(
          { ok: false, error: `Ya existe un negocio registrado con ${email}.` },
          { status: 409 }
        );
      }

      const passwordHash = hashPasswordSha256(password);
      const insertRes = await dbQuery<{ id: string }>(
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
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id;
        `,
        [nombreNegocio, nombreUsuario, email, passwordHash, telefono, rol]
      );

      const createdId = insertRes.rows[0]?.id;
      const allUsers = await listBusinessUsersWithCounts();
      const createdUser = allUsers.find((u) => u.id === createdId) ?? null;

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        user: createdUser,
        businessUsers: allUsers,
      });
    }

    if (action === 'UPDATE_BUSINESS_USER') {
      const userId = (body.userId ?? '').trim();
      const nombreNegocio = (body.nombreNegocio ?? '').trim();
      const nombreUsuario = (body.nombreUsuario ?? '').trim();
      const email = (body.email ?? '').trim().toLowerCase();
      const telefono = (body.telefono ?? '').trim() || null;
      const password = (body.password ?? '').trim();
      const activo = body.activo !== false;

      if (!userId) {
        return NextResponse.json(
          { ok: false, error: 'El identificador del usuario es obligatorio.' },
          { status: 400 }
        );
      }
      if (nombreNegocio.length < 2 || nombreUsuario.length < 2) {
        return NextResponse.json(
          {
            ok: false,
            error: 'El nombre del negocio y el del usuario son obligatorios.',
          },
          { status: 400 }
        );
      }
      if (!email || !email.includes('@')) {
        return NextResponse.json(
          { ok: false, error: 'El correo electrónico es obligatorio.' },
          { status: 400 }
        );
      }
      if (password.length > 0 && password.length < 4) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Si cambias la contraseña, debe tener al menos 4 caracteres.',
          },
          { status: 400 }
        );
      }

      if (!dbConnected) {
        const store = getDemoStore();
        const target = store.businessUsers.find((u) => u.id === userId);
        if (!target) {
          return NextResponse.json(
            { ok: false, error: 'Cuenta de negocio no encontrada.' },
            { status: 404 }
          );
        }
        const conflict = store.businessUsers.find(
          (u) => u.id !== userId && u.email.toLowerCase() === email
        );
        if (conflict) {
          return NextResponse.json(
            { ok: false, error: `Otro negocio ya usa el correo ${email}.` },
            { status: 409 }
          );
        }

        target.nombre_negocio = nombreNegocio;
        target.nombre_usuario = nombreUsuario;
        target.email = email;
        target.telefono = telefono;
        if (password.length > 0) {
          target.password_plain = password;
        }
        if (target.rol !== 'SUPER_ADMIN') {
          target.activo = activo;
          if (body.rol === 'SUPER_ADMIN' || body.rol === 'NEGOCIO') {
            target.rol = body.rol;
          }
        }

        return NextResponse.json({
          ok: true,
          mode: 'DEMO_FALLBACK',
          user: mapDemoBusinessUserWithCounts(target),
          businessUsers: store.businessUsers.map(mapDemoBusinessUserWithCounts),
        });
      }

      await ensureDefaultAdminBusinessUser();

      const conflictCheck = await dbQuery<{ id: string }>(
        `
        SELECT id FROM usuarios_negocios
        WHERE id <> $1::uuid AND LOWER(email) = LOWER($2)
        LIMIT 1;
        `,
        [userId, email]
      );
      if (conflictCheck.rows[0]) {
        return NextResponse.json(
          { ok: false, error: `Otro negocio ya usa el correo ${email}.` },
          { status: 409 }
        );
      }

      const passwordHash =
        password.length > 0 ? hashPasswordSha256(password) : null;
      const rolParam =
        body.rol === 'SUPER_ADMIN' || body.rol === 'NEGOCIO' ? body.rol : null;

      const updateRes = await dbQuery<{ id: string }>(
        `
        UPDATE usuarios_negocios
        SET nombre_negocio = $2,
            nombre_usuario = $3,
            email = $4,
            telefono = $5,
            password_hash = COALESCE($6, password_hash),
            rol = CASE WHEN rol = 'SUPER_ADMIN' THEN 'SUPER_ADMIN' ELSE COALESCE($7, rol) END,
            activo = CASE WHEN rol = 'SUPER_ADMIN' THEN TRUE ELSE $8 END
        WHERE id = $1::uuid
        RETURNING id;
        `,
        [
          userId,
          nombreNegocio,
          nombreUsuario,
          email,
          telefono,
          passwordHash,
          rolParam,
          activo,
        ]
      );

      if (!updateRes.rows[0]) {
        return NextResponse.json(
          { ok: false, error: 'Cuenta de negocio no encontrada.' },
          { status: 404 }
        );
      }

      const allUsers = await listBusinessUsersWithCounts();
      const updatedUser = allUsers.find((u) => u.id === userId) ?? null;

      return NextResponse.json({
        ok: true,
        mode: 'POSTGRESQL_LIVE',
        user: updatedUser,
        businessUsers: allUsers,
      });
    }

    return NextResponse.json(
      { ok: false, error: 'Acción no reconocida.' },
      { status: 400 }
    );
  } catch (error: unknown) {
    const msg =
      error instanceof Error
        ? error.message
        : 'Error procesando autenticación de negocio.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id')?.trim() ?? '';

  if (!id) {
    return NextResponse.json(
      { ok: false, error: 'Se requiere el id del usuario/negocio.' },
      { status: 400 }
    );
  }

  const dbConnected = await isDatabaseAvailable();
  if (!dbConnected) {
    const store = getDemoStore();
    const target = store.businessUsers.find((u) => u.id === id);
    if (!target) {
      return NextResponse.json(
        { ok: false, error: 'Cuenta de negocio no encontrada.' },
        { status: 404 }
      );
    }
    if (target.rol === 'SUPER_ADMIN') {
      return NextResponse.json(
        {
          ok: false,
          error: 'No se puede eliminar la cuenta del Administrador Principal.',
        },
        { status: 403 }
      );
    }
    store.businessUsers = store.businessUsers.filter((u) => u.id !== id);
    return NextResponse.json({ ok: true, mode: 'DEMO_FALLBACK' });
  }

  try {
    const check = await dbQuery<{ rol: string }>(
      'SELECT rol FROM usuarios_negocios WHERE id = $1::uuid LIMIT 1;',
      [id]
    );
    const target = check.rows[0];
    if (!target) {
      return NextResponse.json(
        { ok: false, error: 'Cuenta de negocio no encontrada.' },
        { status: 404 }
      );
    }
    if (target.rol === 'SUPER_ADMIN') {
      return NextResponse.json(
        {
          ok: false,
          error: 'No se puede eliminar la cuenta del Administrador Principal.',
        },
        { status: 403 }
      );
    }

    await dbQuery('DELETE FROM usuarios_negocios WHERE id = $1::uuid;', [id]);
    return NextResponse.json({ ok: true, mode: 'POSTGRESQL_LIVE' });
  } catch (error: unknown) {
    const msg =
      error instanceof Error ? error.message : 'Error eliminando negocio.';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
