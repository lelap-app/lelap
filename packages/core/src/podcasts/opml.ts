import { asArray, FeedError, isNode, parseXml, textOf, type XmlNode } from './xml';

export type OpmlFeed = { title: string; feedUrl: string };

/** Every feed in an OPML file, including those inside folders, without duplicates. */
export function parseOpml(xml: string): OpmlFeed[] {
  const doc = parseXml(xml);
  const opml = doc.opml;
  const body = isNode(opml) ? asArray(opml.body).find(isNode) : undefined;
  if (!body) throw new FeedError('This is not an OPML file.');
  const feeds: OpmlFeed[] = [];
  const seen = new Set<string>();
  const walk = (node: XmlNode) => {
    for (const outline of asArray(node.outline).filter(isNode)) {
      const feedUrl = textOf(outline['@_xmlUrl']);
      if (/^https?:\/\//i.test(feedUrl) && !seen.has(feedUrl)) {
        seen.add(feedUrl);
        feeds.push({
          title: textOf(outline['@_title']) || textOf(outline['@_text']) || feedUrl,
          feedUrl,
        });
      }
      walk(outline);
    }
  };
  walk(body);
  return feeds;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** OPML 2.0 for other podcast apps. */
export function buildOpml(feeds: OpmlFeed[], now: number): string {
  const outlines = feeds
    .map(
      (f) =>
        `    <outline type="rss" text="${escape(f.title)}" title="${escape(f.title)}" xmlUrl="${escape(f.feedUrl)}"/>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Lelap subscriptions</title>
    <dateCreated>${new Date(now).toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`;
}
