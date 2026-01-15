# channelstream-js-client

Browser client for Channelstream websocket server.

https://channelstream.org

https://www.npmjs.com/package/@channelstream/channelstream

First run channelstream server:
    
    channelstream

Now you can implement the client side of websocket handling, first install the client:

    npm i @channelstream/channelstream  

You are ready to add the client to your application and act on events:

```javascript
import {ChannelStreamConnection} from '@channelstream/channelstream';
let connection = new ChannelStreamConnection();
// this points to your application view
connection.connectUrl = '/connect';
connection.messageUrl = '/message';
// this points to channelstream
connection.websocketUrl = 'ws://127.0.0.1:8000/ws';
connection.longPollUrl = 'http://127.0.0.1:8000/listen';

connection.listenMessageCallback = (messages) => {
    for (let message of messages) {
        console.log('channelstream message', message);
        // Do something on message received
    }
};
// optional
connection.listenOpenedCallback = () => {
    // Do something on websocket open
};
// this will try to obtain connection UUID from `connectUrl` endpoint of your 
// WEB application via XHR calland then use it to make websocket connection

// optionally set the username for XHR call
// your server side application can normally handle this
connection.username = "someID"

connection.connect();
```

Consult the project website for more in depth examples.

## Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/Channelstream/channelstream-js-client.git
cd channelstream-js-client
npm install
```

## Build

Build the ES modules using Rollup:

```bash
npm run build
```

This converts the CommonJS SHA modules to ES modules (`sha-esm.js`, `sha1-esm.js`).

Note: The build runs automatically on `npm install` via the `prepare` script.

## Documentation

Generate API documentation with JSDoc:

```bash
npm run jsdoc
```

Documentation is output to the `jsdoc_out/` directory.

## Publishing to npm

1. **Remove private flag**: Edit `package.json` and set `"private": false` or remove the field entirely.

2. **Update version**: Bump the version in `package.json`:
   ```bash
   npm version patch  # or minor/major
   ```

3. **Login to npm**:
   ```bash
   npm login
   ```

4. **Publish** (scoped packages require `--access public`):
   ```bash
   npm publish --access public
   ```

## License

BSD 3-Clause License
