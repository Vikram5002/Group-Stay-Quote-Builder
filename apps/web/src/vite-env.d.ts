/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Empty means same origin. */
  readonly VITE_API_BASE_URL?: string;
  /** "mock" runs the app against in-browser mock handlers. Anything else uses the real API. */
  readonly VITE_API_MODE?: string;
  /**
   * "dev" identifies the caller with x-dev-user (local API only); "cognito" signs in with the
   * Cognito hosted UI and sends its access token. Default: the practice sign-in, bearer token.
   */
  readonly VITE_AUTH_MODE?: string;
  /** Cognito hosted UI base URL, for VITE_AUTH_MODE=cognito. */
  readonly VITE_COGNITO_DOMAIN?: string;
  /** Cognito app client id (public, no secret), for VITE_AUTH_MODE=cognito. */
  readonly VITE_COGNITO_CLIENT_ID?: string;
}
