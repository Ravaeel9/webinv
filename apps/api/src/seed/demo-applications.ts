import type {
  AppStatus,
  DeliveryType,
  Prisma,
  SecurityClass,
  SupportChannel,
  SupportOwnerType,
} from '@prisma/client';
import { DEMO_SERVICES } from './demo-services';

/**
 * Zestaw dwudziestu programów na stanowisko do obejrzenia interfejsu.
 *
 * Dane demonstracyjne wypełniają bazę przy starcie, ale **wyłącznie
 * gdy `SEED_DEMO_APPS=true`** — patrz `SeedService`. Bez tej bramki
 * pierwszy start na pustej bazie wypełniłby ją dwudziestoma programami
 * do odinstalowania.
 *
 * Kształt danych nie jest przypadkowy:
 *
 *  - **Statusy, klasyfikacje i krytyczność pokrywają całe listy.** Brak
 *    którejkolwiek wartości oznacza wariant, którego nigdy nie widać
 *    w UI, więc filtry i kafelki na pulpicie nie da się sprawdzić.
 *  - **Wszystkie pola są wypełnione**, bo rekord z pustym polem wygląda
 *    jak błąd, którego nikt nie popełnił. Wyjątkiem są trzy pola blokujące
 *    sekcję „Dostęp i wsparcie" dla typów innych niż `GENERAL_USE` —
 *    dla tych rekordów nie są nigdy renderowane, więc wypełnianie ich
 *    wprowadzałoby dane, których nie da się zobaczyć.
 *  - **`sunsetOn` tylko przy `DEPRECATED`.** Data przy aktywnym programie
 *    wywołuje na stronie ostrzeżenie o terminie, którego nie ma.
 *  - **Kontakt do wsparcia zgadza się z `supportOwnerType`.** Wsparcie
 *    dostawcy musi prowadzić do dostawcy — inaczej rekord kieruje
 *    człowieka do działu, który problemu nie obsługuje.
 *
 * Nazwa jest `@unique`, więc seed upsertuje po nazwie: powtórny start
 * kontenera aktualizuje te rekordy, nie mnoży ich.
 */

/**
 * Rekord demo w kształcie DTO, plus nazwy środowisk.
 *
 * Środowiska trzymamy jako nazwy, a nie identyfikatory, bo te dane
 * powstają w kodzie, a nie z formularza — `seedEnvironments` zapewnia,
 * że nazwy te istnieją, i seed rozwiązuje je do identyfikatorów.
 *
 * Typy pól to enumy Prisma, nie `string`. Dzięki temu zapis nie
 * wymaga rzutowania, a dopasowanie nazwy pola do kolumny sprawdza
 * kompilator: literówka w `sunsetOn` pada w `tsc`, a nie dopiero przy
 * starcie kontenera.
 */
export type DemoApplication = {
  name: string;
  version: string;
  description: string;
  purpose: string;
  integrations: string;
  ownerEmail: string;
  introducedOn: string;
  sunsetOn?: string;
  securityClass: SecurityClass;
  criticality: number;
  status: AppStatus;
  accessRequestRequired: boolean;
  deliveryType: DeliveryType;
  vendor: string;
  license: string;
  licenseCount: number;
  annualCost: number;
  supportOwnerType: SupportOwnerType;
  supportOwnerName: string;
  supportEmail: string;
  supportUrl: string;
  supportChannel: SupportChannel;
  supportNotes: string;
  websiteUrl: string;
  docsUrl: string;
  repoUrl: string;
  runbookUrl: string;
  environments: string[];
};

/**
 * Domena organizacji w tym zestawie.
 *
 * Jedna domena dla wszystkich właścicieli — właściciel jest po naszej
 * stronie. Adresy wsparcia dostawców są obce celowo i mają inne domeny,
 * bo wsparcie po stronie dostawcy musi prowadzić do dostawcy.
 */
const ORG = 'firma.pl';

/** Adres wsparcia wewnętrznego — wszystkie pola `supportOwnerType: INTERNAL`. */
const HELP = `helpdesk@${ORG}`;

