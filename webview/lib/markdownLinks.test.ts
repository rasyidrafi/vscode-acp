import { describe, expect, it } from 'vitest';

import { sanitizeMarkdownUrl } from './markdownLinks';

describe('sanitizeMarkdownUrl', () => {
  it('allows http, https, mailto, and relative links', () => {
    expect(sanitizeMarkdownUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeMarkdownUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(sanitizeMarkdownUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(sanitizeMarkdownUrl('/docs/readme')).toBe('/docs/readme');
    expect(sanitizeMarkdownUrl('./local')).toBe('./local');
    expect(sanitizeMarkdownUrl('../parent')).toBe('../parent');
    expect(sanitizeMarkdownUrl('#section')).toBe('#section');
  });

  it('rejects executable or unsupported protocols', () => {
    expect(sanitizeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeMarkdownUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeMarkdownUrl('file:///etc/passwd')).toBe('');
    expect(sanitizeMarkdownUrl('vscode://extension/id')).toBe('');
  });

  it('rejects malformed and empty links', () => {
    expect(sanitizeMarkdownUrl('')).toBe('');
    expect(sanitizeMarkdownUrl('   ')).toBe('');
    expect(sanitizeMarkdownUrl('https://exa mple.com')).toBe('');
  });
});
