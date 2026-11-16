interface ImportMetaEnv {
  readonly PUBLIC_LELAP_DOMAIN?: string;
  readonly PUBLIC_LELAP_REPO_URL?: string;
  readonly PUBLIC_LELAP_RELEASED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
