export { SOCIAL_PROVIDERS, type SocialProvider } from "./authClient";
export {
  EmailAuthError,
  hydrateSession,
  signInWithEmail,
  signInWithProvider,
  signUpWithEmail,
  signOut,
  useSession,
  type EmailAuthFailure,
} from "./sessionStore";
