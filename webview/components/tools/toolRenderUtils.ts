import type { ToolCallActivity } from '../../../src/shared/chatModel';

export type ToolRendererKind = 'bash' | 'edit' | 'search' | 'read' | 'generic';

export interface DiffPart {
  text: string;
  changed: boolean;
}

export interface SearchMatch {
  file: string;
  line?: number;
  text: string;
}

export interface ParsedSearchResult {
  mode?: string;
  files: string[];
  matches: SearchMatch[];
  rawText: string;
}

interface ParsedRecord {
  [key: string]: unknown;
}

export function parseMaybeJson(raw?: string): unknown {
  if (!raw) {
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }

  return raw;
}

export function inferToolRenderer(item: ToolCallActivity, parsedInput: unknown): ToolRendererKind {
  // 1. Prioritize explicit toolKind from protocol
  if (item.toolKind === 'read') {
    return 'read';
  }
  if (item.toolKind === 'execute') {
    return 'bash';
  }
  if (item.toolKind === 'edit') {
    return 'edit';
  }
  if (item.toolKind === 'search') {
    return 'search';
  }

  const title = item.title.toLowerCase();
  const input = asRecord(parsedInput);

  if (
    title.includes('command') ||
    title.includes('terminal') ||
    title.includes('shell') ||
    title.includes('bash') ||
    hasAnyString(input, ['command', 'cmd', 'executable', 'program'])
  ) {
    return 'bash';
  }

  if (
    title.includes('read') ||
    title.includes('view') ||
    title.includes('get') ||
    title.includes('open')
  ) {
    return 'read';
  }

  if (
    title.includes('changed') ||
    title.includes('edit') ||
    title.includes('write') ||
    title.includes('patch') ||
    hasAnyString(input, ['old_string', 'new_string', 'oldString', 'newString', 'patch', 'diff'])
  ) {
    return 'edit';
  }

  if (
    title.includes('search') ||
    title.includes('grep') ||
    title.includes('find') ||
    title.includes('glob') ||
    hasAnyString(input, ['query', 'pattern', 'searchTerm', 'term', 'glob'])
  ) {
    return 'search';
  }

  return 'generic';
}

export function extractCommand(input: unknown, fallback?: string): string | undefined {
  const record = asRecord(input);
  if (!record) {
    return fallback;
  }

  const command = toFlatString(record.command) ?? toFlatString(record.cmd);
  if (command) {
    return command;
  }

  const executable = firstString(record.executable, record.program);
  const args = toFlatString(record.args);
  if (executable && args) {
    return `${executable} ${args}`;
  }

  return executable ?? fallback;
}

export function extractOutputText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  const record = asRecord(output);
  if (!record) {
    return '';
  }

  const parts = [
    firstString(record.stdout),
    firstString(record.output),
    firstString(record.content),
    firstString(record.stderr),
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) {
    return parts.join('\n').trim();
  }

  return stringifyUnknown(output);
}

export function extractEditData(input: unknown, output: unknown): {
  path?: string;
  oldText?: string;
  newText?: string;
  diffText?: string;
} {
  const inRecord = asRecord(input);
  const outRecord = asRecord(output);

  const path = firstString(
    inRecord?.path,
    inRecord?.file_path,
    inRecord?.filePath,
    outRecord?.path,
    outRecord?.file_path,
    outRecord?.filePath,
  );

  const oldText = firstString(
    inRecord?.old_string,
    inRecord?.oldString,
    outRecord?.old_string,
    outRecord?.oldString,
    outRecord?.oldContent,
  );
  const newText = firstString(
    inRecord?.new_string,
    inRecord?.newString,
    outRecord?.new_string,
    outRecord?.newString,
    outRecord?.newContent,
  );

  const diffText = firstString(
    outRecord?.diff,
    outRecord?.patch,
    outRecord?.detailedContent,
    outRecord?.content,
    inRecord?.patch,
    inRecord?.diff,
  );

  return { path, oldText, newText, diffText };
}

