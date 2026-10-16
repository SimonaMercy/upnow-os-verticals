/**
 * PROTOTYPE ONLY — toasts routed to the prototype's own <Toaster id>.
 *
 * sonner shows a toast only in the toaster whose `id` matches its `toasterId`
 * (and the production root toaster, which has no id, only shows toasts without
 * one). Every prototype toast goes through here, so it renders in the
 * prototype toaster (bottom-left, clear of right-hand drawers) and never in
 * the production one.
 */
import { toast as sonner, type ExternalToast } from 'sonner';

export const PROTO_TOASTER = 'upnow-prototype';

const opts = (o?: ExternalToast): ExternalToast => ({ ...o, toasterId: PROTO_TOASTER });

export const toast = {
  success: (message: string, o?: ExternalToast) => sonner.success(message, opts(o)),
  error: (message: string, o?: ExternalToast) => sonner.error(message, opts(o)),
  message: (message: string, o?: ExternalToast) => sonner.message(message, opts(o)),
};
