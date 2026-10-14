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
} = {}) {
  const [serverSearchResults, setServerSearchResults] = useState([]);
  const [formMatchResults, setFormMatchResults] = useState([]);
  const [formMatchUsersByRowId, setFormMatchUsersByRowId] = useState(() => new Map());
  const [searchLoading, setSearchLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);

  const trimmedSearch = searchInput.trim();
  const hasSearchQuery = isUsableSearchQuery(trimmedSearch);
  const formsKey = useMemo(() => personFormsMatchKey(personForms), [personForms]);
  const useServerLookup = rosterOutcome === 'Added';

  const localSearchResults = useMemo(() => {
    if (useServerLookup || !enabled) return [];
    return filterDirectorySearch(localSnapshot, searchInput);
  }, [useServerLookup, enabled, localSnapshot, searchInput]);

  const localFormMatch = useMemo(() => {
    if (useServerLookup || !enabled) {
      return { formMatchResults: [], formMatchUsersByRowId: new Map() };
    }
    const rowsByFormIndex = personForms
      .map((form, formIndex) => ({
        formIndex,
        rows: formHasMatchCriteria(form) ? findFormMatchCandidates(localSnapshot, form) : [],
      }))
      .filter(({ rows }) => rows.length > 0);
    return mergeFormMatchRows(rowsByFormIndex);
  }, [useServerLookup, enabled, localSnapshot, personForms, formsKey]);

  useEffect(() => {
    if (!useServerLookup) {
      setServerSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }
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
        const rows = await searchManagerDirectory(trimmedSearch, SEARCH_LIMIT, partnerId);
        if (active) {
          setServerSearchResults(rows);
        }
      } catch (err) {
        console.error(err);
        if (active && !isRateLimitError(err)) {
          setServerSearchResults([]);
        }
      } finally {
        if (active) setSearchLoading(false);
      }
    }, debounceMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [useServerLookup, enabled, hasSearchQuery, trimmedSearch, partnerId, debounceMs]);

  useEffect(() => {
    if (!useServerLookup) {
      setFormMatchResults([]);
      setFormMatchUsersByRowId(new Map());
      setMatchLoading(false);
      return undefined;
    }
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
          setFormMatchResults([]);
          setFormMatchUsersByRowId(new Map());
        }
      } finally {
        if (active) setMatchLoading(false);
      }
    }, debounceMs);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [useServerLookup, enabled, formsKey, partnerId, debounceMs, personForms]);

  const resolvedSearchResults = useServerLookup ? serverSearchResults : localSearchResults;
  const resolvedFormMatchResults = useServerLookup
    ? formMatchResults
    : localFormMatch.formMatchResults;
  const resolvedFormMatchUsersByRowId = useServerLookup
    ? formMatchUsersByRowId
    : localFormMatch.formMatchUsersByRowId;

  return {
    serverSearchResults: resolvedSearchResults,
    formMatchResults: resolvedFormMatchResults,
    formMatchUsersByRowId: resolvedFormMatchUsersByRowId,
    searchLoading: useServerLookup ? searchLoading : false,
    matchLoading: useServerLookup ? matchLoading : false,
    hasSearchQuery,
  };
}

export { personFormsMatchKey };
