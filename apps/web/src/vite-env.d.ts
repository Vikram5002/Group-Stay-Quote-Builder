/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Empty means same origin. */
  readonly VITE_API_BASE_URL?: string;
  /** "mock" runs the app against in-browser mock handlers. Anything else uses the real API. */
  readonly VITE_API_MODE?: string;
}
