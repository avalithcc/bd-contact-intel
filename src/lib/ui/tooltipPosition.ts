/**
 * Where a tooltip bubble goes (src/components/Tooltip.tsx). Pure: the component measures the DOM and passes numbers in. The
 * bubble is `position: fixed`, so it is never clipped by an `overflow` ancestor such as `.table-wrap`.
 */
export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface BubblePlacement {
  top: number;
  left: number;
  placement: "below" | "above";
}

/** Space kept between the bubble and the viewport edge. */
const EDGE = 8;

export function placeBubble(input: {
  trigger: Box;
  bubble: { width: number; height: number };
  viewport: { width: number; height: number };
  align: "start" | "end";
  gap?: number;
}): BubblePlacement {
  const { trigger, bubble, viewport, align, gap = 6 } = input;
  const wanted = align === "end" ? trigger.right - bubble.width : trigger.left;
  const left = Math.max(EDGE, Math.min(wanted, viewport.width - bubble.width - EDGE));

  const below = trigger.bottom + gap;
  const above = trigger.top - gap - bubble.height;
  const fitsBelow = below + bubble.height <= viewport.height - EDGE;
  if (!fitsBelow && above >= EDGE) return { top: above, left, placement: "above" };
  return { top: below, left, placement: "below" };
}
