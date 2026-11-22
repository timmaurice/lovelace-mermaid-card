/** A zoomed view: `k` times the size the content is laid out at, then shifted by `x`, `y` pixels. */
export interface View {
  k: number;
  x: number;
  y: number;
}

const FIT: View = { k: 1, x: 0, y: 0 };
// A pointer that moves less than this still taps, so bound nodes stay usable.
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 300;

type Point = [number, number];

/** Keeps `k` between 1 (fitted) and `max`, and the content covering the `width` × `height` area. */
export function clampView({ k, x, y }: View, width: number, height: number, max: number): View {
  const scale = Math.min(Math.max(k, 1), max);
  const clamp = (value: number, size: number) => Math.min(0, Math.max(size * (1 - scale), value));
  return { k: scale, x: clamp(x, width), y: clamp(y, height) };
}

/** Scales a view by `factor` around the point (px, py), which stays where it is on screen. */
export function zoomAt(view: View, factor: number, px: number, py: number, max: number): View {
  const k = Math.min(Math.max(view.k * factor, 1), max);
  const ratio = k / view.k;
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/**
 * Pinch, wheel and drag zoom and pan for the element inside `area`, as a CSS transform. A double
 * tap or click, or 0 on `keys`, fits it again; + and − zoom.
 */
export function attachZoom(area: HTMLElement, keys: HTMLElement) {
  const pointers = new Map<number, Point>();
  let view = FIT;
  let start: Point = [0, 0];
  let moved = false;
  let lastTap = 0;
  const controls = {
    max: 4,
    apply(next: View = view) {
      view = clampView(next, area.clientWidth, area.clientHeight, controls.max);
      const content = area.firstElementChild as SVGElement | null;
      if (content) content.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    },
    reset: () => controls.apply(FIT),
    zoom: (factor: number, [px, py]: Point = [area.clientWidth / 2, area.clientHeight / 2]) =>
      controls.apply(zoomAt(view, factor, px, py, controls.max)),
  };
  const local = (event: MouseEvent): Point => {
    const box = area.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  area.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    if (event.isPrimary) pointers.clear(); // drops a pointer whose up went elsewhere
    pointers.set(event.pointerId, local(event));
    if (pointers.size === 1) [start, moved] = [local(event), false];
    else moved = true; // a pinch is never a tap
  });
  area.addEventListener('pointermove', (event) => {
    const last = pointers.get(event.pointerId);
    const point = local(event);
    if (!last || (!moved && Math.hypot(point[0] - start[0], point[1] - start[1]) < TAP_SLOP)) return;
    moved = true;
    // Captured only once it is a drag: captured from the start, a tap's click would miss the node.
    if (!area.hasPointerCapture(event.pointerId)) area.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point);
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    if (!other) return controls.apply({ ...view, x: view.x + point[0] - last[0], y: view.y + point[1] - last[1] });
    // A pinch follows the fingers' midpoint and scales around it by how far they spread.
    const [x0, y0] = [(last[0] + other[0]) / 2, (last[1] + other[1]) / 2];
    const [x1, y1] = [(point[0] + other[0]) / 2, (point[1] + other[1]) / 2];
    const factor =
      Math.hypot(point[0] - other[0], point[1] - other[1]) / (Math.hypot(last[0] - other[0], last[1] - other[1]) || 1);
    controls.apply(zoomAt({ ...view, x: view.x + x1 - x0, y: view.y + y1 - y0 }, factor, x1, y1, controls.max));
  });
  const release = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId) || event.type !== 'pointerup' || moved || pointers.size) return;
    if (event.timeStamp - lastTap < DOUBLE_TAP_MS) controls.reset();
    lastTap = event.timeStamp;
  };
  area.addEventListener('pointerup', release);
  area.addEventListener('pointercancel', release);
  // A drag that ends on a bound node must not run its tap action.
  area.addEventListener(
    'click',
    (event) => {
      if (moved) event.stopPropagation();
    },
    true,
  );
  area.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      // A trackpad pinch arrives as a wheel with ctrlKey, in much smaller steps than a mouse wheel.
      controls.zoom(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), local(event));
    },
    { passive: false },
  );
  keys.addEventListener('keydown', (event) => {
    const factor = ({ '+': 1.25, '=': 1.25, '-': 0.8 } as Record<string, number>)[event.key];
    if (factor) controls.zoom(factor);
    else if (event.key === '0') controls.reset();
  });
  return controls;
}
