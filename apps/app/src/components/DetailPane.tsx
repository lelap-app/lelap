import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { BackHandler, Platform, View } from 'react-native';

import { t } from '../i18n';
import { useColumns, usePaneWidths } from '../layout';
import { closeDetail, closeStaleDetail, type Page, showDetail, useDetail } from '../navigation';
import { useLibrary } from '../player';
import { Divider } from './Divider';
import { ItemPage } from './ItemPage';
import { PodcastPage } from './PodcastPage';

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The page a full-screen route shows, or null for any other screen. */
function routePage(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
): Page | null {
  if (pathname === '/item') {
    const id = one(params.id);
    return id
      ? ({ pathname: '/item', params: { type: one(params.type) ?? '', id } } as const)
      : null;
  }
  if (pathname === '/podcast') {
    const id = one(params.id);
    const item = one(params.item);
    return {
      pathname: '/podcast',
      params: { ...(id ? { id } : {}), ...(item ? { item } : {}) },
    } as const;
  }
  return null;
}

/**
 * The third column on a very wide window (M113): a book's or a show's page between the list it
 * was opened from and the player. When the window narrows, the page moves to full screen; when it
 * widens, a full-screen page moves into the column, so only one page is open at a time (M120).
 */
export function DetailPane() {
  const page = useDetail();
  const columns = useColumns();
  const pathname = usePathname();
  const router = useRouter();
  const params = useGlobalSearchParams();
  const { detail: width } = usePaneWidths();
  const { version } = useLibrary();

  // A page another profile opened closes on the switch (`version` changes with it).
  useEffect(() => closeStaleDetail(), [version]);

  const covered = pathname === '/player' || pathname === '/car';
  // The top full-screen page while the pages under it are closed, then shown in the column.
  const moving = useRef<Page | null>(null);
  const shown = useRef(params);
  shown.current = params;
  // Two pages in a row have the same path; their parameters tell them apart.
  const route = `${pathname}?${JSON.stringify(params)}`;
  useEffect(() => {
    if (columns < 3 || covered) {
      moving.current = null;
      return;
    }
    const top = routePage(pathname, shown.current);
    if (top) {
      moving.current ??= top;
      if (router.canGoBack()) router.back();
      else router.replace('/');
      return;
    }
    if (moving.current) {
      showDetail(moving.current);
      moving.current = null;
    }
  }, [columns, covered, pathname, route, router]);
  useEffect(() => {
    if (!page || columns === 3) return;
    closeDetail();
    if (!covered) router.push(page);
  }, [page, columns, covered, router]);

  // On a tablet, Back closes the column before it leaves the screen beside it. A browser has no
  // Back button of its own for this; React Native Web warns when asked.
  useEffect(() => {
    if (!page || columns < 3 || covered || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeDetail();
      return true;
    });
    return () => sub.remove();
  }, [page, columns, covered]);

  if (!page || columns < 3 || covered) return null;
  return (
    <>
      <Divider pane="detail" width={width} label={t('Page width')} />
      <View style={{ width }} className="bg-night">
        {page.pathname === '/item' ? (
          <ItemPage
            key={`${page.params.type}:${page.params.id}`}
            type={page.params.type}
            id={page.params.id}
            onBack={closeDetail}
            column
          />
        ) : (
          <PodcastPage
            key={`${page.params.id ?? ''}:${page.params.item ?? ''}`}
            id={page.params.id}
            item={page.params.item}
            onBack={closeDetail}
            column
          />
        )}
      </View>
    </>
  );
}
