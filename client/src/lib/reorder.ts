/** `ids` with `moved` taken out and put just before (or after) `target`. Unknown ids leave the list unchanged. */
export function reorder(ids: string[], moved: string, target: string, after: boolean): string[] {
  if (moved === target || !ids.includes(moved) || !ids.includes(target)) return ids;
  const rest = ids.filter((g) => g !== moved);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}
