export type SearchMatchKind = 'exact' | 'prefix' | 'boundary' | 'includes' | 'fuzzy';

export interface SearchRank {
  kind: SearchMatchKind;
  score: number;
}

const KIND_WEIGHT: Record<SearchMatchKind, number> = {
  exact: 0,
  prefix: 100,
  boundary: 200,
  includes: 300,
  fuzzy: 400,
};

export function rankText(query: string, text: string): SearchRank | null {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedText = normalizeSearchText(text);

  if (!normalizedText) {
    return null;
  }

  if (!normalizedQuery) {
    return { kind: 'prefix', score: KIND_WEIGHT.prefix };
  }

  if (normalizedText === normalizedQuery) {
    return { kind: 'exact', score: KIND_WEIGHT.exact };
  }

  if (normalizedText.startsWith(normalizedQuery)) {
    return {
      kind: 'prefix',
      score: KIND_WEIGHT.prefix + normalizedText.length - normalizedQuery.length,
    };
  }

  const boundaryIndex = boundaryMatchIndex(normalizedText, normalizedQuery);
  if (boundaryIndex >= 0) {
    return {
      kind: 'boundary',
      score: KIND_WEIGHT.boundary + boundaryIndex,
    };
  }

  const includesIndex = normalizedText.indexOf(normalizedQuery);
  if (includesIndex >= 0) {
    return {
      kind: 'includes',
      score: KIND_WEIGHT.includes + includesIndex,
    };
  }

  const fuzzyScore = fuzzyMatchScore(normalizedQuery, normalizedText);
  return fuzzyScore === null
    ? null
    : {
        kind: 'fuzzy',
        score: KIND_WEIGHT.fuzzy + fuzzyScore,
      };
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function boundaryMatchIndex(text: string, query: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (!isBoundary(text, index)) {
      continue;
    }
    if (text.slice(index).startsWith(query)) {
      return index;
    }
  }
  return -1;
}

function isBoundary(text: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const previous = text[index - 1];
  const current = text[index];
  return previous === ' ' ||
    previous === '_' ||
    previous === '-' ||
    previous === '.' ||
    (previous >= 'a' && previous <= 'z' && current >= 'A' && current <= 'Z');
}

function fuzzyMatchScore(query: string, text: string): number | null {
  let queryIndex = 0;
  let score = 0;
  let previousMatch = -1;

  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) {
      continue;
    }

    score += previousMatch >= 0 ? textIndex - previousMatch - 1 : textIndex;
    previousMatch = textIndex;
    queryIndex += 1;
  }

  return queryIndex === query.length ? score + text.length - query.length : null;
}
