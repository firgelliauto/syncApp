import { excludedSkus } from '../config/excluded-skus.mjs';

export function loadExcludedSkus() {
  return new Set(excludedSkus);
}
