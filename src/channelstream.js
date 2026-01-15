/**
 * @fileoverview Channelstream client library for real-time messaging.
 *
 * This module provides a client for connecting to Channelstream servers,
 * supporting WebSocket connections with automatic long-polling fallback.
 * Features include:
 * - Automatic reconnection with exponential backoff (up to 60 seconds)
 * - Heartbeat mechanism to maintain connection
 * - Request mutator system for customizing outgoing requests
 * - Channel subscription management
 *
 * @module channelstream
 */

/**
 * Main Channelstream connection class.
 *
 * Manages the connection lifecycle, channel subscriptions, and message handling
 * for real-time communication with a Channelstream server.
 *
 * @example
 * const conn = new ChannelStreamConnection();
 * conn.connectUrl = '/api/connect';
 * conn.websocketUrl = 'wss://example.com/ws';
 * conn.username = 'user123';
 * conn.channels = ['lobby', 'notifications'];
 * conn.connect();
 */
export class ChannelStreamConnection {

    static get version() {
        return '0.1.1';
    }

    constructor() {
        // --- Debug settings ---
        this.debug = false;

        // --- User and connection state ---
        /** List of channels user should be subscribed to. */
        this.channels = [];
        /** Username of connecting user. */
        this.username = 'Anonymous';
        /** Connection identifier returned by server after connect(). */
        this.connectionId = null;
        /** WebSocket instance (null when using long-polling). */
        this.websocket = null;
        /** Whether currently connected to the server. */
        this.connected = false;

        // --- Endpoint URLs (must be configured before connect()) ---
        /** WebSocket connection URL (e.g., 'wss://example.com/ws'). */
        this.websocketUrl = '';
        /** URL used in `connect()`. */
        this.connectUrl = '';
        /** URL used in `disconnect()`. */
        this.disconnectUrl = '';
        /** URL used in `subscribe()`. */
        this.subscribeUrl = '';
        /** URL used in `unsubscribe()`. */
        this.unsubscribeUrl = '';
        /** URL used in `updateUserState()`. */
        this.userStateUrl = '';
        /** URL used in `message()`. */
        this.messageUrl = '';
        /** URL used in `editMessage()`. */
        this.messageEditUrl = '';
        /** URL used in `deleteMessage()`. */
        this.messageDeleteUrl = '';
        /** Long-polling connection URL (fallback when WebSocket unavailable). */
        this.longPollUrl = '';

        // --- Reconnection settings ---
        /** Whether to automatically reconnect on connection loss. */
        this.shouldReconnect = true;
        /** Whether to send periodic heartbeats to keep connection alive. */
        this.heartbeats = true;
        /** Reconnection backoff increment in milliseconds. */
        this.increaseBounceIv = 2000;
        /** Current reconnection interval (increases with each retry). */
        this._currentBounceIv = 0;
        /** Force long-polling instead of WebSocket if true. */
        this.noWebsocket = false;

        /**
         * Mutators are functions that transform request data before sending.
         * Use addMutator() to register functions for specific request types.
         * Mutators execute in registration order, allowing request customization
         * (e.g., adding authentication headers, modifying payloads).
         */
        this.mutators = {
            connect: [],
            message: [],
            messageEdit: [],
            messageDelete: [],
            subscribe: [],
            unsubscribe: [],
            disconnect: [],
            userState: []
        }
    }

    /**
     * Sends AJAX call that creates user and fetches connection information
     * from the server.
     *
     */
    connect() {
        let request = new ChannelStreamRequest();
        request.url = this.connectUrl;
        request.body = {
            username: this.username,
            channels: this.channels
        };
        for (let callable of this.mutators.connect) {
            callable(request);
        }
        request.handleError = this._handleConnectError.bind(this);
        request.handleResponse = this._handleConnect.bind(this);
        request.execute();
    }

    /**
     *
     * Add custom function that will manipulate request before its being executed
     *
     * @param type {string} type of mutator function to register
     * @param func {function} a callable to register
     */
    addMutator(type, func) {
        this.mutators[type].push(func);
    }

    /**
     * Sends AJAX request to update user state.
     * @param stateObj {object}
     */
    updateUserState(stateObj) {
        let request = new ChannelStreamRequest();
        request.url = this.userStateUrl;
        request.body = {
            username: this.username,
            conn_id: this.connectionId,
            update_state: stateObj
        };
        for (let callable of this.mutators.userState) {
            callable(request);
        }
        request.handleError = this._handleSetUserStateError.bind(this);
        request.handleResponse = this._handleSetUserState.bind(this);
        request.execute();
    }

