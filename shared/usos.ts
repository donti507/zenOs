/** Public fixed errors only; never forward OAuth/provider/admin error text. */
export const USOS_ERRORS:Record<string,string>={
 denied:'USOS consent was declined. You can try again.',expired:'This USOS sign-in expired or was already used. Start again.',csrf:'This USOS sign-in belongs to another browser. Start again here.',
 unavailable:'USOS sign-in is temporarily unavailable. Please try again.',disabled:'USOS sign-in is not configured.',invalid_host:'Open ZEN OS at zenose.tech to use USOS sign-in.',
 link_required:'This email already has a ZEN OS account. Sign in with your existing method, then choose Connect USOS in your account menu.',
 account_mismatch:'That university email belongs to another account or is not verified. Sign in to the matching verified account before connecting.',
 already_linked:'This USOS identity or ZEN OS account is already connected to a different account.',provider_mismatch:'This USOS connection belongs to another university configuration. Contact the administrator.',
 sign_in_required:'Sign in before connecting or disconnecting USOS.',rate_limited:'Too many USOS sign-in attempts. Wait a minute and try again.',
};
export function usosError(code:unknown){return typeof code==='string'&&Object.hasOwn(USOS_ERRORS,code)?USOS_ERRORS[code]:USOS_ERRORS.unavailable;}
