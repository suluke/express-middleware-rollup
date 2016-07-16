# express-middleware-rollup
Express middleware for [rollup](http://rollupjs.org/)

[![Build Status](https://travis-ci.org/suluke/express-middleware-rollup.svg?branch=master)](https://travis-ci.org/suluke/express-middleware-rollup)

## Install
```
npm install --save express-middleware-rollup
```

## Usage
Assuming a directory setup like the following of your project:
```
.
├── client
│   └── js
│       ├── main.bundle
│       └── test.js
├── server.js
└── static
    └── index.html
```
In your `server.js` write the following:
```
const express = require('express');
const rollup  = require('express-middleware-rollup');
const path    = require('path');

const app = express();
app.use(rollup({
  src: 'client/js',
  dest: 'static',
  root: __dirname,
  prefix: '/js'
}));
app.use(express.static(path.join(__dirname, 'static')));
app.listen(3000);
```
Now, if you request `localhost:3000/main.js`, the middleware will automatically bundle `client/js/main.bundle` using rollup into a file that is ready to be served by `express.static` middleware.
You can see this in action by looking into the [basic example](examples/basic)

## Options
* `src`: (String, required)
* `dest`: (String, default: value of `src`)
* `root`: (String, default: `process.cwd()`)
* `prefix`: (String, default: `null`)
* `bundleExtension`: (String, default: `'.bundle'`)
* `rebuild`: (String, default: `'deps-change'`). Can be  `'deps-change'`, `'never'` or `'always'`
* `serve`: (Bool|String, default: `false`). Can be `true`, `false` or `'on-compile'`. 
  `'on-compile'` has the benefit that the bundle which is already in memory will be written directly into the response
* `rollupOpts`: (Object, default: `{}`)
* `bundleOpts`: (Object, default: `{ format: 'iife' }`)
* `debug`: (Bool, default: `false`)
* `maxAge`: (Integer, default: `0`)
* `type`: (String, default: `javascript`). MIME type of served bundles. Can be anything, e.g. `application/javascript`

## Troubleshooting
### Different module file extensions than `.js`
Let's say you have files with `.jsx` or `.es6` as file extension in your project but you still want to `import` them without any extension specified in your code.
Then you were probably hoping for an option similar to browserify's [`--extension` option](https://github.com/substack/node-browserify#usage).
Unfortunately, the rollup team [does not seem to favor a solution like that](https://github.com/rollup/rollup/issues/448).
Therefore, I am afraid yo're stuck specifying the extension of the files you import in your code.

## Why?
Essentially, the reasons for why you would want to use this middleware are the same as for middlewares like [browserify-middleware](https://github.com/ForbesLindesay/browserify-middleware) or [node-sass-middleware](https://github.com/sass/node-sass-middleware):
You like it simple and don't want to set up a build pipeline with `gulp`/`grunt`/`broccoli`/`webpack`/`file watchers` etc.
Also, you don't really need hot-reloading on save, since you are able to press f5 on your own.
And maybe you also have the problem that you don't want to choose between having compiled files in your repo and forcing the server guys to build the client code each time they pull.
With this package, you can simply have your server handle the build process, just when it's needed and only if it's needed.

## Credits
This middleware is heavily influenced by [node-sass-middleware](https://github.com/sass/node-sass-middleware)

## Copyright
Copyright (c) 2016+ Lukas Böhm. See [LICENSE](LICENSE) for details.
