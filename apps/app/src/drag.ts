// Dragging a book or an episode onto a list in the rail is the web's, with a mouse (M113); see
// drag.web.ts. On Android the row's menu adds it to a list.
import type { DragItem } from '@lelap/core';
import type { ReactNode } from 'react';

export const DRAG = false;

/** Wraps a row that can be dragged onto a list; on Android it is the row alone. */
export function Draggable({ children }: { item: DragItem; children: ReactNode }) {
  return children;
}

/** Whether something of Lelap's is being dragged right now. */
export function useDragging(): boolean {
  return false;
}

/** Wraps a list in the rail that takes a drop; on Android it is the list alone. */
export function DropTarget({
  children,
}: {
  onDrop: (item: DragItem) => void;
  enabled: boolean;
  children: (over: boolean) => ReactNode;
}) {
  return children(false);
}
