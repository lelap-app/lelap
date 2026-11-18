// A page of your own, such as help or a sign-in step, in the style of the SDK's configure pages.
import { PAGE_STYLE } from '@lelap/sdk';

const escape = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `body` is your HTML; `host` is the host the request came to, such as `addon.example.org`. */
export function ownPage({ title, body, host }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body><main>
<h1>${escape(title)}</h1>
${body}
<p class="sender">This page is run by ${escape(host)}, not by Lelap.</p>
</main></body>
</html>`;
}