    /**
     * Subscribes user to channels.
     * @param channels {string[]} List of channels sent via POST to `subscribeUrl`.
     */
    subscribe(channels) {
        let request = new ChannelStreamRequest();
        request.url = this.subscribeUrl;
        request.body = {
            channels: channels,
            conn_id: this.connectionId
        };
        for (let callable of this.mutators.subscribe) {
            callable(request);
        }
        request.handleError = this._handleSubscribeError.bind(this);
        request.handleResponse = this._handleSubscribe.bind(this);
        if (request.body.channels && request.body.channels.length) {
            request.execute('POST');
        }
    }

    /**
     * Unsubscribes user from channels.
     * @param channels {string[]} List of channels sent via POST to `unsubscribeUrl`.
     */
    unsubscribe(channels) {
        let request = new ChannelStreamRequest();
        request.url = this.unsubscribeUrl;
        request.body = {
            channels: channels,
            conn_id: this.connectionId
        };
        for (let callable of this.mutators.unsubscribe) {
            callable(request);
        }
        request.handleError = this._handleUnsubscribeError.bind(this);
        request.handleResponse = this._handleUnsubscribe.bind(this);
        request.execute('POST');
    }

    /**
     * calculates list of channels we should add user to based on difference
     * between channels property and passed channel list
     * @param channels {string[]} List of channels to subscribe
     */
    calculateSubscribe(channels) {
        let toSubscribe = [];
        for (let channel of channels) {
            if (this.channels.indexOf(channel) === -1) {
                toSubscribe.push(channel);
            }
        }
        return toSubscribe;
    }

    /**
     * calculates list of channels we should remove user from based difference
     * between channels property and passed channel list
     * @param channels {string[]} List of channels to un-subscribe
     */
    calculateUnsubscribe(channels) {
        if (!channels) {
            channels = []
        }
        let toUnsubscribe = [];

        for (let channel of channels) {
            if (this.channels.indexOf(channel) !== -1) {
                toUnsubscribe.push(channel);
            }
        }
        return toUnsubscribe;
    }

    /**
     * Marks the connection as expired via /disconnect API.
     *
     */
    disconnect() {
        let request = new ChannelStreamRequest();
        request.url = this.disconnectUrl + '?conn_id=' + this.connectionId;
        request.body = {
            conn_id: this.connectionId
        };
        for (let callable of this.mutators.disconnect) {
            callable(request);
        }
        request.handleResponse = this._handleDisconnect.bind(this);
        request.execute();
        this.closeConnection();
    }

    /**
     * Sends a POST to the web application backend.
     * @param message {object} Message object sent via POST to `messageUrl`.
     */
    message(message) {
        let request = new ChannelStreamRequest();
        request.url = this.messageUrl;
        request.body = message;
        for (let callable of this.mutators.message) {
            callable(request);
        }
        request.handleError = this._handleMessageError.bind(this);
        request.handleResponse = this._handleMessage.bind(this);
        request.execute('POST');
    }

    /**
     * Sends a DELETE request to the web application backend.
     * @param message {object} Message object sent to DELETE to `messageUrl`.
     */
    delete(message) {
        let request = new ChannelStreamRequest();
        request.url = this.messageDeleteUrl;
        for (let callable of this.mutators.messageDelete) {
            callable(request);
        }
        request.body = message;
        request.handleError = this._handleMessageDeleteError.bind(this);
        request.handleResponse = this._handleMessageDelete.bind(this);
        request.execute('DELETE');
    }

    /**
     * Sends a PATCH request to the web application backend.
     * @param message {object} Message object sent via PATCH to `messageUrl`.
     */
    edit(message) {
        let request = new ChannelStreamRequest();
        request.url = this.messageEditUrl;
        request.body = message;
        for (let callable of this.mutators.messageEdit) {
            callable(request);
        }
        request.handleError = this._handleMessageEditError.bind(this);
        request.handleResponse = this._handleMessageEdit.bind(this);
        request.execute('PATCH');
    }

