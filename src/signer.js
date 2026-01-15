/**
 * @fileoverview Request signing utility for Channelstream API authentication.
 *
 * Implements signing compatible with Python's itsdangerous TimedSigner,
 * allowing JavaScript clients to authenticate with Channelstream backends
 * that use signed tokens.
 *
 * @module signer
 */

import {jsSHA1 as jsSHA} from "./sha1-esm.js";

/**
 * Signs requests for secure communication with Channelstream backend API.
 * Compatible with Python's itsdangerous TimedSigner for cross-language auth.
 *
 * @example
 * const signer = new ChannelStreamSigner('your-secret-key');
 * const token = signer.signRequest();
 * // Use token in Authorization header or request body
 */
export class ChannelStreamSigner {

    /**
     * Creates a new signer with the shared secret.
     * @param secret {string} Shared secret key (must match server configuration)
     */
    constructor(secret) {
        this.secret = secret
    }

    /**
     * Converts an integer to URL-safe base64 encoded bytes.
     * Used to encode timestamps in a compact format.
     * @param x {number} Integer to convert (typically Unix timestamp)
     * @returns {string} Base64-encoded byte representation
     * @private
     */
    intToBytes(x) {
        var bytes = [];
        // Extract bytes from integer (little-endian), then reverse for big-endian
        while (x > 0) {
            bytes.push(String.fromCharCode(x & 255));
            x = x >> 8;
        }
        return btoa(bytes.reverse().join(''));
    }

    /**
     * Makes base64 string URL-safe by replacing special characters.
     * Standard base64 uses +/= which are problematic in URLs.
     * @param input {string} Standard base64 string
     * @returns {string} URL-safe base64 string
     * @private
     */
    hashStrip(input) {
        return input.replace('=', '').replace('+', '-').replace('/', '_');
    }

    /**
     * Generates a signed token for API authentication.
     * Token format: channelstream.{timestamp}.{hmac_signature}
     *
     * The signing process:
     * 1. Derive key using SHA-1 hash of salt + 'signer' + secret
     * 2. Encode current Unix timestamp as URL-safe base64
     * 3. Create HMAC-SHA1 signature of 'channelstream.{timestamp}'
     * 4. Return complete signed token
     *
     * @returns {string} Signed token for use in API requests
     */
    signRequest() {
        // Salt matches itsdangerous default for compatibility
        var salt = 'itsdangerous.Signer';
        var derived_key = salt + 'signer' + this.secret;
        var sep = '.';

        // Step 1: Derive signing key using SHA-1
        var shaObj = new jsSHA("SHA-1", "TEXT");
        shaObj.update(derived_key)
        derived_key = shaObj.getHash("BYTES");

        // Step 2: Encode current timestamp
        var timestamp = Math.floor(Date.now() / 1000);
        var value = 'channelstream' + sep + this.hashStrip(this.intToBytes(timestamp));

        // Step 3: Generate HMAC-SHA1 signature
        var shaObj = new jsSHA("SHA-1", "TEXT");
        shaObj.setHMACKey(derived_key, "BYTES");
        shaObj.update(value);
        var hmac = shaObj.getHMAC("B64");

        // Step 4: Assemble final signed token
        return value + sep + this.hashStrip(hmac);
    }
}

