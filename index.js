'use strict';

const rollup  = require('rollup');
const fs      = require('fs');
const url     = require('url');
const dirname = require('path').dirname;
const join    = require('path').join;

const extRegex = /\.js$/;

const defaults = {
  bundleExtension: '.bundle',
  extensions: ['.js'],
  src: null,
  dest: null,
  root: process.cwd(),
  prefix: null,
  rebuild: 'deps-change', // or 'never' or 'always'
  serve: false, // or 'on-compile' or true. 'on-compile' has the benefit
                // that the bundle which is already in memory will be
                // written directly into the response
  rollupOpts: {},
  bundleOpts: { format: 'iife' },
  debug: false
};

module.exports = function createExpressRollup(options) {
  const opts = Object.assign({}, defaults);
  Object.assign(opts, options);

  // Source directory (required)
  assert(opts.src, 'rollup middleware requires src directory.');
  const src = opts.src;
  // Destination directory (source by default)
  const dest = opts.dest || src;
  // Optional base path for src and dest
  const root = opts.root || null;

  // Cache for bundles' dependencies list
  const cache = {};

  const middleware = function(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    let path = url.parse(req.url).pathname;
    if (opts.prefix && path.indexOf(opts.prefix) === 0) {
      path = path.substring(opts.prefix.length);
    }

    if (!extRegex.test(path)) {
      return next();
    }

    const jsPath = join(root, dest, path.replace(new RegExp(`^${dest}`), ''));
    const bundlePath = join(root, src, path
          .replace(new RegExp(`^${dest}`), '')
          .replace(extRegex, opts.bundleExtension));
    const bundleDir = dirname(bundlePath);

    if (opts.debug) {
      log('source', bundlePath);
      log('dest', jsPath);
    }

    if (needsRebuild()) {
      const rollupOpts = Object.assign({}, opts.rollupOpts);
      rollupOpts.entry = bundlePath;
    } else if (opts.serve === true) {
      //
      res.send();
      return true;
    }
    return undefined;
  };
};

function needsRebuild() {
  return true;
}

function log(key, val) {
  console.error('  \x1B[90m%s:\x1B[0m \x1B[36m%s\x1B[0m', key, val);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`\x07\x1B[31m${message}\x1B[91m`);
  }
}
