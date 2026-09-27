import { readFileSync } from 'node:fs';

export function loadExcludedSkus() {
  const text = readFileSync(new URL('../config/excluded-skus.txt', import.meta.url), 'utf8');
  return new Set(text.split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith('#')));
}