export const DEMO_APPLICATIONS: DemoApplication[] = [
  {
    name: 'Mozilla Firefox',
    version: '131.0',
    description:
      'Przeglądarka internetowa z wersją ESR, utrzymywaną przez Mozilla ' +
      'przez około rok. Wersja ESR otrzymuje poprawki bezpieczeństwa ' +
      'i stabilne aktualizacje, a nie częste funkcje eksperymentalne.',
    purpose:
      'Domyślna przeglądarka na stanowiskach. Wybrana dlatego, że ' +
      'aktualizacje przychodzą bez restartu przeglądarki, a dodatki ' +
      'korporacyjne można wymusić polityką bez ruszania profilu użytkownika.',
    integrations:
      'Uwierzytelnianie przez SSO, przekierowanie ruchu do proxy firmowego, ' +
      'wdrożone rozszerzenia z katalogu aplikacji (uBlock Origin, 1Password).',
    ownerEmail: `it.przegladarka@${ORG}`,
    introducedOn: '2019-03-11',
    securityClass: 'PUBLIC',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Mozilla Foundation',
    license: 'MPL 2.0',
    licenseCount: 250,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Mozilla Foundation',
    supportEmail: 'security@mozilla.org',
    supportUrl: 'https://www.mozilla.org/pl/firefox/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Zgłoszenia bezpieczeństwa przez program Mozilla Security Bug Bounty. ' +
      'Zmianę wersji koordynuje dział IT raz w miesiącu.',
    websiteUrl: 'https://www.mozilla.org/pl/firefox/',
    docsUrl: 'https://firefox-source-docs.mozilla.org/',
    repoUrl: 'https://github.com/mozilla-firefox/firefox',
    runbookUrl: `${'https://intranet.' + ORG}/runbook/firefox`,
    environments: ['Produkcja'],
  },
  {
    name: '7-Zip',
    version: '23.01',
    description:
      'Archiwizator obsługujący format 7z oraz, przy instalacji rozszerzeń, ' +
      'zip, tar, gzip i inne. W systemie zastępuje wbudowaną kompresję, ' +
      'która nie obsługuje archiwów 7z.',
    purpose:
      'Rozpakowywanie i pakowanie archiwów przesyłanych przez dział ' +
      'zaopatrzenia i przez kontrahentów. Bez niego część plików od ' +
      'dostawców nie da się otworzyć.',
    integrations:
      'Integracja z Powłoką (menu kontekstowe), obsługa archiwów szyfrowanych ' +
      'AES-256.',
    ownerEmail: `it.narzedzia@${ORG}`,
    introducedOn: '2018-06-04',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Igor Pavlov',
    license: 'LGPL 2.1 z wyjątkiem powszechnym',
    licenseCount: 250,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Dział IT',
    supportEmail: HELP,
    supportUrl: `https://intranet.${ORG}/narzedzia`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Instalacja przez menedżer pakietów firmowego, nie ręcznie — ' +
      'ręczna instalacja zostaje nadpisana przy kolejnej aktualizacji.',
    websiteUrl: 'https://www.7-zip.org/',
    docsUrl: 'https://www.7-zip.org/documentation.html',
    repoUrl: 'https://github.com/ip7z/7zip',
    runbookUrl: `https://intranet.${ORG}/runbook/7zip`,
    environments: ['Produkcja'],
  },
  {
    name: 'VLC media player',
    version: '3.0.21',
    description:
      'Odtwarzacz multimediów obsługujący praktycznie wszystkie ' +
      'formaty spotykane w nagraniach ze spotkań i w materiałach szkoleniowych.',
    purpose:
      'Odtwarzanie nagrań ze spotkań, materiałów szkoleniowych i plików ' +
      'przysyłanych przez dział marketingu.',
    integrations: 'Brak integracji z systemami wewnętrznymi.',
    ownerEmail: `it.narzedzia@${ORG}`,
    introducedOn: '2019-11-20',
    securityClass: 'PUBLIC',
    criticality: 1,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'VideoLAN',
    license: 'LGPL 2.1+',
    licenseCount: 250,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Dział IT',
    supportEmail: HELP,
    supportUrl: `https://intranet.${ORG}/narzedzia`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Aplikacja nie jest blokowana przez proxy, ale nie ma integracji ' +
      'z biblioteką firmową i nie jest objęta automatycznymi aktualizacjami.',
    websiteUrl: 'https://www.videolan.org/vlc/',
    docsUrl: 'https://docs.videolan.me/vlc-user/3.0/',
    repoUrl: 'https://code.videolan.org/videolan/vlc',
    runbookUrl: `https://intranet.${ORG}/runbook/vlc`,
    environments: ['Produkcja'],
  },
  {
    name: 'LibreOffice',
    version: '24.2.5',
    description:
      'Pakiet biurowy: edytor tekstu, arkusz kalkulacyjny, prezentacje ' +
      'i baza danych. Formaty Microsoft Office otwiera bez utraty układu ' +
      'dla prostych dokumentów, co bywa wystarczające.',
    purpose:
      'Praca na dokumentach tam, gdzie licencja Microsoft Office nie ' +
      'przysługuje użytkownikowi, oraz formatowanie i druk dokumentów ' +
      'wewnętrznych. Do edycji plików .docx i .xlsx z pełną zgodnością ' +
      'służy Microsoft 365.',
    integrations:
      'Szablony firmowe w katalogu współdzielonym, druk na ' +
      'drukarce sieciowej działu, brak synchronizacji dokumentów.',
    ownerEmail: `it.biuro@${ORG}`,
    introducedOn: '2021-01-18',
    securityClass: 'PUBLIC',
    criticality: 2,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'The Document Foundation',
    license: 'MPL 2.0',
    licenseCount: 150,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'The Document Foundation',
    supportEmail: 'help@documentfoundation.org',
    supportUrl: 'https://pl.libreoffice.org/pomoc/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Znane ograniczenie: pliki z zaawansowaną numeracją, polami formularzy ' +
      'i makrami tracą układ przy edycji. Takie pliki wypada przekazać ' +
      'do Microsoft 365.',
    websiteUrl: 'https://www.libreoffice.org/',
    docsUrl: 'https://help.libreoffice.org/latest/pl/',
    repoUrl: 'https://git.libreoffice.org/core',
    runbookUrl: `https://intranet.${ORG}/runbook/libreoffice`,
    environments: ['Produkcja'],
  },
  {
    name: 'Notepad++',
    version: '8.7',
    description:
      'Lekki edytor tekstu z podświetlaniem składni dla kilkudziesięciu ' +
      'języków. Wbudowany menedżer wtyczek, między innymi do porównywania ' +
      'plików i do pracy z dużymi logami.',
    purpose:
      'Podgląd i drobne edycje plików konfiguracyjnych, logów oraz ' +
      'plików tekstowych dostarczanych przez kontrahentów.',
    integrations:
      'Narzędzia linii poleceń z PATH, obsługa BOM i kodowań, ' +
      'wtyczka Compare.',
    ownerEmail: `it.narzedzia@${ORG}`,
    introducedOn: '2019-05-30',
    securityClass: 'PUBLIC',
    criticality: 1,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Don Ho',
    license: 'GPL 3.0',
    licenseCount: 200,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Dział IT',
    supportEmail: HELP,
    supportUrl: `https://intranet.${ORG}/narzedzia`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Instalacja centralna. Użytkownicy mogą dodawać wtyczki sami, ' +
      'co czasem kończy się konfliktem przy aktualizacji — wtedy ' +
      'rolę instalatora przejmuje dział IT.',
    websiteUrl: 'https://notepad-plus-plus.org/',
    docsUrl: 'https://npp-user-manual.org/',
    repoUrl: 'https://github.com/notepad-plus-plus/notepad-plus-plus',
    runbookUrl: `https://intranet.${ORG}/runbook/notepad-plus-plus`,
    environments: ['Produkcja'],
  },
  {
    name: 'KeePassXC',
    version: '2.7.7',
    description:
      'Menedżer haseł z lokalną bazą i synchronizacją pliku między ' +
      'urządzeniami. Uwierzytelnianie do bazy kluczem głównym i opcjonalnie ' +
      'czynnikiem drugim.',
    purpose:
      'Przechowywanie poświadczeń do systemów, które nie mają logowania ' +
      'scentralizowanego. Hasła systemowe zarządza dostępem do Active Directory ' +
      'i nie powinny tu trafiać.',
    integrations:
      'Autouzupełnianie w przeglądarce, integracja z kluczem sprzętowym ' +
      'YubiKey, plik bazy na dysku sieciowym.',
    ownerEmail: `it.bezpieczenstwo@${ORG}`,
    introducedOn: '2021-09-07',
    securityClass: 'CONFIDENTIAL',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: true,
    deliveryType: 'GENERAL_USE',
    vendor: 'KeePassXC',
    license: 'GPL 2.0',
    licenseCount: 40,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół bezpieczeństwa',
    supportEmail: `bezpieczenstwo@${ORG}`,
    supportUrl: `https://intranet.${ORG}/bezpieczenstwo/hasla`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Dostęp po wniosek, bo baza haseł zasługuje na świadomą decyzję ' +
      'kierownika. Plik bazy trzymany na udziale sieciowym z szyfrowaniem ' +
      'i retencją 10 wersji.',
    websiteUrl: 'https://keepassxc.org/',
    docsUrl: 'https://keepassxc.org/docs/',
    repoUrl: 'https://github.com/keepassxreboot/keepassxc',
    runbookUrl: `https://intranet.${ORG}/runbook/keepassxc`,
    environments: ['Produkcja'],
  },
  {
    name: 'Mozilla Thunderbird',
    version: '128.0',
    description:
      'Klient poczty e-mail z obsługą wielu kont, filtrów serwerowych ' +
      'i rozszerzeń. Obsługuje podpisywanie i szyfrowanie wiadomości.',
    purpose:
      'Poczta dla użytkowników, którzy potrzebują kilku skrzynek ' +
      'jednocześnie albo reguł sortujących, których nie da się opisać ' +
      'w filtrach serwera.',
    integrations:
      'Uwierzytelnianie OAuth, firmowy certyfikat S/MIME, ' +
      'wtyczka synchronizacji kalendarza.',
    ownerEmail: `it.poczta@${ORG}`,
    introducedOn: '2022-06-02',
    securityClass: 'CONFIDENTIAL',
    criticality: 2,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Mozilla Foundation',
    license: 'MPL 2.0',
    licenseCount: 90,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Mozilla Foundation',
    supportEmail: 'support@mozilla.org',
    supportUrl: 'https://support.mozilla.org/pl/products/thunderbird',
    supportChannel: 'PORTAL',
    supportNotes:
      'Wersje ESR aktualizowane co kwartał. Migracja z klienta ' +
      'firmowego planowana na IV kwartał, projekt w rejestrze jako PLANNED.',
    websiteUrl: 'https://www.thunderbird.net/pl/',
    docsUrl: 'https://support.mozilla.org/pl/products/thunderbird',
    repoUrl: 'https://github.com/thunderbird/thunderbird-android',
    runbookUrl: `https://intranet.${ORG}/runbook/thunderbird`,
    environments: ['Produkcja'],
  },
  {
    name: 'Visual Studio Code',
    version: '1.94',
    description:
      'Edytor kodu i plików tekstowych z rozszerzeniami. Na stanowiskach ' +
      'analitycznych używany głównie do pisania zapytań SQL i przeglądania ' +
      'plików konfiguracyjnych.',
    purpose:
      'Praca z zapytaniami SQL, przeglądanie repozytoriów aplikacji ' +
      'i redakcja dokumentacji technicznej.',
    integrations:
      'Rozszerzenie firmowe z motywem i zestawem snippetów, ' +
      'połączenie z bazą przez rozszerzenie SQLTools, dostęp do repozytoriów ' +
      'przez token serwisowy.',
    ownerEmail: `it.narzedzia@${ORG}`,
    introducedOn: '2023-01-16',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Microsoft Corporation',
    license: 'MIT (program) + licencje rozszerzeń',
    licenseCount: 60,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Microsoft Corporation',
    supportEmail: 'vssupport@microsoft.com',
    supportUrl: 'https://code.visualstudio.com/docs',
    supportChannel: 'PORTAL',
    supportNotes:
      'Rozszerzenia instalowane z katalogu firmowego. Użytkownicy nie ' +
      'mają uprawnień do instalowania wtyczek spoza katalogu — ' +
      'to najczęstsza przyczyna zgłoszeń „brak funkcji”.',
    websiteUrl: 'https://code.visualstudio.com/',
    docsUrl: 'https://code.visualstudio.com/docs',
    repoUrl: 'https://github.com/microsoft/vscode',
    runbookUrl: `https://intranet.${ORG}/runbook/vscode`,
    environments: ['Produkcja', 'Test'],
  },
  {
    name: 'DBeaver Community',
    version: '24.2.0',
    description:
      'Klient baz danych z obsługą PostgreSQL, MySQL, Oracle i SQL Server. ' +
      'Wersja Community ma ograniczenia edycji schematu, których nie ' +
      'potrzebujemy — dostęp mamy tylko do odczytu.',
    purpose:
      'Podgląd danych i weryfikacja zapytań raportowych bez obciążania ' +
      'środowiska produkcyjnego.',
    integrations:
      'Połączenia z bazą przez certyfikat firmowy, brak zapisu zmian ' +
      'w trybie tylko do odczytu.',
    ownerEmail: `it.bazy@${ORG}`,
    introducedOn: '2022-10-03',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: true,
    deliveryType: 'GENERAL_USE',
    vendor: 'DBeaver Ltd.',
    license: 'Apache 2.0',
    licenseCount: 20,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'DBeaver Ltd.',
    supportEmail: 'support@dbeaver.io',
    supportUrl: 'https://dbeaver.io/docs/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Dostęp po wniosek, bo narzędzie łączy się z bazą produkcyjną. ' +
      'Połączenia tylko przez bastion, bez dostępu do internetu.',
    websiteUrl: 'https://dbeaver.io/',
    docsUrl: 'https://dbeaver.io/docs/',
    repoUrl: 'https://github.com/dbeaver/dbeaver',
    runbookUrl: `https://intranet.${ORG}/runbook/dbeaver`,
    environments: ['Produkcja', 'Preprodukcja'],
  },
  {
    name: 'WinSCP',
    version: '6.3',
    description:
      'Klient SFTP i FTP z dwupanelowym interfejsem oraz synchronizacją ' +
      'katalogów. Obsługuje także sesje przez PuTTY.',
    purpose:
      'Przesyłanie plików na serwery dostawców i na maszyny wirtualne, ' +
      'gdzie nie ma dostępu do pulpitu zdalnego.',
    integrations:
      'Klucze SSH przechowywane w menedżerze haseł, konfiguracja ' +
      'współdzielona przez katalog firmowy.',
    ownerEmail: `it.infrastruktura@${ORG}`,
    introducedOn: '2020-08-25',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: true,
    deliveryType: 'GENERAL_USE',
    vendor: 'Martin Prikryl',
    license: 'GPL 2.0',
    licenseCount: 15,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół infrastruktury',
    supportEmail: `infrastruktura@${ORG}`,
    supportUrl: `https://intranet.${ORG}/infrastruktura/dostejnie`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Dostęp po wniosek. Hasła nie są zapisywane w pliku konfiguracyjnym ' +
      '— klucze w menedżerze haseł, sesje krótkie, z logowaniem.',
    websiteUrl: 'https://winscp.net/',
    docsUrl: 'https://winscp.net/eng/docs',
    repoUrl: 'https://github.com/winscp/winscp',
    runbookUrl: `https://intranet.${ORG}/runbook/winscp`,
    environments: ['Produkcja'],
  },
  {
    name: 'Zoom Workplace',
    version: '5.17.5',
    description:
      'Klient wideokonferencji z obsługą spotkań, nagrań i transkrypcji. ' +
      'Mamy licencję na konta firmowe; spotkania odbywają się na serwerach ' +
      'firmowych.',
    purpose:
      'Spotkania wewnętrzne, spotkania z kontrahentami i szkolenia. ' +
      'Nagrania trafiają na udział firmowy z 180-dniową retencją.',
    integrations:
      'Kalendarz firmowy, automatyczne dołączanie do spotkań, ' +
      'uwierzytelnianie SSO, integracja z systemem rezerwacji sal.',
    ownerEmail: `it.komunikacja@${ORG}`,
    introducedOn: '2021-03-08',
    securityClass: 'CONFIDENTIAL',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Zoom Video Communications',
    license: 'sublicencja enterprise',
    licenseCount: 300,
    annualCost: 48000,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Zoom Video Communications',
    supportEmail: 'support@zoom.us',
    supportUrl: 'https://support.zoom.com/',
    supportChannel: 'CHAT',
    supportNotes:
      'Najważniejsza pozycja w rejestrze: spotkania z klientami ' +
      'i zatrzymanie pracy przy awarii są kosztowne. Umowa serwisowa ' +
      'przeglądana corocznie, płatność w IV kwartale.',
    websiteUrl: 'https://zoom.us/',
    docsUrl: 'https://support.zoom.com/hc/en',
    repoUrl: 'https://github.com/zoom',
    runbookUrl: `https://intranet.${ORG}/runbook/zoom`,
    environments: ['Produkcja', 'Preprodukcja'],
  },
  {
    name: 'Microsoft Teams',
    version: '2408.4',
    description:
      'Komunikacja zespołowa w pakiecie Microsoft 365: czat, spotkania, ' +
      'pliki i tablica. Na stanowiskach, gdzie działa Microsoft 365, ' +
      'to domyślne narzędzie komunikacji.',
    purpose:
      'Spotkania, czat i udostępnianie dokumentów. Slack pozostaje ' +
      'w kanałach, które powstały przed wdrożeniem Microsoft 365.',
    integrations:
      'Tożsamość firmowa, Exchange, OneDrive, kalendarz i książka ' +
      'adresowa z Microsoft 365.',
    ownerEmail: `it.komunikacja@${ORG}`,
    introducedOn: '2023-04-24',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Microsoft Corporation',
    license: 'licencja Microsoft 365 E3',
    licenseCount: 300,
    annualCost: 108000,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Microsoft Corporation',
    supportEmail: 'servicedesk@partner.microsoftonline.com',
    supportUrl: 'https://support.microsoft.com/teams',
    supportChannel: 'PORTAL',
    supportNotes:
      'Obejmuje tożsamość, Exchange i licencje — nie kupuje się osobno. ' +
      'Kanały dublujące Slacka planujemy scalić do końca roku.',
    websiteUrl: 'https://www.microsoft.com/microsoft-teams/',
    docsUrl: 'https://support.microsoft.com/pl/teams',
    repoUrl: 'https://github.com/microsoft/teams-ai',
    runbookUrl: `https://intranet.${ORG}/runbook/teams`,
    environments: ['Produkcja'],
  },
  {
    name: 'Jira Software',
    version: '9.12',
    description:
      'Narzędzie do zarządzania pracą: zadania, sprinty, tablica i ' +
      'integracja z repozytorium kodu oraz z systemem ciągłej integracji.',
    purpose:
      'Rejestr zadań zespołów produktowych i utrzymania. Planowanie ' +
      'i raporty statusowe dla kierownictwa czytane są z tablic, ' +
      'nie z osobnych arkuszy.',
    integrations:
      'Integracja z repozytorium i CI, automatyczne zamykanie zadań ' +
      'przy scaleniu zmian, autoryzacja przez firmową tożsamość.',
    ownerEmail: `it.narzedzia@${ORG}`,
    introducedOn: '2019-09-30',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Atlassian',
    license: 'licencja premium 500 użytkowników',
    licenseCount: 500,
    annualCost: 26000,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Atlassian',
    supportEmail: 'support@atlassian.com',
    supportUrl: 'https://support.atlassian.com/jira-software-cloud/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Licencja droższa od użycia — 180 zalogowanych użytkowników ' +
      'przy 500 licencjach. Przegląd wykorzystania przed odnowieniem ' +
      'jest warunkiem zamówienia.',
    websiteUrl: 'https://www.atlassian.com/software/jira',
    docsUrl: 'https://support.atlassian.com/jira-software-cloud/',
    repoUrl: 'https://bitbucket.org/atlassian/jira-software',
    runbookUrl: `https://intranet.${ORG}/runbook/jira`,
    environments: ['Produkcja'],
  },
  {
    name: 'Pandoc',
    version: '3.5',
    description:
      'Konwerter formatów dokumentów uruchamiany z wiersza poleceń. ' +
      'Pracuje na plikach, nie ma własnego okna.',
    purpose:
      'Konwersja materiałów szkoleniowych z Markdowna do PDF i do formatu ' +
      'akceptowanego przez system szkoleniowy.',
    integrations:
      'Wywoływane ze skryptu budującego materiały, szablon firmowy LaTeX, ' +
      'eksport do katalogu szkoleniowego.',
    ownerEmail: `szkolenia@${ORG}`,
    introducedOn: '2023-08-30',
    securityClass: 'PUBLIC',
    criticality: 1,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'John MacFarlane',
    license: 'GPL 2.0',
    licenseCount: 20,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół szkoleniowy',
    supportEmail: `szkolenia@${ORG}`,
    supportUrl: `https://intranet.${ORG}/szkolenia/materialy`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Wymaga osobnej instalacji silnika PDF na stanowiskach redaktorów. ' +
      'Bez niej konwersja do PDF kończy się pustym plikiem.',
    websiteUrl: 'https://pandoc.org/',
    docsUrl: 'https://pandoc.org/MANUAL.html',
    repoUrl: 'https://github.com/jgm/pandoc',
    runbookUrl: `https://intranet.${ORG}/runbook/pandoc`,
    environments: ['Produkcja', 'Deweloperskie'],
  },
  {
    name: 'OBS Studio',
    version: '30.2',
    description:
      'Nagrywanie ekranu i transmisje na żywo ze scenami, źródłami ' +
      'obrazu i dźwięku oraz nagrywaniem równoległym kilku ścieżek.',
    purpose:
      'Nagrywanie materiałów szkoleniowych i prezentacji, ' +
      'bez nagrywania zawartości ekranów z poufnymi danymi — dlatego ' +
      'przed nagraniem obowiązuje tryb prywatności włączany na ekranie.',
    integrations:
      'Przechwytywanie dźwięku z systemu, nagrywanie na dysku współdzielonym, ' +
      'brak automatycznej transmisji.',
    ownerEmail: `szkolenia@${ORG}`,
    introducedOn: '2024-02-19',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'TEST',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'OBS Project',
    license: 'GPL 2.0',
    licenseCount: 8,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół szkoleniowy',
    supportEmail: `szkolenia@${ORG}`,
    supportUrl: `https://intranet.${ORG}/szkolenia/materialy`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Pilotaż na ośmiu stanowiskach. Do wdrożenia na całym dziale ' +
      'brakuje procedury czyszczenia nagrań i miejsca na nie ' +
      'przechowywane z kontrolą dostępu.',
    websiteUrl: 'https://obsproject.com/',
    docsUrl: 'https://obsproject.com/kb/',
    repoUrl: 'https://github.com/obsproject/obs-studio',
    runbookUrl: `https://intranet.${ORG}/runbook/obs`,
    environments: ['Preprodukcja'],
  },
  {
    name: 'IntelliJ IDEA Community (darmowa edycja)',
    version: '2024.2',
    description:
      'Zintegrowane środowisko programistyczne. Wersja Community obsługuje ' +
      'Javę, Kotlin, Groovy i JavaScript; wersja Ultimate z obsługą ' +
      'baz danych jest płatna.',
    purpose:
      'Rozwijanie i utrzymanie usług backendowych. Na stanowiskach, ' +
      'gdzie potrzebne są funkcje Ultimate, zainstalowana jest licencjonowana wersja.',
    integrations:
      'Wtyczka firmowa z konfiguracją serwera i znakami kontroli wersji, ' +
      'połączenie z bazą przez profil w katalogu wspólnym.',
    ownerEmail: `it.aplikacje@${ORG}`,
    introducedOn: '2023-06-05',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'TEST',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'JetBrains',
    license: 'Apache 2.0 (Community)',
    licenseCount: 25,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'JetBrains',
    supportEmail: 'support@jetbrains.com',
    supportUrl: 'https://www.jetbrains.com/help/idea/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Wersja Community nie ma wtyczki bazodanowej, a projekt wymaga jej ' +
      'do pracy z zapytaniami. Sprawdzamy, czy licencje Ultimate ' +
      'pokrywają cały zespół, zanim przejdziemy na wersję płatną.',
    websiteUrl: 'https://www.jetbrains.com/idea/',
    docsUrl: 'https://www.jetbrains.com/help/idea/',
    repoUrl: 'https://github.com/JetBrains/intellij-community',
    runbookUrl: `https://intranet.${ORG}/runbook/idea`,
    environments: ['Deweloperskie', 'Test'],
  },
  {
    name: 'PostgreSQL Workbench',
    version: '8.4',
    description:
      'Klient PostgreSQL z edytorem zapytań, przeglądarką schematu ' +
      'i możliwością porównywania danych między środowiskami. ' +
      'Działa bez uprawnień do zapisu, których udostępniamy wyłącznie ' +
      'aplikacji.',
    purpose:
      'Weryfikacja danych i przygotowanie zapytań raportowych. ' +
      'Dostęp tylko do odczytu i tylko przez bastion.',
    integrations:
      'Certyfikat firmowy, połączenie przez bastion, brak funkcji ' +
      'zapisu w profilu.',
    ownerEmail: `it.bazy@${ORG}`,
    introducedOn: '2021-11-29',
    securityClass: 'RESTRICTED',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: true,
    deliveryType: 'GENERAL_USE',
    vendor: 'PostgreSQL Global Development Group',
    license: 'BSD 2-Clause',
    licenseCount: 8,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół baz danych',
    supportEmail: `bazy@${ORG}`,
    supportUrl: `https://intranet.${ORG}/bazy/dostejnie`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Najwyższa klasa bezpieczeństwa w rejestrze: dostęp do danych ' +
      'produkcyjnych. Dostęp po wniosek zatwierdzany przez właściciela ' +
      'danych, przegląd co kwartał. Tańsza alternatywa: DBeaver ' +
      'z tym samym poziomem uprawnień.',
    websiteUrl: 'https://www.postgresql.org/about/workbench/',
    docsUrl: 'https://www.postgresql.org/docs/current/app-pgadmin.html',
    repoUrl: 'https://git.postgresql.org/gitweb/workbench.git',
    runbookUrl: `https://intranet.${ORG}/runbook/workbench`,
    environments: ['Produkcja'],
  },
  {
    name: 'Cryptomator',
    version: '1.14',
    description:
      'Program szyfrujący katalogi w chmurze. Pliki są szyfrowane ' +
      'przed wysłaniem, więc dostawca widzi tylko pliki bez nazw ' +
      'i nie odzyska ich bez klucza.',
    purpose:
      'Szyfrowanie dokumentów trzymanych na dysku współdzielonym dostawcy. ' +
      'Klucze zarządzane menedżerem haseł, rotacja co 12 miesięcy.',
    integrations:
      'Uwierzytelnianie kluczem bazowym i synchronizacja kluczy ' +
      'przez menedżer haseł, brak integracji z katalogiem firmowym.',
    ownerEmail: `it.bezpieczenstwo@${ORG}`,
    introducedOn: '2024-09-12',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'DEV',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Cryptomator GmbH',
    license: 'GPL 3.0, darmowy do 1 TB',
    licenseCount: 20,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Cryptomator GmbH',
    supportEmail: 'support@cryptomator.org',
    supportUrl: 'https://community.cryptomator.org/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Pilotaż na dwudziestu stanowiskach, żeby ocenić wygodę dla ' +
      'użytkownika. Otwarte: co się stanie z plikami, gdy ktoś odejdzie ' +
      'z firmy i nie zwróci klucza.',
    websiteUrl: 'https://cryptomator.org/',
    docsUrl: 'https://docs.cryptomator.org/',
    repoUrl: 'https://github.com/cryptomator/cryptomator',
    runbookUrl: `https://intranet.${ORG}/runbook/cryptomator`,
    environments: ['Deweloperskie'],
  },
  {
    name: 'Adobe Acrobat Reader',
    version: '24.002',
    description:
      'Czytnik i edytor PDF firmy Adobe. Obsługuje podpisy cyfrowe ' +
      'oraz formularze PDF, których nie obsługuje Okular.',
    purpose:
      'Podpisywanie umów i wypełnianie formularzy PDF. Po migracji na ' +
      'Okular zostanie usunięty ze stanowisk.',
    integrations:
      'Integracja z Adobe Acrobat Sign, brak integracji z firmowym ' +
      'repozytorium dokumentów.',
    ownerEmail: `it.biuro@${ORG}`,
    introducedOn: '2017-04-03',
    sunsetOn: '2026-06-30',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'DEPRECATED',
    accessRequestRequired: false,
    deliveryType: 'GENERAL_USE',
    vendor: 'Adobe Inc.',
    license: 'darmowy do użytku osobistego i komercyjnego',
    licenseCount: 60,
    annualCost: 0,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Adobe Inc.',
    supportEmail: 'browserfeedback@adobe.com',
    supportUrl: 'https://helpx.adobe.com/acrobat.html',
    supportChannel: 'PORTAL',
    supportNotes:
      'Wycofywane: licencja nie została przedłużona, a wersja bez ' +
      'subskrypcji co kilka tygodni zmienia sposób działania. ' +
      'Do końca czerwca 2026 trzeba przestawić formularze, których ' +
      'nie obsługuje Okular — stąd data zakończenia, a nie zwykłe ' +
      'wyłączenie.',
    websiteUrl: 'https://get.adobe.com/pl/reader/',
    docsUrl: 'https://helpx.adobe.com/acrobat/kb/acrobat-reader-kb.html',
    repoUrl: 'https://github.com/adobe/pdf.js',
    runbookUrl: `https://intranet.${ORG}/runbook/acrobat-wycofywanie`,
    environments: ['Produkcja'],
  },
  {
    name: 'Okular',
    version: '24.04',
    description:
      'Czytnik dokumentów PDF z systemu, z podpisywaniem cyfrowym ' +
      'i weryfikacją poprawności podpisu. Używany przy podpisywaniu ' +
      'umów i odbiorze dokumentów urzędowych.',
    purpose:
      'Podpisywanie dokumentów i sprawdzanie autentyczności plików, ' +
      'które przyszły z zewnątrz. Zastąpił Adobe Acrobat Readera, ' +
      'którego licencje nie przedłużaliśmy.',
    integrations:
      'Punkty zaufania z katalogu centralnego, brak integracji ' +
      'z systemem obiegu dokumentów.',
    ownerEmail: `it.biuro@${ORG}`,
    introducedOn: '2026-03-02',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PLANNED',
    accessRequestRequired: true,
    deliveryType: 'GENERAL_USE',
    vendor: 'KDE e.V.',
    license: 'GPL 3.0',
    licenseCount: 25,
    annualCost: 0,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Dział IT',
    supportEmail: HELP,
    supportUrl: `https://intranet.${ORG}/narzedzia`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Zaplanowane wdrożenie po zakończeniu licencji Acrobat Readera. ' +
      'O warunku jest decyzja, czy podpisywanie ma w ogóle zostać na ' +
      'stanowiskach, czy tylko u kilku osób — stąd wniosek o dostęp ' +
      'i wniosek formalny.',
    websiteUrl: 'https://okular.kde.org/',
    docsUrl: 'https://docs.kde.org/stable5/en/kde-workspace/okular/',
    repoUrl: 'https://invent.kde.org/graphics/okular',
    runbookUrl: `https://intranet.${ORG}/runbook/okular`,
    environments: ['Test', 'Preprodukcja'],
  },
];

