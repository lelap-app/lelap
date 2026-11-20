declare module '*.css';

declare module '@lelap/core/migrations' {
  const migrations: {
    journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
    migrations: Record<string, string>;
  };
  export default migrations;
}

// hls.js's light build (M154) ships no types of its own; it is the full build's API.
declare module 'hls.js/light' {
  export { default } from 'hls.js';
}
