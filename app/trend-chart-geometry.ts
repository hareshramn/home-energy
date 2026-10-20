/** SVG coordinates and its intrinsic layout size use the same responsive height.
 * Bottom padding contains 5px ticks, 10px labels, and baseline/descender space.
 */
export function trendChartGeometry(mobile: boolean) {
  return { width: 360, height: mobile ? 215 : 275, left: 32, right: 5, top: 16, bottom: mobile ? 30 : 24 };
}

const query = '(max-width: 600px)';
export const isMobileTrendChart = () => window.matchMedia(query).matches;
export const serverTrendChart = () => false;
export function subscribeTrendViewport(notify: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
}
