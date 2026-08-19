import {
    startRegistration as _startRegistration,
    startAuthentication as _startAuthentication,
    browserSupportsWebAuthn,
    platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';

/**
 * Check if the browser supports WebAuthn/passkeys
 */
export function isWebAuthnSupported() {
    return browserSupportsWebAuthn();
}

/**
 * Check if the device has a platform authenticator (fingerprint, face, etc.)
 */
export async function isPlatformAuthenticatorAvailable() {
    try {
        return await platformAuthenticatorIsAvailable();
    } catch {
        return false;
    }
}

/**
 * Start WebAuthn registration (passkey creation)
 * @param {Object} optionsJSON - Server-generated registration options
 * @returns {Promise<Object>} Registration response to send to server
 */
export async function startRegistration(optionsJSON) {
    return _startRegistration({ optionsJSON });
}

/**
 * Start WebAuthn authentication (passkey login)
 * @param {Object} optionsJSON - Server-generated authentication options
 * @returns {Promise<Object>} Authentication response to send to server
 */
export async function startAuthentication(optionsJSON) {
    return _startAuthentication({ optionsJSON });
}
