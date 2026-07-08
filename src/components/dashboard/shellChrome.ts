// Tiny page→shell signal: lets a page tell DashboardShell to restore the
// sidebar when a chromeless flow (SP onboarding wizard) hands over to a
// phase that needs navigation again (Get Job-Ready). Module-level so it
// works across the shell/page component boundary without prop drilling.

type Listener = (ready: boolean) => void;

let ready = false;
const listeners = new Set<Listener>();

export function publishSpOnboardingReady(value: boolean) {
  ready = value;
  listeners.forEach((l) => l(value));
}

export function getSpOnboardingReady() {
  return ready;
}

export function subscribeSpOnboardingReady(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
