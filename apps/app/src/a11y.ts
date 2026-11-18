import { Platform } from 'react-native';

import { t } from './i18n';

// What TalkBack gets from accessibilityHint and accessibilityActions, given to the web as well:
// react-native-web drops both (M67).

const WEB = Platform.OS === 'web';
const hintIds = new Map<string, string>();

/** A hidden element with the text, made once per text, for `aria-describedby` to point at. */
function describedBy(text: string): string {
  let id = hintIds.get(text);
  if (id) return id;
  id = `lelap-hint-${hintIds.size + 1}`;
  hintIds.set(text, id);
  const node = document.createElement('span');
  node.id = id;
  node.hidden = true;
  node.textContent = text;
  document.body.appendChild(node);
  return id;
}

/** A hint read after a control's name: TalkBack's own on Android, its description on the web. */
export function hint(text: string | undefined): {
  accessibilityHint?: string;
  'aria-describedby'?: string;
} {
  if (text === undefined) return {};
  return WEB ? { 'aria-describedby': describedBy(text) } : { accessibilityHint: text };
}

/** Delete, and Backspace (the delete key on a Mac keyboard). */
const isDeleteKey = (key: string) => key === 'Delete' || key === 'Backspace';

/**
 * On the web, the Delete key runs a row's TalkBack action (a swipe, a delete) while the row has
 * focus, and the row says so. Nothing elsewhere: TalkBack has the action itself.
 */
export function deleteKeyAction(label: string | undefined, run: () => void): object {
  if (!WEB || label === undefined) return {};
  return {
    'aria-keyshortcuts': 'Delete',
    ...hint(t('Delete key: {action}', { action: label })),
    onKeyDown: (event: {
      key: string;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      target: unknown;
      currentTarget: unknown;
      preventDefault: () => void;
    }) => {
      // Only the row itself: a key pressed on a button inside it bubbles up to here too.
      if (event.target !== event.currentTarget) return;
      if (!isDeleteKey(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      run();
    },
  };
}
