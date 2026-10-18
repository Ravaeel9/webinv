import { useEffect, useRef, useState } from 'react';
import { IconCheck } from './icons';

/** Kopiuje tekst do schowka, krótko potwierdzając stanem ikony. */
function useKopiuj(tekst: string) {
  const [skopiowano, setSkopiowano] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const kopiuj = async () => {
    try {
      await navigator.clipboard.writeText(tekst);
    } catch {
      // Clipboard API bywa niedostępne (http, uprawnienia) — ostatnia
      // deska ratunku, działająca wszędzie poza Safari.
      const pole = document.createElement('textarea');
      pole.value = tekst;
      document.body.appendChild(pole);
      pole.select();
      document.execCommand('copy');
      pole.remove();
    }
    setSkopiowano(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSkopiowano(false), 2000);
  };

  return { kopiuj, skopiowano };
}

/**
 * Przycisk „skopiuj do schowka” dla wartości, które administrator
 * i tak zaznaczałby myszką: adres IP, CIDR, e-mail, URL.
 *
 * Ikona sama zamienia się na ptaszka na dwie sekundy — feedback jest
 * w miejscu akcji, bez toastu, bo kopiowanie bywa seryjne (pięć adresów
 * pod rząd), a pięć toastów to hałas.
 */
export function CopyButton({
  value,
  label,
  className = '',
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { kopiuj, skopiowano } = useKopiuj(value);
  const opis = label ?? `Kopiuj ${value}`;

  return (
    <button
      type="button"
      onClick={() => void kopiuj()}
      aria-label={opis}
      title={opis}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md
                  text-fg-subtle hover:bg-surface-2 hover:text-fg-muted ${className}`}
    >
      {skopiowano ? (
        <IconCheck className="size-3.5 text-ok" aria-hidden="true" />
      ) : (
        <svg
          className="size-3.5"
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="13" height="13" x="9" y="9" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
