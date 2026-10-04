import type { ReactNode } from 'react';
import { describeEol } from '../../lib/format';
import type { Tone } from '../../types';

/**
 * Odznaka stanu.
 *
 * Prop to **ton**, nie zestaw klas. To celowe: wcześniej komponent przyjmował
 * dowolny string, więc każde miejsce musiało składać własną parę jasną
 * i ciemną — i rzadko to robiło poprawnie (odznaki ról na stronie
 * użytkowników miały wyłącznie klasy `dark:`). Typ `Tone` nie pozwala
 * podać klasy w ogóle, a kontrast tonów pilnuje test.
 */
export function Badge({
  tone,
  children,
  title,
  dot = true,
  className = '',
}: {
  tone: Tone;
  children: ReactNode;
  title?: string;
  /** Kropka pomaga skanować listę wzrokiem; wyłączamy tam, gdzie odznaka nie niesie stanu. */
  dot?: boolean;
  /**
   * Klasy z wyglądu, nie z koloru stanu.
   *
   * Używane tylko do rozmiaru (`text-[11px]`) w miejscach, gdzie odznaka
   * siedzi w gęstym wierszu tabeli i 12 px z `.badge` rozjeżdża ją z
   * otoczeniem. Koloru tu nie ma — ten przychodzi wyłącznie z `tone`,
   * bo `tone` jest jedynym sposobem na dobranie koloru, a `className`
   * byłby drugim zaprzeczeniem kontraktu z testu kontrastu.
   */
  className?: string;
}) {
  return (
    <span className={`badge tone-${tone} ${className}`} title={title}>
      {/* Kropka w kolorze tekstu odznaki — `bg-current` trzyma ją
          w kontraście pary bez osobnego tokenu. */}
      {dot && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-current opacity-75"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/**
 * Odznaka terminu wycofania — ton zależy od tego, ile zostało czasu.
 *
 * `describeEol` zwraca `ok` dla terminów dalej niż 90 dni, więc odznaka
 * jest wtedy zielona — ten sam ton co PROD. To świadome: `ok` znaczy
 * „termin bez problemu”, a nie „to jest produkcja”. Gdyby zielony
 * zaczął się kojarzyć z czymś innym niż stan, to `describeEol`, a nie
 * ta odznaka, jest miejscem do zmiany.
 *
 * Do zmiany zachowania z tonu na jaśniejszy szar wystarczy mapowanie
 * `ok` → `neutral` poniżej; wcześniej robił to `else` w trójdzielnym
 * warunku, który `ok` omijał.
 */
export function EolBadge({ date }: { date: string | null }) {
  if (!date) return null;

  const info = describeEol(date);
  if (!info) return null;

  return (
    <Badge
      tone={info.tone}
      dot={false}
      title={`Wycofanie: ${date}`}
    >
      {info.label}
    </Badge>
  );
}
