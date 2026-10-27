export {
  SOCIAL_PROVIDERS,
  visibleSocialProviders,
  type SocialProvider,
} from "./authClient";
export {
  AUTH_ERROR_PARAM,
  callbackErrorMessage,
  withoutAuthError,
} from "./authError";
export {
  EmailAuthError,
  finishPendingSignOut,
  getCurrentUserId,
  hydrateSession,
  listenToOtherTabs,
  resumeDeferredSessionWork,
  setAccountHooks,
  signInWithEmail,
  signInWithProvider,
  signUpWithEmail,
  signOut,
  SocialSignInError,
  useSession,
  type AccountHooks,
  type EmailAuthFailure,
} from "./sessionStore";
