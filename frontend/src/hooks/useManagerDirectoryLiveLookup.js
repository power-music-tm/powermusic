import { useEffect, useMemo, useState } from 'react';
import {
  filterDirectorySearch,
  findFormMatchCandidates,
  formHasMatchCriteria,
  isUsableSearchQuery,
  mergeFormMatchRows,
} from '../utils/managerDirectory';
import { fetchFormMatchCandidates, searchManagerDirectory } from '../utils/managerDirectoryApi';
import { isRateLimitError } from '../utils/pilot2Api';

const SEARCH_LIMIT = 25;
const MATCH_LIMIT = 15;

function personFormsMatchKey(personForms) {
  return JSON.stringify(
    personForms.map((form) => ({
      email: (form.email || '').trim().toLowerCase(),
      firstName: (form.firstName || '').trim().toLowerCase(),
      lastName: (form.lastName || '').trim().toLowerCase(),
      location: (form.location || '').trim().toLowerCase(),
    })),
  );
}

/**
 * Server-backed directory search and form match candidates (full partner roster).
 * The local snapshot from useManagerDirectory remains for default browsing only.
 */
export function useManagerDirectoryLiveLookup({
  searchInput,
  personForms,
  partnerId = null,
  enabled = true,
  debounceMs = 400,
  rosterOutcome = 'Added',
  localSnapshot = [],
  isGll = false,
} = {}) {
  const [serverSearchResults, setServerSearchResults] = useState([]);
  const [formMatchResults, setFormMatchResults] = useState([]);
  const [formMatchUsersByRowId, setFormMatchUsersByRowId] = useState(() => new Map());
  const [searchLoading, setSearchLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);

  const trimmedSearch = searchInput.trim();
  const hasSearchQuery = isUsableSearchQuery(trimmedSearch);
  const formsKey = useMemo(() => personFormsMatchKey(personForms), [personForms]);
  const directoryOutcome = rosterOutcome === 'Removed' ? 'Removed' : 'Added';

  useEffect(() => {
    if (!enabled) {
      setServerSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    if (!hasSearchQuery) {
      setServerSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    let active = true;
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rows = await searchManagerDirectory(
          trimmedSearch,
          SEARCH_LIMIT,
          partnerId,
          directoryOutcome,
        );
        if (active) {
          setServerSearchResults(rows);
        }
      } catch (err) {
        console.error(err);
        if (active && !isRateLimitError(err)) {
          // Fall back to local snapshot filter if server search fails.
          setServerSearchResults(filterDirectorySearch(localSnapshot, searchInput));
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, debounceMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    hasSearchQuery,
    trimmedSearch,
    partnerId,
    debounceMs,
    directoryOutcome,
    localSnapshot,
    searchInput,
  ]);

  useEffect(() => {
    if (!enabled) {
      setFormMatchResults([]);
      setFormMatchUsersByRowId(new Map());
      setMatchLoading(false);
      return undefined;
    }

    const indexesWithCriteria = personForms
      .map((form, index) => (formHasMatchCriteria(form) ? index : null))
      .filter((index) => index !== null);

    if (indexesWithCriteria.length === 0) {
      setFormMatchResults([]);
      setFormMatchUsersByRowId(new Map());
      setMatchLoading(false);
      return undefined;
    }

    let active = true;
    setMatchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const rowsByFormIndex = await Promise.all(
          indexesWithCriteria.map(async (formIndex) => {
            const rows = await fetchFormMatchCandidates(
              personForms[formIndex],
              MATCH_LIMIT,
              partnerId,
              directoryOutcome,
            );
            return { formIndex, rows };
          }),
        );
        if (!active) return;
        const merged = mergeFormMatchRows(rowsByFormIndex);
        setFormMatchResults(merged.formMatchResults);
        setFormMatchUsersByRowId(merged.formMatchUsersByRowId);
      } catch (err) {
        console.error(err);
        if (active && !isRateLimitError(err)) {
          const rowsByFormIndex = indexesWithCriteria.map((formIndex) => ({
            formIndex,
            rows: findFormMatchCandidates(
              localSnapshot,
              personForms[formIndex],
              MATCH_LIMIT,
              { isGll },
            ),
          }));
          const merged = mergeFormMatchRows(rowsByFormIndex);
          setFormMatchResults(merged.formMatchResults);
          setFormMatchUsersByRowId(merged.formMatchUsersByRowId);
        }
      } finally {
        if (active) setMatchLoading(false);
      }
    }, debounceMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    formsKey,
    partnerId,
    debounceMs,
    personForms,
    directoryOutcome,
    localSnapshot,
    isGll,
  ]);

  return {
    serverSearchResults,
    formMatchResults,
    formMatchUsersByRowId,
    searchLoading,
    matchLoading,
    hasSearchQuery,
  };
}

export { personFormsMatchKey };
