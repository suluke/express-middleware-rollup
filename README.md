# express-middleware-rollup
Express middleware for [rollup](http://rollupjs.org/)

[![Npm version](https://badge.fury.io/js/express-middleware-rollup.svg)](https://badge.fury.io/js/express-middleware-rollup)
![Node version](https://img.shields.io/badge/node-%3E%3D%206.0-yellow.svg)
[![Build Status](https://travis-ci.org/suluke/express-middleware-rollup.svg?branch=master)](https://travis-ci.org/suluke/express-middleware-rollup)
![Dependencies status](https://david-dm.org/suluke/express-middleware-rollup.svg)

## Install
```
npm install --save express-middleware-rollup
```

## Basic Usage
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

## Alternative Usage Scenarios
There are basically two different approaches developers follow which lead them to use this middleware:

1. Differentiate between *source* code (es6) and *production* code (es5). Use the middleware to compile the former to the latter.
2. Write es6 for the frontend *today*, including modules. Use the middleware as a polyfill until browsers support es6 modules natively.

Both approaches are supported by this middleware.
But since they are so different from each other, we were not able to come up with a unique set of options to configure both in a sensible way.
This is why we have the `mode` option:
Depending on which mode you set (`compile` or `polyfill`), you can customize the middleware's behavior with a different set of options.
The default mode is `compile`.

## Options
Options which are available in both modes are:
* `src`: (String, required). Directory where to look for bundle entries
* `root`: (String, default: `process.cwd()`). Directory which other paths (like `src`) are relative to
* `rebuild`: (String, default: `'deps-change'`). Strategy used to determine whether to re-run `rollup` if a compiled/cached bundle exists. Can be  `'deps-change'`, `'never'` or `'always'`
* `rollupOpts`: (Object, default: `{}`). Options that will be passed to [`rollup.rollup`](https://github.com/rollup/rollup/wiki/JavaScript-API#rolluprollup-options-). `entry` is set by the plugin, though.
* `bundleOpts`: (Object, default: `{ format: 'iife' }`). Options passed to [`bundle.generate`](https://github.com/rollup/rollup/wiki/JavaScript-API#bundlegenerate-options-)
* `prefix`: (String, default: `null`)
* `maxAge`: (Integer, default: `0`).
* `type`: (String, default: `javascript`). MIME type of served bundles. Can be anything, e.g. `application/javascript`
* `debug`: (Bool, default: `false`)

## Options `compile` Mode
* `dest`: (String, default: value of `src`)
* `bundleExtension`: (String, default: `'.bundle'`)
* `serve`: (Bool|String, default: `false`). Can be `true`, `false` or `'on-compile'`. 
  `'on-compile'` has the benefit that the bundle which is already in memory will be written directly into the response

## Options `polyfill` Mode
* `cache`: (String, default: 'cache'). Directory where to store bundles as cache.

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
