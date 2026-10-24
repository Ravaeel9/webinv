/**
 * Usługi demonstracyjne: pięć SaaS i pięć hostowanych u nas.
 *
 * Osobny plik od `demo-applications.ts`, bo to inny typ dostarczenia
 * i inny zestaw pól — dochodzą `baseUrl`, `hostingLocation` i `adminTeam`,
 * a strona szczegółów renderuje dla tych rekordów sekcję „Dostęp i wsparcie",
 * której przy `GENERAL_USE` nie ma w ogóle.
 *
 * Rozkład wariantów ma sens podobny jak przy programach: usługi pokazują
 * inne kombinacje klasyfikacji i statusów, więc w UI widać obie listy
 * naraz i filtry mają co zawężać.
 *
 * `sunsetOn` pusty przy wszystkich — żadna z tych usług nie jest wycofywana,
 * a data wyglądałaby jak zobowiązanie do podjęcia. Koszt roczny dodatni przy
 * każdej, bo usługa za zero wygląda w rejestrze jak puste pole.
 */
import type { DemoApplication } from './demo-applications';

/** Domena organizacji — ta sama co w zestawie programów. */
const ORG = 'firma.pl';

/**
 * Usługa: wszystkie pola programu plus blok „dostęp i wsparcie".
 *
 * `Omit` na `deliveryType`, bo tu jest zawężone do dwóch typów usług —
 * gdyby zostało szerokie `DeliveryType`, rekord mógłby przez przypadek
 * trafić do `GENERAL_USE` i pominąć walidację bloku.
 */
export type DemoService = Omit<DemoApplication, 'deliveryType'> & {
  deliveryType: 'SAAS' | 'SELF_HOSTED';
  baseUrl: string;
  hostingLocation: string;
  adminTeam: string;
};