export function extractSearchData(input: unknown, output: unknown, fallbackDetail?: string): {
  query?: string;
  scope?: string;
  result: ParsedSearchResult;
} {
  const inputRecord = asRecord(input);
  const outputRecord = asRecord(output);
  const query = firstString(
    inputRecord?.query,
    inputRecord?.pattern,
    inputRecord?.searchTerm,
    inputRecord?.term,
    fallbackDetail,
  );
  const scope = firstString(inputRecord?.glob, inputRecord?.path, inputRecord?.paths);
  const result = parseSearchResult(outputRecord, output);
  return { query, scope, result };
}

export function parseSearchResult(outputRecord: ParsedRecord | undefined, output: unknown): ParsedSearchResult {
  const mode = firstString(outputRecord?.mode);
  const filesFromRecord = Array.isArray(outputRecord?.filenames)
    ? outputRecord.filenames.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  const rawText = extractOutputText(output);

  if (filesFromRecord.length > 0 && mode === 'files_with_matches') {
    return { mode, files: filesFromRecord, matches: [], rawText };
  }

  if (!rawText) {
    return { mode, files: filesFromRecord, matches: [], rawText: '' };
  }

  const lines = rawText.split(/\r?\n/u);
  const matches: SearchMatch[] = [];
  const files = new Set(filesFromRecord);

  for (const line of lines) {
    const match = line.match(/^(.+?):(\d+):\s?(.*)$/u);
    if (match) {
      const file = match[1].trim();
      if (file) {
        files.add(file);
        matches.push({
          file,
          line: Number.parseInt(match[2], 10),
          text: match[3] ?? '',
        });
      }
      continue;
    }

    if (line.trim() && !line.includes(':')) {
      files.add(line.trim());
    }
  }

  return { mode, files: [...files], matches, rawText };
}

export function diffWords(oldText: string, newText: string): { oldParts: DiffPart[]; newParts: DiffPart[] } {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  if (oldTokens.length * newTokens.length > 12000) {
    return {
      oldParts: [{ text: oldText, changed: true }],
      newParts: [{ text: newText, changed: true }],
    };
  }

  const lcs = buildLcsTable(oldTokens, newTokens);
  const commonPairs = backtrackCommonPairs(oldTokens, newTokens, lcs);

  const oldParts: DiffPart[] = [];
  const newParts: DiffPart[] = [];

  let oldIndex = 0;
  let newIndex = 0;

  for (const [oldMatchIndex, newMatchIndex] of commonPairs) {
    if (oldMatchIndex > oldIndex) {
      oldParts.push({ text: oldTokens.slice(oldIndex, oldMatchIndex).join(''), changed: true });
    }
    if (newMatchIndex > newIndex) {
      newParts.push({ text: newTokens.slice(newIndex, newMatchIndex).join(''), changed: true });
    }

    const commonText = oldTokens[oldMatchIndex];
    oldParts.push({ text: commonText, changed: false });
    newParts.push({ text: commonText, changed: false });

    oldIndex = oldMatchIndex + 1;
    newIndex = newMatchIndex + 1;
  }

  if (oldIndex < oldTokens.length) {
    oldParts.push({ text: oldTokens.slice(oldIndex).join(''), changed: true });
  }
  if (newIndex < newTokens.length) {
    newParts.push({ text: newTokens.slice(newIndex).join(''), changed: true });
  }

  return {
    oldParts: mergeParts(oldParts),
    newParts: mergeParts(newParts),
  };
}

function tokenize(value: string): string[] {
  return value.split(/(\s+)/u).filter((token) => token.length > 0);
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }

  return table;
}

function backtrackCommonPairs(a: string[], b: string[], table: number[][]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return pairs;
}

function mergeParts(parts: DiffPart[]): DiffPart[] {
  return parts.reduce<DiffPart[]>((acc, part) => {
    if (!part.text) {
      return acc;
    }
    const last = acc[acc.length - 1];
    if (last && last.changed === part.changed) {
      last.text += part.text;
    } else {
      acc.push({ ...part });
    }
    return acc;
  }, []);
}

function asRecord(value: unknown): ParsedRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ParsedRecord : undefined;
}

function hasAnyString(value: ParsedRecord | undefined, keys: string[]): boolean {
  return keys.some((key) => typeof value?.[key] === 'string' && (value[key] as string).trim().length > 0);
}

function toFlatString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
