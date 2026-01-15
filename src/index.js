/**
 * @fileoverview Channelstream client library entry point.
 *
 * Exports the main classes for connecting to Channelstream servers:
 * - ChannelStreamConnection: Real-time messaging client (WebSocket/long-poll)
 * - ChannelStreamSigner: Request signing for authenticated API calls
 *
 * @module channelstream-client
 */

import {ChannelStreamConnection} from "./channelstream.js"
import {ChannelStreamSigner} from "./signer.js"

export {
    ChannelStreamConnection,
    ChannelStreamSigner
}