export const DEMO_SERVICES: DemoService[] = [
  {
    name: 'Google Workspace',
    version: 'sublicencja biznesowa, cennik 2026',
    description:
      'Pakiet biurowy Google: poczta, dysk, dokumenty, arkusze, ' +
      'kalendarz i wideokonferencje. Korzystamy z kont firmowych ' +
      'z wymuszonym logowaniem dwuskładnikowym.',
    purpose:
      'Poczta i dokumentacja dla działów, które nie pracują na ' +
      'udziale sieciowym. Tam, gdzie dokumenty muszą leżeć ' +
      'w polskiej jurysdykcji, obowiązuje SharePoint z Microsoft 365.',
    integrations:
      'Synchronizacja z kalendarzem firmowym, brak synchronizacji ' +
      'z repozytorium dokumentów — to świadoma decyzja: dwa systemy ' +
      'przechowujące te same pliki dają dwie wersje dokumentu.',
    ownerEmail: `it.komunikacja@${ORG}`,
    introducedOn: '2019-05-06',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SAAS',
    baseUrl: 'https://workspace.google.com/',
    hostingLocation: 'region europejski dostawcy, przetwarzanie w Unii Europejskiej',
    adminTeam: `Zespół IT — konta i płatności`,
    vendor: 'Google LLC',
    license: 'sublicencja Workspace Business Plus',
    licenseCount: 120,
    annualCost: 21600,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Google Workspace',
    supportEmail: 'workspace-support@google.com',
    supportUrl: 'https://support.google.com/a/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Największa pozycja kosztowa w rejestrze. Przed każdym ' +
      'odnowieniem sprawdzamy, ile kont jest aktywnych, bo rozliczenie ' +
      'idzie za każde konto, także nieużywane.',
    websiteUrl: 'https://workspace.google.com/',
    docsUrl: 'https://support.google.com/a/answer/3331065',
    repoUrl: '',
    runbookUrl: `https://intranet.${ORG}/runbook/google-workspace`,
    environments: ['Biurowe'],
  },
  {
    name: 'Atlassian Confluence',
    version: 'sublicencja premium',
    description:
      'Wiki firmowa z szablonami dokumentacji i powiązaniami między ' +
      'stronami. Zawiera dokumentację wewnętrzną, decyzje ' +
      'architektoniczne i instrukcje dla użytkowników.',
    purpose:
      'Dokumentacja wewnętrzna i instrukcje dla użytkowników. ' +
      'Wykładnicze notatki ze spotkań są w systemie ticketowym, ' +
      'bo tutaj giną w wyszukiwaniu po kilku miesiącach.',
    integrations:
      'Synchronizacja kont z firmową tożsamością, osadzone formularze, ' +
      'eksport do PDF na potrzeby archiwum.',
    ownerEmail: `it.narzedzia@${ORG}`,
    introducedOn: '2021-04-12',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SAAS',
    baseUrl: 'https://firma.atlassian.net/wiki/',
    hostingLocation: 'chmura dostawcy, centrum danych w UE, umowa powierzenia z klientem',
    adminTeam: `Zespół narzędzi — konfiguracja i dostęp`,
    vendor: 'Atlassian',
    license: 'sublicencja premium 500 użytkowników',
    licenseCount: 180,
    annualCost: 14000,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Atlassian',
    supportEmail: 'confluence-support@atlassian.com',
    supportUrl: 'https://support.atlassian.com/confluence-cloud/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Licencja liczy użytkowników aktywnych, ale w praktyce płacimy ' +
      'za 180 kont przy 180 aktywnych. Migracja z Wiki firmowej ' +
      'z 2019 zakończona, stare archiwum trzymamy w trybie tylko ' +
      'do odczytu i wygasnie wraz z licencją starego produktu.',
    websiteUrl: 'https://www.atlassian.com/software/confluence',
    docsUrl: 'https://support.atlassian.com/confluence-cloud/',
    repoUrl: '',
    runbookUrl: `https://intranet.${ORG}/runbook/confluence`,
    environments: ['Biurowe'],
  },
  {
    name: 'DocuSign',
    version: 'Business Pro, plan roczny',
    description:
      'Podpisy elektroniczne dokumentów. Podpis ma znaczenie prawne, ' +
      'a kopia dokumentu z podpisem trafia automatycznie do archiwum ' +
      'po naszej stronie.',
    purpose:
      'Podpisywanie umów i dokumentów wewnętrznych. Dokumenty, ' +
      'które muszą zostać w archiwum, trzymamy też lokalnie, bo dostęp ' +
      'do konta u dostawcy wygasa z umową.',
    integrations:
      'Wtyczka w systemie ticketowym, jednoklikowe logowanie ' +
      'przez firmową tożsamość, automatyczne zapisywanie podpisanej ' +
      'wersji na udziale dokumentów.',
    ownerEmail: `sekretariat@${ORG}`,
    introducedOn: '2022-09-07',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: true,
    deliveryType: 'SAAS',
    baseUrl: 'https://app.docusign.com/',
    hostingLocation: 'chmura dostawcy, centrum danych w UE',
    adminTeam: `Sekretariat — konta i szablony`,
    vendor: 'DocuSign, Inc.',
    license: 'Business Pro, 50 użytkowników nadawców',
    licenseCount: 50,
    annualCost: 9600,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'DocuSign',
    supportEmail: 'support@docusign.com',
    supportUrl: 'https://support.docusign.com/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Dostęp po wniosek, bo każde konto to uprawnienie do podpisywania ' +
      'w imieniu firmy. Umowa na rok, przypomnienie o odnowieniu ' +
      'w rejestrze przy zakupie licencji.',
    websiteUrl: 'https://www.docusign.com/',
    docsUrl: 'https://support.docusign.com/',
    repoUrl: '',
    runbookUrl: `https://intranet.${ORG}/runbook/docusign`,
    environments: ['Biurowe'],
  },
  {
    name: 'Calendly',
    version: 'Teams, plan roczny',
    description:
      'Usługa rezerwacji terminów przez publiczne linki. Spotkanie ' +
      'zapisuje się w kalendarzu firmowym i wysyła zaproszenie ' +
      'z naszej domeny.',
    purpose:
      'Umawianie spotkań z kontrahentami i kandydatami bez ' +
      'prośby oterminy w e-mailu. Kalendarze zespołów prowadzą ' +
      'równolegle wewnętrzny system rezerwacji sal.',
    integrations:
      'Synchronizacja z kalendarzem firmowym, zaproszenia ' +
      'z naszej domeny, brak dostępu do poczty wewnętrznej.',
    ownerEmail: `sekretariat@${ORG}`,
    introducedOn: '2024-05-07',
    securityClass: 'PUBLIC',
    criticality: 1,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SAAS',
    baseUrl: 'https://calendly.com/',
    hostingLocation: 'chmura dostawcy, centrum danych w UE',
    adminTeam: `Sekretariat — konta i linki`,
    vendor: 'Calendly LLC',
    license: 'sublicencja Teams, 20 użytkowników',
    licenseCount: 20,
    annualCost: 1200,
    supportOwnerType: 'VENDOR',
    supportOwnerName: 'Calendly',
    supportEmail: 'support@calendly.com',
    supportUrl: 'https://help.calendly.com/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Najtańsza usługa w rejestrze. Linki kalendarzowe prowadzą ' +
      'do naszej domeny, więc wyglądają jak strona firmy — to świadomy ' +
      'wybór, inaczej kandydat widzi adres usługi zewnętrznej.',
    websiteUrl: 'https://calendly.com/',
    docsUrl: 'https://help.calendly.com/',
    repoUrl: '',
    runbookUrl: `https://intranet.${ORG}/runbook/calendly`,
    environments: ['Biurowe'],
  },
  {
    name: '1Password Business',
    version: 'Business, plan roczny',
    description:
      'Menedżer haseł i sekretów w chmurze z synchronizacją między ' +
      'urządzeniami. Udostępnia sekrety usługom przez konta serwisowe ' +
      'z rotacją kluczy.',
    purpose:
      'Hasła do systemów, których nie obsługuje logowanie ' +
      'scentralizowane, oraz sekrety w konfiguracji usług. ' +
      'Przechowywanie tam haseł systemowych jest zabronione — ' +
      'za to odpowiada logowanie do domeny.',
    integrations:
      'Logowanie przez firmową tożsamość, rozszerzenie przeglądarki, ' +
      'wypełnianie poświadczeń w systemach wewnętrznych, dostęp ' +
      'programistyczny dla usług.',
    ownerEmail: `it.bezpieczenstwo@${ORG}`,
    introducedOn: '2023-11-20',
    securityClass: 'RESTRICTED',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: true,
    deliveryType: 'SAAS',
    baseUrl: 'https://my.1password.com/',
    hostingLocation: 'chmura dostawcy, centrum danych w UE',
    adminTeam: `Zespół bezpieczeństwa — konta i odzyskiwanie`,
    vendor: 'AgileBits Inc. (1Password)',
    license: 'Business, 300 użytkowników',
    licenseCount: 300,
    annualCost: 10800,
    supportOwnerType: 'VENDOR',
    supportOwnerName: '1Password',
    supportEmail: 'support@1password.com',
    supportUrl: 'https://support.1password.com/',
    supportChannel: 'PORTAL',
    supportNotes:
      'Najwyższa klasa bezpieczeństwa w rejestrze: hasła do wszystkiego, ' +
      'co nie ma logowania centralnego. Dostęp po wniosek zatwierdzany ' +
      'przez kierownika, przegląd kont co kwartał. Plan utraty ' +
      'dostępu i procedura odzyskiwania konta trzymana poza tym ' +
      'systemem, żeby awaria nie blokowała samego odzyskiwania.',
    websiteUrl: 'https://1password.com/',
    docsUrl: 'https://support.1password.com/',
    repoUrl: '',
    runbookUrl: `https://intranet.${ORG}/runbook/1password`,
    environments: ['Biurowe'],
  },
  {
    name: 'Nextcloud',
    version: '29.0',
    description:
      'Samodzielny pakiet biurowy i usługa plików: dysk współdzielony, ' +
      'kalendarz, kontakty, edycja dokumentów w przeglądarce. ' +
      'Uruchomiony na naszym klastrze, dane nie opuszczają naszej ' +
      'infrastruktury.',
    purpose:
      'Współdzielony dysk dla dokumentów, które muszą zostać ' +
      'w organizacji z przyczyn prawnych, oraz edycja dokumentów ' +
      'bez instalowania pakietu biurowego. Dla pozostałych ' +
      'plików służy SharePoint z Microsoft 365.',
    integrations:
      'Uwierzytelnianie przez Keycloak, szyfrowanie po stronie klienta, ' +
      'dostęp z telefonu, skanowanie antywirusowe przez klienta na ' +
      'serwerze plików.',
    ownerEmail: `it.infrastruktura@${ORG}`,
    introducedOn: '2023-06-05',
    securityClass: 'CONFIDENTIAL',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SELF_HOSTED',
    baseUrl: `https://nextcloud.${ORG}/`,
    hostingLocation: 'klaster Kubernetes w serwerowni głównej, Warszawa',
    adminTeam: `Zespół infrastruktury — utrzymanie i kopie`,
    vendor: 'Nextcloud GmbH',
    license: 'GPL 3.0, rozwój i wsparcie społeczności',
    licenseCount: 200,
    annualCost: 12000,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół infrastruktury',
    supportEmail: `infrastruktura@${ORG}`,
    supportUrl: `https://intranet.${ORG}/infrastruktura/nextcloud`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Roczny koszt to utrzymanie, nie licencja: czas zespołu ' +
      'infrastruktury plus sprzęt. Wersje są wciąż wspierane przez ' +
      'projekt, ale każda duża aktualizacja wymaga okna serwisowego — ' +
      'planner dostępności zakłada je na początek kwartału.',
    websiteUrl: 'https://nextcloud.com/',
    docsUrl: 'https://docs.nextcloud.com/server/latest/admin_manual/',
    repoUrl: 'https://github.com/nextcloud/server',
    runbookUrl: `https://intranet.${ORG}/runbook/nextcloud`,
    environments: ['Biurowe', 'Preprodukcja'],
  },
  {
    name: 'Grafana',
    version: '11.1',
    description:
      'Zestawienia i wykresy metryk z naszych usług: dostępność, ' +
      'obciążenie, błędy. Alerty wysyłane są na numer dyżurny, ' +
      'nie na pocztę.',
    purpose:
      'Monitoring usług i alarmowanie o awariach. Panel służy ' +
      'dyżurnemu oraz prowadzącym awarie, a nie codziennemu ' +
      'sprawdzaniu stanu serwerów.',
    integrations:
      'Zbieranie metryk z wszystkich usług w klastrze, alerty ' +
      'na Slack i numer dyżurny, eksport do systemu ticketowego ' +
      'przy potwierdzeniu awarii.',
    ownerEmail: `it.infrastruktura@${ORG}`,
    introducedOn: '2022-03-14',
    securityClass: 'INTERNAL',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SELF_HOSTED',
    baseUrl: `https://grafana.${ORG}/`,
    hostingLocation: 'klaster Kubernetes w serwerowni głównej, Warszawa',
    adminTeam: `Zespół infrastruktury — monitoring i alarmy`,
    vendor: 'Grafana Labs',
    license: 'GPL 3.0, rozwój AGPL, bez opłat licencyjnych',
    licenseCount: 40,
    annualCost: 6000,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół infrastruktury',
    supportEmail: `infrastruktura@${ORG}`,
    supportUrl: `https://intranet.${ORG}/infrastruktura/monitoring`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Awaria monitoringu sama w sobie jest awarią: panele zapasowe ' +
      'czytają metryki bezpośrednio z API usług, więc alarmy ' +
      'działają nawet wtedy, gdy Grafana nie wstaje.',
    websiteUrl: 'https://grafana.com/',
    docsUrl: 'https://grafana.com/docs/grafana/latest/',
    repoUrl: 'https://github.com/grafana/grafana',
    runbookUrl: `https://intranet.${ORG}/runbook/grafana`,
    environments: ['Biurowe', 'Test'],
  },
  {
    name: 'Keycloak',
    version: '25.0',
    description:
      'Serwer logowania jednokrotnego dla naszych usług. Trzyma ' +
      'konta, sesje i polityki haseł, w tym wymuszanie uwierzytelniania ' +
      'dwuskładnikowego.',
    purpose:
      'Logowanie jednokrotne do Nextcloud, Grafany i narzędzi ' +
      'wewnętrznych oraz wymuszanie uwierzytelniania dwuskładnikowego ' +
      'tam, gdzie sama aplikacja tego nie umie.',
    integrations:
      'Katalog LDAP firmowy jako źródło kont, aplikacje zewnętrzne ' +
      'przez standard OIDC, brak własnego API — dostęp do API ' +
      'jest świadomie wyłączony.',
    ownerEmail: `it.bezpieczenstwo@${ORG}`,
    introducedOn: '2023-02-20',
    securityClass: 'RESTRICTED',
    criticality: 4,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SELF_HOSTED',
    baseUrl: `https://logowanie.${ORG}/`,
    hostingLocation: 'para węzłów w klastrze Kubernetes, Warszawa',
    adminTeam: `Zespół bezpieczeństwa — polityki i dostęp`,
    vendor: 'Red Hat',
    license: 'Apache 2.0, dystrybucja Red Hat z poprawkami bezpieczeństwa',
    licenseCount: 250,
    annualCost: 18000,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół bezpieczeństwa',
    supportEmail: `bezpieczenstwo@${ORG}`,
    supportUrl: `https://intranet.${ORG}/bezpieczenstwo/sso`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Najważniejsza usługa w rejestrze: awaria logowania blokuje ' +
      'wszystkie aplikacje naraz. Dlatego para węzłów zamiast jednego ' +
      'i test przełączenia co kwartał — sprawdzamy nie tylko czy wraca, ' +
      'ale czy sesje użytkowników przetrwały przełączenie.',
    websiteUrl: 'https://www.keycloak.org/',
    docsUrl: 'https://www.keycloak.org/documentation/',
    repoUrl: 'https://github.com/keycloak/keycloak',
    runbookUrl: `https://intranet.${ORG}/runbook/keycloak`,
    environments: ['Biurowe'],
  },
  {
    name: 'Mattermost',
    version: '9.5',
    description:
      'Komunikator hostowany u nas, z kanałami i archiwum rozmów. ' +
      'Wybrany przed SaaS, bo archiwum rozmów ma zostać w organizacji ' +
      'i ma być dostępne po zakończeniu umowy z dostawcą.',
    purpose:
      'Komunikacja w zespole infrastrukturze i bezpieczeństwa, ' +
      'gdzie rozmowy zawierają szczegóły niewrażliwe dla reszty firmy. ' +
      'Pozostałe zespoły używają narzędzi z licencją firmową.',
    integrations:
      'Uwierzytelnianie przez Keycloak, integracja z systemem ticketowym, ' +
      'bot raportujący zdarzenia z Grafany.',
    ownerEmail: `it.bezpieczenstwo@${ORG}`,
    introducedOn: '2024-03-11',
    securityClass: 'CONFIDENTIAL',
    criticality: 3,
    status: 'PROD',
    accessRequestRequired: false,
    deliveryType: 'SELF_HOSTED',
    baseUrl: `https://czat.${ORG}/`,
    hostingLocation: 'maszyna wirtualna w klastrze Kubernetes, Warszawa',
    adminTeam: `Zespół bezpieczeństwa — utrzymanie i kanały`,
    vendor: 'Mattermost, Inc.',
    license: 'MIT w części serwerowej, klient na licencji własnej dostawcy',
    licenseCount: 40,
    annualCost: 4000,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół bezpieczeństwa',
    supportEmail: `bezpieczenstwo@${ORG}`,
    supportUrl: `https://intranet.${ORG}/bezpieczenstwo/mattermost`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Ograniczenie: klient na licencji dostawcy nie pozwala na pełną ' +
      'edycję w przeglądarce dla wszystkich funkcji. Na stanowiskach ' +
      'bez klienta desktopowego użytkownicy widzą tylko wersję ' +
      'przeglądarkową, co bywa zaskoczeniem.',
    websiteUrl: 'https://mattermost.com/',
    docsUrl: 'https://docs.mattermost.com/',
    repoUrl: 'https://github.com/mattermost/mattermost',
    runbookUrl: `https://intranet.${ORG}/runbook/mattermost`,
    environments: ['Biurowe'],
  },
  {
    name: 'Forgejo',
    version: '7.0',
    description:
      'Serwer gita hostowany u nas, z przeglądem kodu i ciągłą ' +
      'integracją. Publicznie dostępny host trzymany jest na zewnątrz, ' +
      'bo dostawcy zewnętrzni nie mają dostępu do naszego intranetu.',
    purpose:
      'Repozytoria usług wewnętrznych. Repozytoria aplikacji ' +
      'komercyjnych pozostają u ich dostawców — tu trzymamy tylko ' +
      'kod, który należy do nas.',
    integrations:
      'Logowanie przez Keycloak, powiadomienia do systemu ticketowego, ' +
      'przebiegi potoków budowania uruchamiane przez webhooki.',
    ownerEmail: `it.aplikacje@${ORG}`,
    introducedOn: '2024-09-16',
    securityClass: 'INTERNAL',
    criticality: 2,
    status: 'TEST',
    accessRequestRequired: false,
    deliveryType: 'SELF_HOSTED',
    baseUrl: `https://git.${ORG}/`,
    hostingLocation: 'maszyna wirtualna w klastrze Kubernetes, Warszawa',
    adminTeam: `Zespół aplikacji — repozytoria i dostęp`,
    vendor: 'Codeberg e.V.',
    license: 'MIT',
    licenseCount: 60,
    annualCost: 2000,
    supportOwnerType: 'INTERNAL',
    supportOwnerName: 'Zespół aplikacji',
    supportEmail: `aplikacje@${ORG}`,
    supportUrl: `https://intranet.${ORG}/aplikacje/git`,
    supportChannel: 'EMAIL',
    supportNotes:
      'Pilotaż od września 2024: przenosimy repozytoria z usługi ' +
      'hostowanej. Otwarte pytanie o kopie — migrujemy je razem, ' +
      'bo oddzielna kopia hostowana w Polsce tylko udaje, że ' +
      'jesteśmy niezależni od dostawcy.',
    websiteUrl: 'https://codeberg.org/forgejo/forgejo',
    docsUrl: 'https://forgejo.org/docs/',
    repoUrl: 'https://codeberg.org/forgejo/forgejo',
    runbookUrl: `https://intranet.${ORG}/runbook/forgejo`,
    environments: ['Biurowe', 'Deweloperskie'],
  },
];