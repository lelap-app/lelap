import { DRAG_TYPE, type DragItem, readDrag, writeDrag } from '@lelap/core';
import {
  type ComponentRef,
  createElement,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { View } from 'react-native';

export const DRAG = true;

// While a row is dragged, the rail marks the lists that take it.
let dragging = false;
const listeners = new Set<() => void>();

function setDragging(on: boolean): void {
  if (dragging === on) return;
  dragging = on;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readDragging = () => dragging;

export function useDragging(): boolean {
  return useSyncExternalStore(subscribe, readDragging, readDragging);
}

/** A row the mouse can drag onto a list in the rail, through the browser's own drag and drop. */
export function Draggable({ item, children }: { item: DragItem; children: ReactNode }) {
  // react-native-web hands a View's ref the DOM element.
  const ref = useRef<HTMLElement | null>(null);
  const { kind, id } = item;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.draggable = true;
    const start = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData(DRAG_TYPE, writeDrag({ kind, id }));
      event.dataTransfer.effectAllowed = 'copy';
      setDragging(true);
    };
    const end = () => setDragging(false);
    node.addEventListener('dragstart', start);
    node.addEventListener('dragend', end);
    return () => {
      node.draggable = false;
      node.removeEventListener('dragstart', start);
      node.removeEventListener('dragend', end);
    };
  }, [kind, id]);
  return createElement(View, { ref: ref as unknown as Ref<ComponentRef<typeof View>> }, children);
}

/** A list in the rail that takes a dragged book or episode; `children` draws it, lit while over. */
export function DropTarget({
  onDrop,
  children,
}: {
  onDrop: (item: DragItem) => void;
  children: (over: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [over, setOver] = useState(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Only Lelap's own drags: a file or a link dropped here does nothing.
    const ours = (event: DragEvent) => event.dataTransfer?.types.includes(DRAG_TYPE) === true;
    const enter = (event: DragEvent) => {
      if (!ours(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!node.contains(event.relatedTarget as Node | null)) setOver(false);
    };
    const take = (event: DragEvent) => {
      if (!ours(event)) return;
      event.preventDefault();
      setOver(false);
      setDragging(false);
      const item = readDrag(event.dataTransfer?.getData(DRAG_TYPE) ?? '');
      if (item) drop.current(item);
    };
    node.addEventListener('dragenter', enter);
    node.addEventListener('dragover', enter);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', take);
    return () => {
      node.removeEventListener('dragenter', enter);
      node.removeEventListener('dragover', enter);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', take);
    };
  }, []);
  return createElement(
    View,
    { ref: ref as unknown as Ref<ComponentRef<typeof View>> },
    children(over),
  );
}
