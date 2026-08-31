export function calculateReadingProgress({
  clientHeight,
  scrollHeight,
  scrollTop,
}: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}) {
  const scrollableDistance = scrollHeight - clientHeight;
  if (scrollableDistance <= 1) return null;

  return Math.min(1, Math.max(0, scrollTop / scrollableDistance));
}
