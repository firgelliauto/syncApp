export function indexVariants(variants) {
  const bySku = new Map();
  const duplicates = new Map();
  let blankSku = 0;

  for (const variant of variants) {
    const sku = variant.sku;
    if (!sku?.trim()) {
      blankSku++;
      continue;
    }
    if (bySku.has(sku)) {
      const existing = duplicates.get(sku) ?? [bySku.get(sku)];
      existing.push(variant);
      duplicates.set(sku, existing);
    } else {
      bySku.set(sku, variant);
    }
  }
  for (const sku of duplicates.keys()) bySku.delete(sku);
  return { bySku, duplicates, blankSku };
}

export function compareCatalogs(mainVariants, childVariants, excludedSkus = new Set()) {
  const main = indexVariants(mainVariants);
  const child = indexVariants(childVariants);
  const rows = [];
  const skus = new Set([...main.bySku.keys(), ...child.bySku.keys(), ...main.duplicates.keys(), ...child.duplicates.keys()]);

  for (const sku of [...skus].sort()) {
    const a = main.bySku.get(sku);
    const b = child.bySku.get(sku);
    let status;
    if (main.duplicates.has(sku) || child.duplicates.has(sku)) status = 'duplicate_sku';
    else if (excludedSkus.has(sku)) status = 'excluded_sku';
    else if (!a) status = 'only_child';
    else if (!b) status = 'only_main';
    else if (!a.tracked || !b.tracked) status = 'not_tracked';
    else if (a.requiresShipping === false || b.requiresShipping === false) status = 'nonphysical_item';
    else if (a.inventoryPolicy === 'CONTINUE' || b.inventoryPolicy === 'CONTINUE') status = 'continues_selling';
    else if (a.quantity === null || b.quantity === null) status = 'not_stocked_at_location';
    else if (a.quantity < 0 || b.quantity < 0) status = 'negative_available';
    else if (a.quantity !== b.quantity) status = 'different_quantity';
    else status = 'matched';
    rows.push({ sku, status, mainQuantity: a?.quantity ?? null, childQuantity: b?.quantity ?? null,
      mainVariantId: a?.id ?? null, childVariantId: b?.id ?? null });
  }

  const counts = Object.fromEntries([...new Set(rows.map(row => row.status))].map(status =>
    [status, rows.filter(row => row.status === status).length]));
  return { summary: { mainVariants: mainVariants.length, childVariants: childVariants.length,
    mainBlankSkus: main.blankSku, childBlankSkus: child.blankSku, counts }, rows };
}
