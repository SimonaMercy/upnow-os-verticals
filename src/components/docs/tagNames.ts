/**
 * Tag naming convention shared with the backend
 * (`upnow-backend/src/shared/swagger/tag-groups.ts`): every tag is spelled
 * `Group · Tag`, so the product a tag belongs to is readable off its name even
 * when `x-tagGroups` is absent.
 */

/** `Rental Provider · Leases` -> `Rental Provider` ('' when unprefixed). */
export function groupOf(tag: string): string {
  const i = tag.indexOf(' · ');
  return i === -1 ? '' : tag.slice(0, i);
}

/** `Rental Provider · Leases` -> `Leases` (the group heading supplies the rest). */
export function tagLabel(tag: string): string {
  const i = tag.indexOf(' · ');
  return i === -1 ? tag : tag.slice(i + 3);
}
