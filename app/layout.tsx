import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Conciliación Multi-Canal Zelle & Binance | Portal FinTech',
  description:
    'Plataforma FinTech de conciliación automática de pagos Zelle (Citibank / TD Bank) y Binance (Pay / P2P / On-Chain) con Portal de Clientes y PostgreSQL puro.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html lang="es" className="dark">
      <body className="antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
