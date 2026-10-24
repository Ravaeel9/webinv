-- Status „W użyciu" — aplikacje wykorzystywane wewnątrz organizacji,
-- obok `PROD` („produkcja" w tej organizacji znaczy środowisko z danymi
-- klientów). AFTER 'PROD' utrzymuje kolejność zgodną ze schematem.
ALTER TYPE "AppStatus" ADD VALUE 'IN_USE' AFTER 'PROD';
