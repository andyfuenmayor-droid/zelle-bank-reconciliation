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
  UploadCloud,
  Wallet,
  Zap,
} from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

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
    badgeClass:
      'border-stone-200 bg-stone-100 text-stone-800 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-200',
  },
  {
    name: 'TD Bank Zelle®',
    currency: 'USD',
    desc: 'Monitoreo continuo de alertas TD Bank y conciliación por referencia exacta o nombre del remitente.',
    badgeClass:
      'border-emerald-700/25 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  {
    name: 'Binance Pay',
    currency: 'USDT',
    desc: 'Validación instantánea vía Pay ID / Transaction ID combinando notificaciones oficiales y API de Binance.',
    badgeClass:
      'border-amber-700/25 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300',
  },
  {
    name: 'Binance P2P',
    currency: 'USDT',
    desc: 'Conciliación automatizada de órdenes C2C completadas vinculadas directamente al número de orden.',
    badgeClass:
      'border-amber-700/25 bg-amber-50/70 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300',
  },
  {
    name: 'Red USDT (TRC20 / BEP20 / ERC20)',
    currency: 'USDT',
    desc: 'Verificación de depósitos On-Chain mediante TxID con acreditación neta automática a la billetera del cliente.',
    badgeClass:
      'border-stone-300 bg-[#FAF9F6] text-stone-700 dark:border-stone-700 dark:bg-[#121110] dark:text-stone-300',
  },
];

