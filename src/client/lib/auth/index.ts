export { SOCIAL_PROVIDERS, type SocialProvider } from "./authClient";
export {
  EmailAuthError,
  getCurrentUserId,
  hydrateSession,
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
