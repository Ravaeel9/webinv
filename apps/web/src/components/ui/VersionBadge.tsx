import { appVersion } from '../../lib/version';

/**
 * Wersja wplatana do obrazu przez Makefile → compose → Dockerfile.
 * Pusta przy `vite dev`, które nie buduje obrazu.
 */
function buildVersion(): string | null {
  return appVersion(import.meta.env.VITE_APP_VERSION);
}

/**
 * Plakietka wersji w prawym dolnym rogu.
 *
 * Cel to zgłoszenia w stylu „widzę v1.1.0" — administrator musi móc
 * powiedzieć, jaką wersję ma uruchomioną. Dlatego wersja pochodzi
 * z buildu obrazu (`VITE_APP_VERSION`), a nie z API: jest wiarygodna
 * nawet wtedy, gdy backend nie odpowiada, i nie da się jej zmienić
 * z przeglądarki.
 *
 * `null` (czysty `vite dev`, bez ARG-a) nie renderuje nic — lepiej
 * brak plakietki niż „vundefined" w interfejsie.
 *
 * `z-20` celowo poniżej sticky nagłówka (`z-30`), żeby przy krótkiej
 * stronie i widocznym nagłówku plakietka nie przebijała go. Pady
 * `bottom-3 right-4` trzymają ją z dala od rogów przeglądarki.
 */
export function VersionBadge() {
  const version = buildVersion();
  if (!version) return null;

  return (
    <span
      // `pointer-events-none`, bo to informacja, a nie cel klikania —
      // bez tego blokowałaby kliknięcia w treść pod spodem.
      className="pointer-events-none fixed bottom-3 right-4 z-20 select-none
                 text-xs tabular-nums text-fg-muted/80"
      aria-label="Wersja aplikacji"
      title={`Rejestr Oprogramowania ${version}`}
    >
      {version}
    </span>
  );
}