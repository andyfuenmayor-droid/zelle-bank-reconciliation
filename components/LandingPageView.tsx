'use client';

import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Coins,
  DollarSign,
  LayoutDashboard,
  Lock,
  LogIn,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Wallet,
  Zap,
} from 'lucide-react';

interface LandingPageViewProps {
  onOpenLoginModal?: () => void;
  isAuthenticated?: boolean;
  onBackToDashboard?: () => void;
}

const SUPPORTED_CHANNELS: ReadonlyArray<{
  name: string;
  currency: 'USD' | 'USDT';
  desc: string;
  badgeClass: string;
}> = [
  {
    name: 'Citibank Zelle®',
    currency: 'USD',
    desc: 'Detección automática de transferencias Zelle entrantes en español e inglés con confirmación instantánea.',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  {
    name: 'TD Bank Zelle®',
    currency: 'USD',
    desc: 'Monitoreo continuo de alertas TD Bank y conciliación por referencia exacta o nombre del remitente.',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  {
    name: 'Binance Pay',
    currency: 'USDT',
    desc: 'Validación instantánea vía Pay ID / Transaction ID combinando notificaciones oficiales y API de Binance.',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  {
    name: 'Binance P2P',
    currency: 'USDT',
    desc: 'Conciliación automatizada de órdenes C2C completadas vinculadas directamente al número de orden.',
    badgeClass: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  },
  {
    name: 'Red USDT (TRC20 / BEP20 / ERC20)',
    currency: 'USDT',
    desc: 'Verificación de depósitos On-Chain mediante TxID con acreditación neta automática a la billetera del cliente.',
    badgeClass: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
  },
];

export default function LandingPageView({
  onOpenLoginModal,
  isAuthenticated = false,
  onBackToDashboard,
}: LandingPageViewProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Navegación superior */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="text-sm font-bold tracking-tight text-white sm:text-base">
                ConciliaPay FinTech
              </div>
              <div className="text-[11px] text-slate-400">
                Tesorería Multi-Canal Zelle &amp; Binance
              </div>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-xs font-medium text-slate-300 md:flex">
            <a
              href="#como-funciona"
              className="transition hover:text-emerald-400"
            >
              Cómo Funciona
            </a>
            <a href="#canales" className="transition hover:text-emerald-400">
              Canales Soportados
            </a>
            <a href="#seguridad" className="transition hover:text-emerald-400">
              Seguridad y Auditoría
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/portal"
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/20"
            >
              <Wallet className="h-3.5 w-3.5" />
              Portal Clientes
            </Link>

            {isAuthenticated && onBackToDashboard ? (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500"
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                Ir al Panel
              </button>
            ) : onOpenLoginModal ? (
              <button
                type="button"
                onClick={onOpenLoginModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500"
              >
                <LogIn className="h-3.5 w-3.5" />
                Acceso Negocios
              </button>
            ) : (
              <Link
                href="/?login=1"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-500"
              >
                <LogIn className="h-3.5 w-3.5" />
                Acceso Negocios
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Principal */}
      <section className="relative overflow-hidden border-b border-slate-800/80 bg-gradient-to-b from-slate-900/70 via-slate-950 to-slate-950 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              PLATAFORMA AUTOMATIZADA DE CONCILIACIÓN DE PAGOS
            </span>

            <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Conciliación Automática de Pagos{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-sky-400 bg-clip-text text-transparent">
                Zelle y Binance
              </span>{' '}
              en Tiempo Real
            </h1>

            <p className="mt-5 text-sm leading-relaxed text-slate-300 sm:text-base">
              Recibe pagos de terceros sin perder horas revisando capturas y
              correos bancarios. Nuestro motor verifica automáticamente cada
              depósito en Citibank, TD Bank y Binance, acredita el saldo neto de
              tus clientes al instante y mantiene cada negocio en su propio
              entorno privado.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
              <Link
                href="/portal"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-emerald-950/50 transition hover:bg-emerald-500"
              >
                <UploadCloud className="h-4 w-4" />
                Reportar Pago en Portal (/portal)
                <ArrowRight className="h-4 w-4" />
              </Link>

              {isAuthenticated && onBackToDashboard ? (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:border-emerald-500/50 hover:bg-slate-800"
                >
                  <LayoutDashboard className="h-4 w-4 text-emerald-400" />
                  Abrir Mi Panel de Negocio
                </button>
              ) : onOpenLoginModal ? (
                <button
                  type="button"
                  onClick={onOpenLoginModal}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:border-emerald-500/50 hover:bg-slate-800"
                >
                  <Building2 className="h-4 w-4 text-sky-400" />
                  Iniciar Sesión (Panel Negocios)
                </button>
              ) : (
                <Link
                  href="/?login=1"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:border-emerald-500/50 hover:bg-slate-800"
                >
                  <Building2 className="h-4 w-4 text-sky-400" />
                  Iniciar Sesión (Panel Negocios)
                </Link>
              )}
            </div>
          </div>

          {/* 3 tarjetas resumen */}
          <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <Zap className="h-5 w-5" />
                <h3 className="text-sm font-bold text-white">
                  Match Instantáneo
                </h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Cruce automático por moneda, monto exacto y referencia bancaria o
                Order ID/TxID en menos de 1 segundo.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2.5 text-sky-400">
                <DollarSign className="h-5 w-5" />
                <h3 className="text-sm font-bold text-white">
                  Portal Claro para Terceros
                </h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Cada cliente ve exactamente qué cuenta receptora tiene asignada,
                en qué moneda pagar (USD/USDT) y su saldo neto disponible.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2.5 text-amber-400">
                <Lock className="h-5 w-5" />
                <h3 className="text-sm font-bold text-white">
                  Cuentas Multi-Negocio
                </h3>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Crea cuentas independientes para distintos comercios o empresas,
                cada uno con sus propios buzones IMAP, clientes y reportes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section
        id="como-funciona"
        className="border-b border-slate-800/80 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              FLUJO OPERATIVO
            </span>
            <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
              Cómo funciona el servicio para tus clientes
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Un proceso sencillo, transparente y auditado desde que el tercero
              envía los fondos hasta que el cliente visualiza su saldo liquidable.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 font-mono text-sm font-bold text-emerald-300">
                01
              </div>
              <h3 className="mt-4 text-base font-bold text-white">
                El cliente envía el pago a la cuenta asignada
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Al entrar a <code>/portal</code> con su correo y PIN, visualiza la
                cuenta destino exacta asignada (por ejemplo Zelle Citibank o
                Binance USDT) con botón de copia rápida.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 font-mono text-sm font-bold text-sky-300">
                02
              </div>
              <h3 className="mt-4 text-base font-bold text-white">
                Sube la captura y datos del remitente
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                Reporta el monto exacto, el nombre del titular tercero que realizó
                la transferencia, el código de confirmación y adjunta el
                comprobante desde su teléfono.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 font-mono text-sm font-bold text-amber-300">
                03
              </div>
              <h3 className="mt-4 text-base font-bold text-white">
                Conciliación y acreditación automática
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                El motor cruza la alerta oficial del banco o Binance, descuenta
                la comisión configurada y acredita al instante el monto neto en
                USD o USDT en la billetera del cliente.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Canales soportados */}
      <section id="canales" className="border-b border-slate-800/80 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                COBERTURA MULTI-CANAL
              </span>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                Bancos y redes soportadas
              </h2>
            </div>
            <Link
              href="/portal"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              Ir al Portal de Clientes
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORTED_CHANNELS.map((ch) => (
              <div
                key={ch.name}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-slate-700"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold ${ch.badgeClass}`}
                  >
                    {ch.name}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-slate-300">
                    {ch.currency === 'USDT' ? (
                      <Coins className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <DollarSign className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                    {ch.currency}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-400">
                  {ch.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Seguridad y Auditoría */}
      <section id="seguridad" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 items-center gap-8 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900/80 to-emerald-950/20 p-6 sm:p-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                CONTROL Y TRAZABILIDAD FINTECH
              </span>
              <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                Cero duplicados, auditoría de capturas y control por negocio
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Cada movimiento recibido cuenta con llave única de idempotencia,
                respaldo visual del comprobante en alta resolución, cálculo
                inmutable de comisiones en PostgreSQL y acceso independiente por
                credenciales para cada negocio afiliado.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:col-span-5">
              <Link
                href="/portal"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-emerald-500"
              >
                <Wallet className="h-4 w-4" />
                Entrar al Portal de Clientes
              </Link>
              {isAuthenticated && onBackToDashboard ? (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:border-sky-500/50"
                >
                  <LayoutDashboard className="h-4 w-4 text-sky-400" />
                  Regresar al Panel de Administración
                </button>
              ) : onOpenLoginModal ? (
                <button
                  type="button"
                  onClick={onOpenLoginModal}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:border-sky-500/50"
                >
                  <LogIn className="h-4 w-4 text-sky-400" />
                  Acceso para Operadores y Negocios
                </button>
              ) : (
                <Link
                  href="/?login=1"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:border-sky-500/50"
                >
                  <LogIn className="h-4 w-4 text-sky-400" />
                  Acceso para Operadores y Negocios
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800/80 py-8 text-center text-xs text-slate-500">
        ConciliaPay FinTech · Plataforma Multi-Canal de Conciliación Zelle &amp;
        Binance
      </footer>
    </div>
  );
}
