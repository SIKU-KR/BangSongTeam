export { SOCIAL_PROVIDERS, type SocialProvider } from "./authClient";
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
  useSession,
  type AccountHooks,
  type EmailAuthFailure,
} from "./sessionStore";
