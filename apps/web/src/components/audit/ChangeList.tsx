import { fieldLabel, formatChangeValue } from '../../lib/audit-fields';
import { visibleChanges, truncatedFields, type AuditChanges } from '../../types';

/**
 * Lista zmian pól jednego wpisu w dzienniku.
 *
 * Dawniej skopiowana do `AuditPage` i `ApplicationDetailPage` — różniła
 * się tylko limitem pokazywanych pól. Kopia kosztowała rozjazd: zmiana
 * treści komunikatu o przycięciu w jednym pliku zostawiała drugi z
 * nieaktualnym tekstem, a testy nie renderują komponentów, więc nic by
 * tego nie wykryło.
 *
 * Limit jest parametrem, bo oba miejsca mają inne ograniczenia: strona
 * audytu to pełna lista (10), a szczegóły aplikacji mieszczą się w sekcji
 * bocznej i pokazują mniej (8).
 */
export function ChangeList({
  changes,
  limit = 10,
}: {
  changes: AuditChanges;
  limit?: number;
}) {
  const entries = visibleChanges(changes);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1.5 space-y-0.5">
      {entries.slice(0, limit).map(([field, change]) => (
        <li key={field} className="meta-text">
          <span className="font-medium text-fg">{fieldLabel(field)}</span>
          {': '}
          <span className="text-fg-muted line-through">
            {formatChangeValue(change.from)}
          </span>{' '}
          → <span className="text-fg">{formatChangeValue(change.to)}</span>
        </li>
      ))}
      {entries.length > limit && (
        <li className="text-xs text-fg-subtle">
          …i {entries.length - limit} innych pól
        </li>
      )}
      {changes._truncated && (
        <li className="text-xs text-amber-800 dark:text-amber-300">
          {truncatedFields(changes).length > 0 ? (
            <>
              Przycięto wartości pól:{' '}
              {truncatedFields(changes).map(fieldLabel).join(', ')}
              .
            </>
          ) : (
            'Zmiana była zbyt duża, żeby pokazać jej treść.'
          )}
        </li>
      )}
    </ul>
  );
}