    /**
     * Opens a persistent connection (WebSocket or long-poll) to receive messages.
     * Automatically selects WebSocket if available, falling back to long-polling.
     * @param request {ChannelStreamRequest} The connect request that triggered this
     * @param data {object} Server response from connect()
     */
    startListening(request, data) {
        this.beforeListeningCallback(request, data);
        // Check WebSocket availability if not explicitly disabled
        if (this.noWebsocket === false) {
            this.noWebsocket = !window.WebSocket;
        }
        // Use WebSocket when available, otherwise fall back to long-polling
        if (this.noWebsocket === false) {
            this.openWebsocket();
        } else {
            this.openLongPoll();
        }
    }

    /**
     * Fired before connection start listening for messages
     * @param request
     * @param data
     */
    beforeListeningCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('beforeListeningCallback', request, data);
    }

    /**
     * Opens WebSocket connection and binds event handlers.
     * Connection ID is passed as query parameter for server-side session matching.
     */
    openWebsocket() {
        let url = this.websocketUrl + '?conn_id=' + this.connectionId;
        this.websocket = new WebSocket(url);
        // Bind all WebSocket events to internal handlers
        this.websocket.onopen = this._handleListenOpen.bind(this);
        this.websocket.onclose = this._handleWebsocketCloseEvent.bind(this);
        this.websocket.onerror = this._handleListenErrorEvent.bind(this);
        this.websocket.onmessage = this._handleListenWSMessageEvent.bind(this);
    }

    /**
     * Opens long-poll connection as fallback when WebSocket is unavailable.
     * Long-polling works by making repeated HTTP requests - each request blocks
     * until the server has data or times out, then immediately reconnects.
     */
    openLongPoll() {
        let request = new ChannelStreamRequest();
        request.url = this.longPollUrl + '?conn_id=' + this.connectionId;
        request.handleError = this._handleListenErrorEvent.bind(this);
        // Mark connected when request starts (server accepted connection)
        request.handleRequest = function () {
            this.connected = true;
            this.listenOpenedCallback(request);
        }.bind(this);
        // On response, process messages and immediately start next poll
        request.handleResponse = function (request, data) {
            this._handleListenMessageEvent(data);
        }.bind(this);
        request.execute();
        // Store reference to allow aborting the request on disconnect
        this._ajaxListen = request;
    }

    /**
     * Retries connect() using exponential backoff strategy.
     * Each retry waits longer (by increaseBounceIv ms) up to a maximum of 60 seconds.
     * This prevents overwhelming the server during outages.
     */
    retryConnection() {
        if (!this.shouldReconnect) {
            return;
        }
        // Exponential backoff: increase interval each retry, cap at 60 seconds
        if (this._currentBounceIv < 60000) {
            this._currentBounceIv = this._currentBounceIv + this.increaseBounceIv;
        } else {
            this._currentBounceIv = 60000;
        }
        // Schedule reconnection attempt after the backoff interval
        setTimeout(this.connect.bind(this), this._currentBounceIv);
    }

    /**
     * Closes the current listening connection (WebSocket or long-poll).
     * Cleans up event handlers to prevent reconnection triggers.
     */
    closeConnection() {
        // Close WebSocket if open, removing handlers to prevent reconnect loop
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.onclose = null;
            this.websocket.onerror = null;
            this.websocket.close();
        }
        // Abort any pending long-poll request
        if (this._ajaxListen) {
            let request = this._ajaxListen.request;
            request.abort();
        }
        this.connected = false;
        this.connectionClosedCallback();
    }

    /**
     * Fired when listening connection is closed
     */
    connectionClosedCallback() {
        if (!this.debug) {
            return;
        }
        console.log('connectionClosedCallback');
    }

    /**
     * Fired when channels property get mutated
     */
    channelsChangedCallback(data) {
        if (!this.debug) {
            return;
        }
        console.log('channelsChangedCallback', data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleListenOpen(request, data) {
        this.connected = true;
        this.listenOpenedCallback(request, data);
        this.createHeartBeats();
    }

    /**
     * Fired when client starts listening for messages
     * @param request
     * @param data
     */
    listenOpenedCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('listenOpenedCallback', request, data);
    }

    /**
     * Starts periodic heartbeat messages to keep the connection alive.
     * Heartbeats prevent server-side timeout and help detect dead connections.
     */
    createHeartBeats() {
        // Only create heartbeat interval once, and only for WebSocket connections
        if (typeof this._heartbeat === 'undefined' && this.websocket !== null && this.heartbeats) {
            this._heartbeat = setInterval(this._sendHeartBeat.bind(this), 10000);
        }
    }

    /**
     * Sends a single heartbeat message over the WebSocket.
     * @private
     */
    _sendHeartBeat() {
        if (this.websocket.readyState === WebSocket.OPEN && this.heartbeats) {
            this.websocket.send(JSON.stringify({type: 'heartbeat'}));
        }
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleListenError(request, data) {
        this.connected = false;
        this.retryConnection(request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleConnectError(request, data) {
        this.connected = false;
        this.retryConnection(request, data);
        this.connectErrorCallback(request, data);
    }

    /**
     * Fired when client fails connect() call
     * @param request
     * @param data
     */
    connectErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('connectErrorCallback', request, data);
    }

    /**
     * Handles long-polling payloads and re-initiates the poll loop.
     * Uses setTimeout(0) to allow the current call stack to complete
     * before starting the next long-poll request.
     * @param data {object} Parsed JSON response from server
     * @private
     */
    _handleListenMessageEvent(data) {
        // Immediately schedule next poll (async to prevent stack overflow)
        setTimeout(this.openLongPoll.bind(this), 0);
        this.listenMessageCallback(data);
    }

    /**
     * Handles ws payloads
     * @param data
     * @private
     */
    _handleListenWSMessageEvent(data) {
        let parsedData = JSON.parse(data.data);
        this.listenMessageCallback(parsedData);
    }

    /**
     * Fired when messages are received
     * @param data
     */
    listenMessageCallback(data) {
        if (!this.debug) {
            return;
        }
        console.log('listenMessageCallback', data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleWebsocketCloseEvent(request, data) {
        this.connected = false;
        this.listenCloseCallback(request, data);
        this.retryConnection();
    }

    /**
     * Fired on websocket connection close event
     * @param request
     * @param data
     */
    listenCloseCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('listenCloseCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleListenErrorEvent(request, data) {
        this.connected = false;
        this.listenErrorCallback(request, data);
    }

    /**
     * Fired on long-pool/websocket connection error event
     * @param request
     * @param data
     */
    listenErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('listenErrorCallback', request, data);
    }

    /**
     * Handles successful connection response from server.
     * Stores connection ID, updates channels, and starts listening for messages.
     * @param request {ChannelStreamRequest} The connect request
     * @param data {object} Server response containing conn_id and channels
     * @private
     */
    _handleConnect(request, data) {
        // Reset reconnection backoff on successful connect
        this.currentBounceIv = 0;
        // Store server-assigned connection ID for subsequent requests
        this.connectionId = data.conn_id;
        this.channels = data.channels;
        this.channelsChangedCallback(this.channels);
        this.connectCallback(request, data);
        // Begin listening for real-time messages
        this.startListening(request, data);
    }

    /**
     * Fired on successful connect() call
     * @param request
     * @param data
     */
    connectCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('connectCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleDisconnect(request, data) {
        this.connected = false;
        this.disconnectCallback(request, data);
    }

    /**
     * Fired after successful disconnect() call
     * @param request
     * @param data
     */
    disconnectCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('disconnectCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleMessage(request, data) {
        this.messageCallback(request, data);
    }

    /**
     * Fired on successful message() call
     * @param request
     * @param data
     */
    messageCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('messageCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleMessageError(request, data) {
        this.messageErrorCallback(request, data);
    }

    /**
     * Fired on message() call error
     * @param request
     * @param data
     */
    messageErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('messageErrorCallback', request, data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleMessageEdit(request, data) {
        this.messageEditCallback(request, data);
    }

    /**
     * Fired on successful edit() call
     * @param request
     * @param data
     */
    messageEditCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('messageCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleMessageEditError(request, data) {
        this.messageEditErrorCallback(request, data);
    }

    /**
     * Fired on edit() call error
     * @param request
     * @param data
     */
    messageEditErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('messageEditErrorCallback', request, data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleMessageDelete(request, data) {
        this.messageDeleteCallback(request, data);
    }

    /**
     * Fired on successful delete() call
     * @param request
     * @param data
     */
    messageDeleteCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('messageCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleMessageDeleteError(request, data) {
        this.messageDeleteErrorCallback(request, data);
    }

    /**
     * Fired on delete() call error
     * @param request
     * @param data
     */
    messageDeleteErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('messageDeleteErrorCallback', request, data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleSubscribe(request, data) {
        this.channels = data.channels;
        this.channelsChangedCallback(this.channels);
        this.subscribeCallback(request, data);
    }

    /**
     * Fired on successful subscribe() call
     * @param request
     * @param data
     */
    subscribeCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('subscribeCallback', request, data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleSubscribeError(request, data) {
        this.subscribeErrorCallback(request, data);
    }

    /**
     * Fired on subscribe() call error
     * @param request
     * @param data
     */
    subscribeErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('subscribeErrorCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleUnsubscribe(request, data) {
        this.channels = data.channels;
        this.channelsChangedCallback(this.channels);
        this.unsubscribeCallback(request, data);
    }

    /**
     * Fired on successful unsubscribe() call
     * @param request
     * @param data
     */
    unsubscribeCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('unsubscribeCallback', request, data);
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleUnsubscribeError(request, data) {
        this.unsubscribeErrorCallback(request, data);
    }

    /**
     * Fired on unsubscribe() call error
     * @param request
     * @param data
     */
    unsubscribeErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('unsubscribeErrorCallback', request, data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleSetUserState(request, data) {
        this.setUserStateCallback(request, data);
    }

    /**
     * Fired on successful updateUserState() call
     * @param request
     * @param data
     */
    setUserStateCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('setUserStateCallback', request, data)
    }

    /**
     *
     * @param request
     * @param data
     * @private
     */
    _handleSetUserStateError(request, data) {
        this.setUserStateErrorCallback(request, data);
    }

    /**
     * Fired on updateUserState() error
     * @param request
     * @param data
     */
    setUserStateErrorCallback(request, data) {
        if (!this.debug) {
            return;
        }
        console.log('setUserStateErrorCallback', request, data);
    }
};

/**
 * Internal helper class for making AJAX requests with JSON payloads.
 * Provides a consistent interface for HTTP operations with customizable
 * response/error handlers. Used internally by ChannelStreamConnection.
 *
 * @class ChannelStreamRequest
 * @private
 */
class ChannelStreamRequest {

    constructor() {
        /** Custom headers to send with the request. */
        this.headers = [];
        /** Request body (will be JSON-serialized if present). */
        this.body = null;
        /** Target URL for the request. */
        this.url = '';
        /** XMLHttpRequest instance (populated after execute()). */
        this.request = null;
    }

    /**
     * Placeholder for error handling function
     * @param request
     * @param respText
     */
    handleError(request, respText) {
        console.error('request', request);
        console.error('respText', respText);
    };

    /**
     * Placeholder for sucessful response handler
     * @param request
     * @param respText
     */
    handleResponse(request, respText) {
        console.info('request', request);
        console.info('respText', respText);
    };

    /**
     * Placeholder for in-progress request handler.
     * Override to track request progress (e.g., for long-poll connections).
     * @param request {XMLHttpRequest} The in-progress request
     */
    handleRequest(request) {
    };

    /**
     * XMLHttpRequest state change handler.
     * Routes to appropriate callback based on request state and status code.
     */
    handleStateChange() {
        let result = this.request.responseText;
        // Attempt to parse response as JSON (gracefully handles non-JSON)
        try {
            result = JSON.parse(result);
        } catch (exc) {
            // Keep raw text if not valid JSON
        }
        // DONE state means request completed (success or failure)
        if (this.request.readyState === XMLHttpRequest.DONE) {
            // Status 1-399 = success, 400+ or 0 = error
            if (this.request.status && this.request.status <= 400) {
                this.handleResponse(this.request, result);
            } else {
                this.handleError(this.request, result);
            }
        } else {
            // Request still in progress (OPENED, HEADERS_RECEIVED, LOADING)
            this.handleRequest(this.request);
        }
    };

    /**
     * Executes the AJAX request with the specified HTTP verb.
     * Automatically JSON-serializes body if present, defaults to POST with body or GET without.
     * @param verb {string} HTTP verb (GET, POST, PATCH, DELETE, etc.)
     */
    execute(verb) {
        this.request = new XMLHttpRequest();
        this.request.onreadystatechange = this.handleStateChange.bind(this);
        // Apply any custom headers
        if (this.headers) {
            for (let i = 0; i < this.headers.length; i++) {
                this.request.setRequestHeader(
                    this.headers[i].name, this.headers[i].value);
            }
        }
        // With body: default to POST, serialize as JSON
        // Without body: default to GET
        if (this.body) {
            this.request.open(verb || 'POST', this.url);
            this.request.setRequestHeader('Content-Type', 'application/json');
            this.request.send(JSON.stringify(this.body));
        } else {
            this.request.open(verb || 'GET', this.url);
            this.request.send();
        }
    };
}
