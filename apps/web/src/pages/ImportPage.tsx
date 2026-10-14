import { useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  useApplyImport,
  useImportPreview,
  useSubnets,
} from '../lib/queries';
import { liczba } from '../lib/format';
import { PageHeader } from '../components/layout/AppLayout';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorMessage } from '../components/ui/Feedback';
import { Th } from '../components/ui/Table';
import type { ImportPreview, ImportSelection } from '../types';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function ImportPage() {
  const navigate = useNavigate();
  const { data: subnetsData } = useSubnets();
  const previewMutation = useImportPreview();
  const applyMutation = useApplyImport();

  const subnets = subnetsData?.subnets ?? [];

  const [fileInfo, setFileInfo] = useState<{
    name: string;
    size: number;
  } | null>(null);
  const [xmlContent, setXmlContent] = useState<string>('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);

  // Zaznaczone adresy w trzech grupach
  const [checkedNew, setCheckedNew] = useState<Record<string, boolean>>({});
  const [checkedExisting, setCheckedExisting] = useState<
    Record<string, boolean>
  >({});
  const [checkedUnmatched, setCheckedUnmatched] = useState<
    Record<string, boolean>
  >({});
  const [unmatchedSubnets, setUnmatchedSubnets] = useState<
    Record<string, string>
  >({});

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setLocalError(null);
    previewMutation.reset();
    applyMutation.reset();
    setPreview(null);
    if (!file) {
      setFileInfo(null);
      setXmlContent('');
      return;
    }

    setFileInfo({ name: file.name, size: file.size });
    const reader = new FileReader();
    reader.onload = () => {
      setXmlContent(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => {
      setLocalError(new Error('Nie udało się odczytać wybranego pliku XML.'));
    };
    reader.readAsText(file, 'utf-8');
  };

  const handlePreview = async () => {
    setLocalError(null);
    applyMutation.reset();
    try {
      const result = await previewMutation.mutateAsync(xmlContent);
      setPreview(result);

      // Domyślnie zaznaczone tylko w grupie „nowe"
      const initialNew: Record<string, boolean> = {};
      for (const row of result.new) {
        initialNew[row.address] = true;
      }
      setCheckedNew(initialNew);
      setCheckedExisting({});
      setCheckedUnmatched({});
      setUnmatchedSubnets({});
    } catch {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const selections = useMemo<ImportSelection[]>(() => {
    if (!preview) return [];
    const list: ImportSelection[] = [];

    for (const row of preview.new) {
      if (!checkedNew[row.address]) continue;
      list.push({
        address: row.address,
        subnetId: row.subnetId,
        ...(row.hostname ? { description: row.hostname } : {}),
      });
    }

    for (const row of preview.existing) {
      if (!checkedExisting[row.address]) continue;
      list.push({
        address: row.address,
        subnetId: row.subnetId,
        ...(row.hostname ? { description: row.hostname } : {}),
      });
    }

    for (const row of preview.unmatched) {
      if (!checkedUnmatched[row.address]) continue;
      const subnetId = unmatchedSubnets[row.address];
      if (!subnetId) continue;
      list.push({
        address: row.address,
        subnetId,
        ...(row.hostname ? { description: row.hostname } : {}),
      });
    }

    return list;
  }, [
    preview,
    checkedNew,
    checkedExisting,
    checkedUnmatched,
    unmatchedSubnets,
  ]);

  const unmatchedCheckedWithoutSubnet = useMemo(() => {
    if (!preview) return 0;
    return preview.unmatched.filter(
      (r) => checkedUnmatched[r.address] && !unmatchedSubnets[r.address],
    ).length;
  }, [preview, checkedUnmatched, unmatchedSubnets]);

  const handleApply = async () => {
    if (selections.length === 0 || unmatchedCheckedWithoutSubnet > 0) return;
    setLocalError(null);
    try {
      await applyMutation.mutateAsync(selections);
      navigate('/ipam', { replace: true });
    } catch {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const activeError =
    localError ?? applyMutation.error ?? previewMutation.error;

  return (
    <>
      <PageHeader
        title="Import adresów z pliku nmap"
        description="Wgraj wynik skanu w formacie XML, przejrzyj dopasowanie do podsieci i zatwierdź wybrane pozycje."
        back={{ to: '/ipam', label: 'Wróć do katalogu' }}
      />

      <ErrorMessage error={activeError} className="mb-4" />

      {/* 1. Upload i instrukcja */}
      <section className="card p-6 mb-6 space-y-4">
        <div>
          <label
            htmlFor="nmap-xml-input"
            className="block text-sm font-medium text-fg mb-2"
          >
            Plik wyniku skanu (.xml)
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="nmap-xml-input"
              type="file"
              accept=".xml"
              onChange={handleFileChange}
              className="block text-sm text-fg-muted file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg hover:file:bg-page"
            />
            {fileInfo && (
              <span className="meta-text">
                {fileInfo.name} ({formatBytes(fileInfo.size)})
              </span>
            )}
            <Button
              onClick={handlePreview}
              disabled={!xmlContent || previewMutation.isPending}
              loading={previewMutation.isPending}
            >
              Pokaż podgląd
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface-2 p-4 text-sm text-fg-muted space-y-2">
          <p className="font-medium text-fg">Jak wygenerować plik XML:</p>
          <p>
            Uruchom polecenie{' '}
            <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-fg">
              nmap -sn -oX wynik.xml &lt;zakres&gt;
            </code>{' '}
            (flaga <code className="font-mono text-xs">-sn</code> wykonuje
            szybki przegląd aktywnych hostów bez skanowania portów). Pełne
            wykrywanie hostów w sieci lokalnej wymaga uprawnień administratora
            (root / sudo) na stacji skanującej.
          </p>
          <p className="font-medium text-fg">
            Serwer nie skanuje niczego — powstaje plik, który wgrywasz tutaj.
          </p>
        </div>
      </section>

      {/* 2. Podgląd trzech grup */}
      {preview && (
        <div className="space-y-6">
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-fg">
              Wykryto:{' '}
              <strong>
                {liczba(preview.new.length, 'nowy', 'nowe', 'nowych')}
              </strong>
              {' · '}
              <strong>
                {liczba(
                  preview.existing.length,
                  'istniejący',
                  'istniejące',
                  'istniejących',
                )}
              </strong>
              {' · '}
              <strong>
                {liczba(
                  preview.unmatched.length,
                  'nieprzypisany',
                  'nieprzypisane',
                  'nieprzypisanych',
                )}
              </strong>
            </div>
            {preview.skipped > 0 && (
              <div className="meta-text">
                Pominięto {liczba(preview.skipped, 'wiersz', 'wiersze', 'wierszy')}{' '}
                (adresy IPv6 lub wpisy bez poprawnego adresu IPv4).
              </div>
            )}
          </div>

          {/* Grupa 1: Nowe */}
          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Nowe adresy ({preview.new.length})
                </h2>
                <p className="meta-text">
                  Adresy dopasowane do podsieci po CIDR, których nie ma jeszcze
                  w katalogu. Domyślnie zaznaczone do importu.
                </p>
              </div>
            </div>
            {preview.new.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">
                Brak nowych adresów dopasowanych do istniejących podsieci.
              </p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left">
                      <Th className="w-10">Zapisz</Th>
                      <Th>Adres IP</Th>
                      <Th>Hostname z nmap</Th>
                      <Th>Podsieć docelowa</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.new.map((row) => (
                      <tr key={row.address}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={Boolean(checkedNew[row.address])}
                            onChange={(e) =>
                              setCheckedNew((prev) => ({
                                ...prev,
                                [row.address]: e.target.checked,
                              }))
                            }
                            aria-label={`Zaznacz nowy adres ${row.address}`}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-fg">
                          {row.address}
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">
                          {row.hostname ?? <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone="neutral">
                            {row.subnetName} ({row.cidr})
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Grupa 2: Istniejące */}
          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line">
              <h2 className="text-sm font-semibold text-fg">
                Istniejące adresy ({preview.existing.length})
              </h2>
              <p className="meta-text">
                Adresy już zarejestrowane w katalogu. Zaznaczenie odświeży
                znacznik obecności w sieci i zaktualizuje opis, jeśli nmap
                zwrócił nazwę hosta.
              </p>
            </div>
            {preview.existing.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">
                Żaden z adresów w pliku nie figuruje jeszcze w katalogu.
              </p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left">
                      <Th className="w-10">Zapisz</Th>
                      <Th>Adres IP</Th>
                      <Th>Obecny opis</Th>
                      <Th>Hostname z nmap</Th>
                      <Th>Podsieć docelowa</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.existing.map((row) => (
                      <tr key={row.address}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={Boolean(checkedExisting[row.address])}
                            onChange={(e) =>
                              setCheckedExisting((prev) => ({
                                ...prev,
                                [row.address]: e.target.checked,
                              }))
                            }
                            aria-label={`Zaznacz istniejący adres ${row.address}`}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-fg">
                          {row.address}
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">
                          {row.existingDescription ?? (
                            <span className="text-fg-subtle">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">
                          {row.hostname ?? <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone="neutral">{row.subnetName}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Grupa 3: Nieprzypisane */}
          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  Nieprzypisane do żadnej podsieci ({preview.unmatched.length})
                </h2>
                <p className="meta-text">
                  Adresy spoza wszystkich zarejestrowanych zakresów CIDR. Aby
                  zapisać pozycję z tej grupy, wskaż podsieć obejmującą ten
                  zakres (jeśli jeszcze jej nie ma w katalogu, najpierw dodaj
                  podsieć).
                </p>
              </div>
              <Link
                to="/ipam/nowa"
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                + Dodaj brakującą podsieć
              </Link>
            </div>
            {preview.unmatched.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">
                Wszystkie wykryte adresy mieszczą się w zarejestrowanych
                podsieciach.
              </p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left">
                      <Th className="w-10">Zapisz</Th>
                      <Th>Adres IP</Th>
                      <Th>Hostname z nmap</Th>
                      <Th>Podsieć docelowa</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.unmatched.map((row) => (
                      <tr key={row.address}>
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={Boolean(checkedUnmatched[row.address])}
                            onChange={(e) =>
                              setCheckedUnmatched((prev) => ({
                                ...prev,
                                [row.address]: e.target.checked,
                              }))
                            }
                            aria-label={`Zaznacz nieprzypisany adres ${row.address}`}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-fg">
                          {row.address}
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted">
                          {row.hostname ?? <span className="text-fg-subtle">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={unmatchedSubnets[row.address] ?? ''}
                            onChange={(e) =>
                              setUnmatchedSubnets((prev) => ({
                                ...prev,
                                [row.address]: e.target.value,
                              }))
                            }
                            className="input py-1 text-xs max-w-xs"
                            aria-label={`Podsieć dla adresu ${row.address}`}
                          >
                            <option value="">— wybierz podsieć —</option>
                            {subnets.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.cidr})
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 3. Zapis */}
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-fg-muted">
              {unmatchedCheckedWithoutSubnet > 0 ? (
                <span className="text-rose-600">
                  Wskaż podsieć dla wszystkich zaznaczonych adresów z grupy
                  „nieprzypisane”.
                </span>
              ) : selections.length === 0 ? (
                <span>Nic nie zaznaczono — wybierz co najmniej jeden adres do zapisu.</span>
              ) : (
                <span>
                  Do zapisania:{' '}
                  <strong className="text-fg">
                    {liczba(selections.length, 'pozycja', 'pozycje', 'pozycji')}
                  </strong>
                </span>
              )}
            </div>
            <Button
              onClick={handleApply}
              disabled={
                selections.length === 0 ||
                unmatchedCheckedWithoutSubnet > 0 ||
                applyMutation.isPending
              }
              loading={applyMutation.isPending}
            >
              Zatwierdź i zapisz ({selections.length})
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