/**
 * Wszystkie dane demonstracyjne — programy i usługi.
 *
 * Osobna lista, bo `demo-services.ts` importuje typy stąd; zapętlenie
 * importów między nimi psułoby `tsx` i produkcję jednym i tym samym.
 */
export const DEMO_DATA = [...DEMO_APPLICATIONS, ...DEMO_SERVICES];

/**
 * Wąski port, przez który ten seed rozmawia z bazą.
 *
 * Nie `PrismaClient`, tylko jedna metoda — dzięki temu test podaje atrapę
 * i sprawdza wywołania, zamiast podnosić bazę. Argumenty są typami Prisma,
 * a nie `Record<string, unknown>`: to one pilnują, żeby nazwy pól w danych
 * odpowiadały kolumnom, a zapis nie potrzebował rzutowania.
 */
export type DemoSeeder = {
  application: {
    upsert(
      args: Prisma.ApplicationUpsertArgs,
    ): Promise<Prisma.ApplicationGetPayload<Record<string, never>>>;
  };
};

/**
 * Zapisuje zestaw demonstracyjny, upsertując po nazwie.
 *
 * Upsert, nie `create`, bo `SeedService` startuje przy każdym uruchomieniu
 * kontenera: `create` duplikowałoby rekordy przy restarcie, a `createMany`
 * wywalłłby się na unikalnej nazwie. Aktualizujemy też wartości, więc zmiana
 * w tym pliku dociera do bazy przy najbliższym starcie — inaczej poprawiony
 * opis pozostałby w bazie na zawsze.
 *
 * Środowiska rozwiązujemy po nazwie. `seedEnvironments` zapewnia, że istnieją,
 * a `skipDuplicates` zakłada je bez błędu, gdyby jednak kolejność startów
 * się zmieniła.
 */
