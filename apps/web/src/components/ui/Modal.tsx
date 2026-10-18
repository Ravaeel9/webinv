import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconX } from './icons';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Element, który miał fokus przed otwarciem — wraca do niego po zamknięciu.
  const poprzedniFokus = useRef<HTMLElement | null>(null);

  // Escape zamyka okno. Nasłuch zaczyna się dopiero przy otwarciu,
  // żeby nie przejmować klawiszy w reszcie aplikacji.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);

    // Blokada przewijania tła — bez niej modal „ucieka” przy krótszym
    // ekranie niż treść okna.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Fokus na okno, żeby Escape i Tab działały od razu; zapamiętujemy,
    // skąd przyszedł — po zamknięciu wraca, a nie na <body>.
    poprzedniFokus.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      poprzedniFokus.current?.focus();
    };
  }, [open, onClose]);

  // Pułapka fokusu: Tab krąży po interaktywnych potomkach okna. Bez tego
  // klawiatura „wycieka” do strony pod modalem, której nie widać.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panelRef.current) return;

      const fokusebilne = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (fokusebilne.length === 0) return;

      const pierwszy = fokusebilne[0]!;
      const ostatni = fokusebilne[fokusebilne.length - 1]!;

      if (event.shiftKey && document.activeElement === pierwszy) {
        event.preventDefault();
        ostatni.focus();
      } else if (!event.shiftKey && document.activeElement === ostatni) {
        event.preventDefault();
        pierwszy.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const width =
    size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      {/* Przyciemnienie — kliknięcie zamyka */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative z-10 w-full ${width} animate-in-up rounded-xl
                    bg-surface shadow-xl focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            {description && (
              <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-fg-subtle
                       hover:bg-surface-2 hover:text-fg-muted"
          >
            <IconX className="size-5" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-2 border-t border-line bg-page px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
