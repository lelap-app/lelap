import { usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler, View } from 'react-native';

import { t } from '../i18n';
import { useColumns, usePaneWidths } from '../layout';
import { closeDetail, useDetail } from '../navigation';
import { Divider } from './Divider';
import { ItemPage } from './ItemPage';
import { PodcastPage } from './PodcastPage';

/**
 * The third column on a very wide window (M113): a book's or a show's page between the list it
 * was opened from and the player. When the window narrows, the page moves to full screen.
 */
export function DetailPane() {
  const page = useDetail();
  const columns = useColumns();
  const pathname = usePathname();
  const router = useRouter();
  const { detail: width } = usePaneWidths();

  const covered = pathname === '/player' || pathname === '/car';
  useEffect(() => {
    if (!page || columns === 3) return;
    closeDetail();
    if (!covered) router.push(page);
  }, [page, columns, covered, router]);

  // On a tablet, Back closes the column before it leaves the screen beside it.
  useEffect(() => {
    if (!page || columns < 3 || covered) return;
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
