/**
 * Typy odzwierciedlające odpowiedzi API.
 * Trzymane ręcznie, bo nie mamy generatora z OpenAPI — kontrakt
 * jest wąski i stabilny, a schemat Prisma jest jego źródłem prawdy.
 *
 * Od podziału po dwelling ten plik jest barą reeksportów — aktywna
 * treść w types-*.ts. Komponenty i testy importują stąd jak wcześniej.
 */
export * from './types-identity';
export * from './types-application';
export * from './types-ipam';
export * from './types-audit';
export * from './types-settings';
export * from './types-access';
export * from './types-ui';
export * from './types-glpi';
