const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function sanitizeMarkdownUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  if (isRelativeUrl(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : '';
  } catch {
    return '';
  }
}

function isRelativeUrl(url: string): boolean {
  return url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('#');
}
