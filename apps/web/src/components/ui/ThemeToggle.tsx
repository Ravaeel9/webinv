import { useTheme, type ThemeChoice } from '../../lib/theme';
import { IconMonitor, IconMoon, IconSun } from './icons';

/**
 * Przełącznik motywu: jasny → ciemny → systemowy → jasny…
 *
 * Ikona pokazuje bieżące ustawienie, a `title` zapowiada, co będzie
 * po kliknięciu — bez rozwijanego menu, a pełny dostęp do trzech
 * stanów, które obsługuje `ThemeProvider`.
 */

const ORDER: ThemeChoice[] = ['light', 'dark', 'system'];

const LABELS: Record<ThemeChoice, string> = {
  light: 'jasny',
  dark: 'ciemny',
  system: 'systemowy',
};

const ICONS: Record<ThemeChoice, typeof IconSun> = {
  light: IconSun,
  dark: IconMoon,
  system: IconMonitor,
};

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { choice, setChoice } = useTheme();

  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
  const Icon = ICONS[choice];

  return (
    <button
      type="button"
      onClick={() => setChoice(next)}
      title={`Motyw ${LABELS[choice]} — kliknij, aby przełączyć na ${LABELS[next]}`}
      aria-label={`Przełącz motyw. Obecnie: ${LABELS[choice]}. Kliknij, aby ustawić ${LABELS[next]}.`}
      className={[
        'rounded-lg p-2 text-fg-muted transition-colors',
        'hover:bg-surface-2 hover:text-fg',
        className,
      ].join(' ')}
    >
      <Icon className="size-5" />
    </button>
  );
}
