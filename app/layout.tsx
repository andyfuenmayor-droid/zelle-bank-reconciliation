import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Conciliación Bancaria Zelle & Transferencias | Citibank & TD Bank',
  description:
    'Módulo FinTech de conciliación automática de pagos Zelle y transferencias vía IMAP, Regex + AI Fallback y PostgreSQL puro.',
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