export async function seedDemoApplications(prisma: DemoSeeder): Promise<number> {
  // Ta sama relacja dla `create` i `update`: przy `update` najpierw czyścimy
  // przypisania, inaczej zmiana środowisk w tym pliku nigdy by nie doszła do
  // bazy — a rekord wyglądałby na zaktualizowany.
  //
  // `create`, nie `createMany`: `createMany` na relacji przyjmuje wyłącznie
  // skalarny `environmentId`, a identyfikator powstaje dopiero w
  // `seedEnvironments`. `connect` po nazwie działa w `create` i nie wymaga
  // dodatkowego zapytania o środowiska.
  const relacja = (names: string[]) =>
    names.map((name) => ({ environment: { connect: { name } } }));

  for (const record of DEMO_DATA) {
    const { environments, ...fields } = record;

    // Daty w danych są tekstem (`RRRR-MM-DD`), bo tak wyglądają w DTO i tak
    // je weryfikuje walidacja. Prisma wymaga dla `@db.Date` znacznika czasu
    // i samo `RRRR-MM-DD` odrzuca wyjątkiem przy starcie kontenera —
    // zdrowy kontener, którego healthcheck nigdy nie wstanie.
    //
    // `T00:00:00Z`, a nie `new Date('RRRR-MM-DD')`: to drugie parsowane jest
    // jako **lokalna** północ, więc przy strefie UTC+2 data w bazie
    // wypadałaby o jeden dzień wcześniej.
    const daty = {
      introducedOn: new Date(`${record.introducedOn}T00:00:00Z`),
      ...(record.sunsetOn
        ? { sunsetOn: new Date(`${record.sunsetOn}T00:00:00Z`) }
        : {}),
    };

    await prisma.application.upsert({
      where: { name: record.name },
      update: {
        ...fields,
        ...daty,
        // Także w `update`, nie tylko w `create`: bez tego rekord istniejący
        // przed migracją nie dostałby flagi, a przycisk kasujący dane demo
        // znalazłby go mniej niż wynika z danych — cicho, bez błędu.
        //
        // `isDemo`, nie `is_demo`: Prisma oczekuje nazwy pola modelu,
        // mapowanie na kolumnę robi sam (`@map("is_demo")`).
        isDemo: true,
        environments: { deleteMany: {}, create: relacja(environments) },
      },
      create: {
        ...fields,
        ...daty,
        isDemo: true,
        environments: { create: relacja(environments) },
      },
    });
  }

  return DEMO_DATA.length;
}