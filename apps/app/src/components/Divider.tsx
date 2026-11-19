import { DIVIDER_WIDTH, type Pane, PANE_LIMITS } from '@lelap/core';
import { useMemo, useRef, useState } from 'react';
import { I18nManager, PanResponder, Platform, View } from 'react-native';

import { hint } from '../a11y';
import { t } from '../i18n';
import { setPaneWidth } from '../layout';

const STEP = 16;
const WEB = Platform.OS === 'web';

/**
 * The line on a pane's start edge (M113): dragging it, or the arrow keys while it has focus,
 * makes the pane wider or narrower; Home goes back to the default. The width stays on this device.
 */
export function Divider({ pane, width, label }: { pane: Pane; width: number; label: string }) {
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Read when a drag starts, so the drag moves from where the pane was.
  const current = useRef(width);
  current.current = width;
  const handlers = useMemo(() => {
    // Toward the start edge widens the pane, whichever side that is.
    const direction = I18nManager.isRTL ? 1 : -1;
    let from = 0;
    const end = (dx: number) => {
      setPaneWidth(pane, from + direction * dx, true);
      setActive(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        from = current.current;
        setActive(true);
      },
      onPanResponderMove: (_, g) => setPaneWidth(pane, from + direction * g.dx, false),
      onPanResponderRelease: (_, g) => end(g.dx),
      onPanResponderTerminate: (_, g) => end(g.dx),
    }).panHandlers;
  }, [pane]);

  const step = (by: number) => setPaneWidth(pane, current.current + by, true);
  const limits = PANE_LIMITS[pane];
  // react-native-web passes these to the element; React Native's types don't know them.
  const web: object = WEB
    ? {
        tabIndex: 0,
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-valuemin': limits.min,
        'aria-valuemax': limits.max,
        'aria-valuenow': width,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        onFocus: () => setHovered(true),
        onBlur: () => setHovered(false),
        onKeyDown: (event: {
          key: string;
          ctrlKey: boolean;
          metaKey: boolean;
          altKey: boolean;
          preventDefault: () => void;
        }) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const wider = I18nManager.isRTL ? 'ArrowRight' : 'ArrowLeft';
          const narrower = I18nManager.isRTL ? 'ArrowLeft' : 'ArrowRight';
          if (event.key === wider) step(STEP);
          else if (event.key === narrower) step(-STEP);
          else if (event.key === 'Home') setPaneWidth(pane, null, true);
          else return;
          event.preventDefault();
        },
        style: {
          width: DIVIDER_WIDTH,
          cursor: 'col-resize',
          userSelect: 'none',
          touchAction: 'none',
        },
      }
    : {
        style: { width: DIVIDER_WIDTH },
        accessible: true,
        accessibilityRole: 'adjustable',
        accessibilityValue: { min: limits.min, max: limits.max, now: width },
        accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
        onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) =>
          step(event.nativeEvent.actionName === 'increment' ? STEP : -STEP),
      };

  return (
    <View
      {...handlers}
      {...web}
      accessibilityLabel={label}
      {...hint(
        WEB ? t('Drag, or use the arrow keys, to change the width') : t('Drag to change the width'),
      )}
      className="items-center bg-night"
    >
      <View className={`h-full ${active || hovered ? 'w-0.5 bg-amber' : 'w-px bg-line'}`} />
    </View>
  );
}
