// Dragging a book, an episode or a catalog item onto a list. On Android (M120) this is the app's
// own: press a row, hold a moment and move it, with a finger, a stylus or a mouse. React Native
// has no drag and drop of its own; the web uses the browser's (drag.web.tsx).
import { type DragItem, dragStarts, type DropZone, zoneAt } from '@lelap/core';
import {
  type ComponentRef,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  Dimensions,
  I18nManager,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';

import { useWide } from './layout';

type Drag = { item: DragItem; label: string; x: number; y: number; over: string | null };
type Node = ComponentRef<typeof View>;
type Target = {
  node: Node | null;
  enabled: boolean;
  rank: number;
  drop: (item: DragItem) => void;
};

let drag: Drag | null = null;
let zones: (DropZone & { rank: number })[] = [];
const targets = new Map<string, Target>();
const listeners = new Set<() => void>();

function set(next: Drag | null): void {
  drag = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readDrag = () => drag;
const readDragging = () => drag !== null;

// Only the drag's picture follows every move; the lists hear when a drag starts, ends or
// moves over them.
function useDrag(): Drag | null {
  return useSyncExternalStore(subscribe, readDrag, readDrag);
}

/** Whether something is being dragged right now. */
export function useDragging(): boolean {
  return useSyncExternalStore(subscribe, readDragging, readDragging);
}

function useOver(key: string): boolean {
  const read = () => drag?.over === key;
  return useSyncExternalStore(subscribe, read, read);
}

// The lists are measured once as a drag starts; none of them moves while it lasts. One outside
// the window (scrolled away) takes nothing, and the rail wins over a card beneath it.
function measureZones(): void {
  zones = [];
  const window = Dimensions.get('window');
  for (const [key, target] of targets) {
    if (!target.enabled || !target.node) continue;
    const { rank } = target;
    target.node.measure((_x, _y, width, height, pageX, pageY) => {
      if (!drag || width <= 0 || height <= 0) return;
      if (pageX + width <= 0 || pageY + height <= 0) return;
      if (pageX >= window.width || pageY >= window.height) return;
      zones.push({ key, x: pageX, y: pageY, width, height, rank });
      zones.sort((a, b) => a.rank - b.rank);
    });
  }
}

function moveTo(x: number, y: number): void {
  if (drag) set({ ...drag, x, y, over: zoneAt(zones, x, y) });
}

function finish(drop: boolean): void {
  const ended = drag;
  set(null);
  zones = [];
  if (!drop || !ended?.over) return;
  targets.get(ended.over)?.drop(ended.item);
}

/**
 * A row that can be dragged onto a list, on a tablet or another wide window. On a phone it is the
 * row alone: there the row's menu adds it to a list, and a held finger still scrolls.
 */
export function Draggable({
  item,
  label,
  children,
}: {
  item: DragItem;
  /** What the drag shows under the pointer, such as the book's title. */
  label: string;
  children: ReactNode;
}) {
  const wide = useWide();
  const press = useRef<{ at: number; x: number; y: number } | null>(null);
  const current = useRef({ item, label });
  current.current = { item, label };
  // Always the same View, so a window crossing the wide breakpoint doesn't remount the row.
  const handlers: ViewProps = !wide
    ? {}
    : {
        onTouchStart: (e) => {
          const { pageX, pageY, touches } = e.nativeEvent;
          press.current = touches.length > 1 ? null : { at: Date.now(), x: pageX, y: pageY };
        },
        onTouchEnd: () => (press.current = null),
        // Asked before the row's own press and swipe, so a held row moves instead of scrolling.
        onMoveShouldSetResponderCapture: (e) => {
          const start = press.current;
          if (!start || targets.size === 0) return false;
          const { pageX, pageY } = e.nativeEvent;
          return dragStarts(Date.now() - start.at, pageX - start.x, pageY - start.y);
        },
        onResponderGrant: (e) => {
          const { pageX, pageY } = e.nativeEvent;
          set({ ...current.current, x: pageX, y: pageY, over: null });
          measureZones();
          // True keeps the list from taking the touch over to scroll.
          return true;
        },
        onResponderMove: (e) => moveTo(e.nativeEvent.pageX, e.nativeEvent.pageY),
        onResponderTerminationRequest: () => false,
        onResponderRelease: () => finish(true),
        onResponderTerminate: () => finish(false),
      };
  return <View {...handlers}>{children}</View>;
}

/** A list that takes a dragged item; `children` draws it, lit while the drag is over it. */
export function DropTarget({
  onDrop,
  enabled,
  rail = false,
  children,
}: {
  onDrop: (item: DragItem) => void;
  enabled: boolean;
  /** A list in the rail, which wins over anything drawn beneath it. */
  rail?: boolean;
  children: (over: boolean) => ReactNode;
}) {
  const key = useId();
  const node = useRef<Node | null>(null);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    targets.set(key, {
      node: node.current,
      enabled,
      rank: rail ? 1 : 0,
      drop: (item) => drop.current(item),
    });
    return () => {
      targets.delete(key);
    };
  }, [key, enabled, rail]);
  const over = useOver(key);
  return (
    <View
      ref={(view) => {
        node.current = view;
        const target = targets.get(key);
        if (target) target.node = view;
      }}
      collapsable={false}
    >
      {children(over)}
    </View>
  );
}

/** What is being dragged, drawn under the pointer above every screen. */
export function DragHost() {
  const current = useDrag();
  const { width } = useWindowDimensions();
  if (!current) return null;
  // The pointer is in page points from the left; a right-to-left layout counts `start` from the right.
  const start = I18nManager.isRTL ? width - current.x + 12 : current.x + 12;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{ position: 'absolute', start, top: current.y + 12, maxWidth: 240 }}
        className={`rounded-xl border px-3 py-2 ${current.over ? 'border-amber bg-night' : 'border-line bg-raised'}`}
      >
        <Text numberOfLines={1} className="text-sm text-paper">
          {current.label}
        </Text>
      </View>
    </View>
  );
}
