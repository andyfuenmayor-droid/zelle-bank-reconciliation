'use client';

import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const THEME_STORAGE_KEY = 'conciliarcuenta_theme';

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className = '' }: ThemeToggleProps): React.JSX.Element {
  const [isDark, setIsDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  const handleToggle = (): void => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextDark ? 'dark' : 'light');
    } catch {
      // ignorar si storage no disponible
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? 'Cambiar a modo Papel Claro' : 'Cambiar a modo Grafito Oscuro'}
      title={isDark ? 'Cambiar a modo Papel Claro' : 'Cambiar a modo Grafito Oscuro'}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs font-medium text-stone-700 shadow-sm transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-[#1C1A18] dark:text-stone-300 dark:hover:border-stone-700 dark:hover:bg-stone-900 cursor-pointer ${className}`}
    >
      {mounted && isDark ? (
        <>
          <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />
          <span className="hidden sm:inline">Papel</span>
        </>
      ) : (
        <>
          <Moon className="h-3.5 w-3.5 text-stone-500" strokeWidth={1.5} />
          <span className="hidden sm:inline">Grafito</span>
        </>
      )}
    </button>
  );
}
