/**
 * Walidacja adresu IPv4 po stronie interfejsu.
 *
 * Celowa kopia `isValidIpv4` z `apps/api/src/ipam/cidr.ts`. Kopiujemy ją,
 * bo użytkownik ma dostać komunikat pod polem, a nie dopiero po odpowiedzi
 * 400 z serwera — podobnie jak `lib/password.ts` wobec `auth/password.ts`.
 *
 * Dlaczego nie delegujemy do API: `/ipam` ma trasę `POST .../addresses`
 * z walidacją po stronie serwera, a walidacja w przeglądarce oszczędza
 * użytkownikowi rundy do serwera dla literówki. Za cenę rozjazdu, którego
 * pilnuje `apps/api/test/ipam-ip-parity.test.ts`.
 *
 * Rozjazd już się zdarzył: kopia w `SubnetDetailPage.tsx` używała
 * `\d{1,2}`, czyli oktety 1–2 cyfrowe. `10.1.120.120` i `192.168.100.1`
 * były odrzucane przez przeglądarkę, choć serwer je przyjmował. Dlatego
 * wzorzec poniżej jest **ten sam** co w `cidr.ts`, a nie podobny.
 */

/**
 * Oktet 0–255 bez zer wiodących — ta sama notacja co w `cidr.ts`.
 *
 * `\d{0,2}` po `[1-9]` daje w sumie 1–3 cyfry, czyli mieści `255`.
 * Zero wiodące („010”) odrzucamy: to notacja dwuznaczna (użytkownik mógł
 * myśleć po ósemkowemu o 8), a zgadywanie w walidacji jest gorsze niż
 * odmowa.
 */
const OKTET = /^(?:0|[1-9]\d{0,2})$/;

/** `true` dla `10.20.1.15` i `255.255.255.255`, `false` dla `10.20.1.256`. */
export function isIpv4(value: string): boolean {
  const oktety = value.split('.');
  if (oktety.length !== 4) {
    return false;
  }
  return oktety.every((oktet) => OKTET.test(oktet) && Number(oktet) <= 255);
}
