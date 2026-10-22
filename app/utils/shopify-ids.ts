// Numeric id at the end of a Shopify GID, for use in URLs.
export function legacyId(gid: string) {
  return gid.slice(gid.lastIndexOf("/") + 1);
}

export function inventoryItemGid(id: string) {
  return `gid://shopify/InventoryItem/${id}`;
}