export default function LandingPageView({
  onOpenLoginModal,
  isAuthenticated = false,
  onBackToDashboard,
}: LandingPageViewProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[#FAF9F6] text-stone-900 dark:bg-[#121110] dark:text-stone-100">
      {/* Cabecera Editorial */}
      <header className="sticky top-0 z-30 border-b border-stone-200/90 bg-[#FAF9F6]/90 backdrop-blur-sm dark:border-stone-800 dark:bg-[#121110]/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200">
              <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-500" strokeWidth={1.5} />
            </span>
            <div>
              <div className="font-serif text-lg font-medium leading-none tracking-tight text-stone-900 sm:text-xl dark:text-stone-100">
                ConciliarCuenta
              </div>
              <div className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                Tesorería Multi-Canal Zelle &amp; Binance
              </div>
            </div>
          </div>

          <nav className="hidden items-center gap-7 text-xs font-medium text-stone-600 md:flex dark:text-stone-400">
            <a
              href="#como-funciona"
              className="transition hover:text-stone-900 dark:hover:text-stone-100"
            >
              Cómo Funciona
            </a>
            <a
              href="#canales"
              className="transition hover:text-stone-900 dark:hover:text-stone-100"
            >
              Canales Soportados
            </a>
            <a
              href="#seguridad"
              className="transition hover:text-stone-900 dark:hover:text-stone-100"
            >
              Seguridad y Auditoría
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />

            <Link
              href="/portal"
              className="hidden items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 sm:inline-flex dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:border-stone-700"
            >
              <Wallet className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" strokeWidth={1.5} />
              Portal Clientes
            </Link>

            {isAuthenticated && onBackToDashboard ? (
              <button
                type="button"
                onClick={onBackToDashboard}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.5} />
                Ir al Panel
              </button>
            ) : onOpenLoginModal ? (
              <button
                type="button"
                onClick={onOpenLoginModal}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800 cursor-pointer dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />
                Acceso Negocios
              </button>
            ) : (
              <Link
                href="/?login=1"
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />
                Acceso Negocios
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Editorial */}
      <section className="border-b border-stone-200/90 py-16 sm:py-24 dark:border-stone-800">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-stone-200/90 bg-white px-3.5 py-1 text-[11px] font-medium uppercase tracking-widest text-amber-700 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18] dark:text-amber-500">
              Conciliación Bancaria &amp; Cripto de Precisión
            </span>

            <h1 className="mt-6 font-serif text-4xl font-medium tracking-tight text-stone-900 sm:text-5xl lg:text-[54px] lg:leading-[1.08] dark:text-stone-100">
              Conciliación automática de pagos{' '}
              <span className="italic text-amber-700 dark:text-amber-500">
                Zelle y Binance
              </span>{' '}
              en tiempo real
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-stone-600 sm:text-base dark:text-stone-400">
              Recibe pagos de terceros sin perder horas revisando capturas y
              correos bancarios. Nuestro motor verifica automáticamente cada
              depósito en Citibank, TD Bank y Binance, acredita el saldo neto de
              tus clientes al instante y mantiene cada negocio en su propio
              entorno privado.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/portal"
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-stone-50 shadow-sm transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                <UploadCloud className="h-4 w-4" strokeWidth={1.5} />
                Reportar Pago en Portal
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </Link>

              {isAuthenticated && onBackToDashboard ? (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-stone-50 cursor-pointer dark:border-stone-700 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-900"
                >
                  <LayoutDashboard className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  Abrir Mi Panel de Negocio
                </button>
              ) : onOpenLoginModal ? (
                <button
                  type="button"
                  onClick={onOpenLoginModal}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-stone-50 cursor-pointer dark:border-stone-700 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-900"
                >
                  <Building2 className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  Iniciar Sesión (Panel Negocios)
                </button>
              ) : (
                <Link
                  href="/?login=1"
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-stone-50 dark:border-stone-700 dark:bg-[#1C1A18] dark:text-stone-200 dark:hover:border-stone-600 dark:hover:bg-stone-900"
                >
                  <Building2 className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  Iniciar Sesión (Panel Negocios)
                </Link>
              )}
            </div>
          </div>

          {/* Franja Editorial de 3 Pilares con divisores hairline */}
          <div className="mt-16 overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
            <div className="grid grid-cols-1 divide-y divide-stone-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-stone-800">
              <div className="p-6">
                <div className="flex items-center gap-2.5">
                  <Zap className="h-4 w-4 text-amber-700 dark:text-amber-500" strokeWidth={1.5} />
                  <h3 className="font-serif text-base font-medium text-stone-900 dark:text-stone-100">
                    Match Instantáneo
                  </h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  Cruce automático por moneda, monto exacto y referencia bancaria o
                  Order ID/TxID en menos de 1 segundo.
                </p>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2.5">
                  <DollarSign className="h-4 w-4 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                  <h3 className="font-serif text-base font-medium text-stone-900 dark:text-stone-100">
                    Portal Claro para Terceros
                  </h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  Cada cliente ve exactamente qué cuenta receptora tiene asignada,
                  en qué moneda pagar (USD/USDT) y su saldo neto disponible.
                </p>
              </div>

              <div className="p-6">
                <div className="flex items-center gap-2.5">
                  <Lock className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  <h3 className="font-serif text-base font-medium text-stone-900 dark:text-stone-100">
                    Cuentas Multi-Negocio
                  </h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  Crea cuentas independientes para distintos comercios o empresas,
                  cada uno con sus propios buzones IMAP, clientes y reportes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Flujo Operativo */}
      <section
        id="como-funciona"
        className="border-b border-stone-200/90 py-16 sm:py-20 dark:border-stone-800"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <span className="text-[11px] font-medium uppercase tracking-widest text-amber-700 dark:text-amber-500">
              Flujo Operativo
            </span>
            <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl dark:text-stone-100">
              Cómo funciona el servicio para tus clientes
            </h2>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
              Un proceso sencillo, transparente y auditado desde que el tercero
              envía los fondos hasta que el cliente visualiza su saldo liquidable.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
            <div className="rounded-xl border border-stone-200/90 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-[#FAF9F6] font-mono text-xs font-semibold tabular-nums text-amber-700 dark:border-stone-700 dark:bg-[#121110] dark:text-amber-500">
                01
              </div>
              <h3 className="mt-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
                El cliente envía el pago a la cuenta asignada
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                Al entrar a{' '}
                <code className="rounded border border-stone-200 bg-[#FAF9F6] px-1 py-0.5 font-mono text-[11px] text-stone-700 dark:border-stone-700 dark:bg-[#121110] dark:text-stone-300">
                  /portal
                </code>{' '}
                con su correo y PIN, visualiza la cuenta destino exacta asignada
                (Zelle Citibank, TD Bank o Binance USDT) con copia rápida.
              </p>
            </div>

            <div className="rounded-xl border border-stone-200/90 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-[#FAF9F6] font-mono text-xs font-semibold tabular-nums text-amber-700 dark:border-stone-700 dark:bg-[#121110] dark:text-amber-500">
                02
              </div>
              <h3 className="mt-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
                Sube la captura y datos del remitente
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                Adjunta o pega el comprobante desde su teléfono o PC. El lector
                IA OCR extrae el monto exacto, el titular tercero y el código de
                confirmación automáticamente.
              </p>
            </div>

            <div className="rounded-xl border border-stone-200/90 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-[#1C1A18]">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-stone-200 bg-[#FAF9F6] font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:border-stone-700 dark:bg-[#121110] dark:text-emerald-400">
                03
              </div>
              <h3 className="mt-4 font-serif text-lg font-medium text-stone-900 dark:text-stone-100">
                Conciliación y acreditación automática
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                El motor cruza la alerta oficial del banco o Binance, descuenta
                la comisión configurada y acredita al instante el monto neto en
                USD o USDT en la libreta del cliente.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Canales Soportados */}
      <section
        id="canales"
        className="border-b border-stone-200/90 py-16 sm:py-20 dark:border-stone-800"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-widest text-amber-700 dark:text-amber-500">
                Cobertura Multi-Canal
              </span>
              <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl dark:text-stone-100">
                Bancos y redes soportadas
              </h2>
            </div>
            <Link
              href="/portal"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 transition hover:text-amber-800 dark:text-amber-500 dark:hover:text-amber-400"
            >
              Ir al Portal de Clientes
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORTED_CHANNELS.map((ch) => (
              <div
                key={ch.name}
                className="rounded-xl border border-stone-200/90 bg-white p-5 shadow-sm transition hover:border-stone-300 dark:border-stone-800 dark:bg-[#1C1A18] dark:hover:border-stone-700"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`inline-flex rounded-md border px-2.5 py-0.5 text-xs font-medium ${ch.badgeClass}`}
                  >
                    {ch.name}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                    {ch.currency === 'USDT' ? (
                      <Coins className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500" strokeWidth={1.5} />
                    ) : (
                      <DollarSign className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" strokeWidth={1.5} />
                    )}
                    {ch.currency}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
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
          <div className="grid grid-cols-1 items-center gap-8 rounded-2xl border border-stone-200/90 bg-white p-6 shadow-sm sm:p-10 lg:grid-cols-12 dark:border-stone-800 dark:bg-[#1C1A18]">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                Control y Trazabilidad FinTech
              </span>
              <h2 className="mt-2 font-serif text-2xl font-medium tracking-tight text-stone-900 sm:text-3xl dark:text-stone-100">
                Cero duplicados, auditoría de capturas y control por negocio
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-stone-600 dark:text-stone-400">
                Cada movimiento recibido cuenta con llave única de idempotencia,
                respaldo visual del comprobante en alta resolución, cálculo
                inmutable de comisiones en PostgreSQL y acceso independiente por
                credenciales para cada negocio afiliado.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:col-span-5">
              <Link
                href="/portal"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-stone-900 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-950 dark:hover:bg-white"
              >
                <Wallet className="h-4 w-4" strokeWidth={1.5} />
                Entrar al Portal de Clientes
              </Link>
              {isAuthenticated && onBackToDashboard ? (
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-[#FAF9F6] px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-white cursor-pointer dark:border-stone-700 dark:bg-[#121110] dark:text-stone-200 dark:hover:border-stone-600"
                >
                  <LayoutDashboard className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  Regresar al Panel de Administración
                </button>
              ) : onOpenLoginModal ? (
                <button
                  type="button"
                  onClick={onOpenLoginModal}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-[#FAF9F6] px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-white cursor-pointer dark:border-stone-700 dark:bg-[#121110] dark:text-stone-200 dark:hover:border-stone-600"
                >
                  <LogIn className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  Acceso para Operadores y Negocios
                </button>
              ) : (
                <Link
                  href="/?login=1"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-[#FAF9F6] px-5 py-3 text-sm font-medium text-stone-800 transition hover:border-stone-400 hover:bg-white dark:border-stone-700 dark:bg-[#121110] dark:text-stone-200 dark:hover:border-stone-600"
                >
                  <LogIn className="h-4 w-4 text-stone-500 dark:text-stone-400" strokeWidth={1.5} />
                  Acceso para Operadores y Negocios
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-200/90 py-8 text-center text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
        <span className="font-serif font-medium text-stone-700 dark:text-stone-300">
          ConciliarCuenta
        </span>{' '}
        · Plataforma Multi-Canal de Conciliación Zelle &amp; Binance
      </footer>
    </div>
  );
}
