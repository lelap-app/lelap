interface ImportMetaEnv {
  readonly PUBLIC_LELAP_DOMAIN?: string;
  readonly PUBLIC_LELAP_REPO_URL?: string;
  readonly PUBLIC_LELAP_RELEASED?: string;
  readonly PUBLIC_LELAP_BETA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
