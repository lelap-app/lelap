# apps/site

The landing page for lelap.app. Astro, static output, no client-side JavaScript.

- **Content rules:** everything in the root `AGENTS.md` applies. Never name piracy-oriented services,
  and keep the copyright contact on the page.
- **Config, not constants:** hosts, the repository URL and the released state come from `src/site.ts`,
  which reads `PUBLIC_LELAP_*` variables. Don't hard-code `lelap.app` in pages.
- **Unreleased state:** while `site.released` is false, nothing may link to the APK or the web app;
  they don't exist yet.
- **No third-party requests:** fonts come from `@fontsource-variable/*`, icons are inline SVG in
  `src/components/Icon.astro`. The privacy page promises this.
- **Styling:** tokens and shared classes in `src/styles/global.css`, component styles in each
  `.astro` file. One dark theme; amber (`--accent`) is the only accent colour.
- **Commands:** `pnpm --filter @lelap/site dev | build | check`. Deploy setup is in `README.md`.
