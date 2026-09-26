/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API origin for split deployments; '' = same-origin /api. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
