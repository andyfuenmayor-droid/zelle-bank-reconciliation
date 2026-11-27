import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Newsreader } from 'next/font/google';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-newsreader',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ConciliarCuenta | Conciliación Multi-Canal Zelle & Binance',
  description:
    'Plataforma FinTech de conciliación automática de pagos Zelle (Citibank / TD Bank) y Binance (Pay / P2P / On-Chain) con Portal de Clientes y PostgreSQL puro.',
};

const THEME_INIT_SCRIPT = `(function(){try{var t=window.localStorage.getItem('conciliarcuenta_theme');if(t==='dark'){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.JSX.Element {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${newsreader.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased bg-[#FAF9F6] text-stone-900 dark:bg-[#121110] dark:text-stone-100 selection:bg-amber-700/20 selection:text-stone-900 dark:selection:bg-amber-500/25 dark:selection:text-stone-100">
        {children}
      </body>
    </html>
  );
}
