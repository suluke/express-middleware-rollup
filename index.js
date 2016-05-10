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
  debug: false,
  maxAge: 0
};

module.exports = function createExpressRollup(options) {
  const opts = Object.assign({}, defaults);
  Object.assign(opts, options);
  // We're not fancy enough to use recursive option merging (yet), so...
  opts.rollupOpts = Object.assign({}, defaults.rollupOpts);
  Object.assign(opts.rollupOpts, options.rollupOpts);
  opts.bundleOpts = Object.assign({}, defaults.bundleOpts);
  Object.assign(opts.bundleOpts, options.bundleOpts);

  // Source directory (required)
  assert(opts.src, 'rollup middleware requires src directory.');
  const src = opts.src;
  // Destination directory (source by default)
  const dest = opts.dest || src;
  // Optional base path for src and dest
  const root = opts.root || null;

  // Cache for bundles' dependencies list
  const cache = {};
  const rollupOpts = Object.assign({}, opts.rollupOpts);
  const bundleOpts = Object.assign({}, opts.bundleOpts);

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

    rollupOpts.entry = bundlePath;
    bundleOpts.dest = jsPath;
    checkNeedsRebuild(bundlePath, cache, rollupOpts).then(rebuild => {
      if (rebuild.needed) {
        if (opts.debug) {
          log('Rolling up', 'started');
        }
        // checkNeedsRebuild may need to inspect the bundle, so re-use the
        // one already available instead of creating a new one
        if (rebuild.bundle) {
          processBundle(rebuild.bundle, bundleOpts, res, next, opts);
        } else {
          rollup.rollup(rollupOpts).then(bundle => {
            processBundle(bundle, bundleOpts, res, next, opts);
          }, err => {
            throw err;
          });
        }
        return true;
      } else if (opts.serve === true) {
        // TODO we want to do the serving for the user instead of express' static middleware
        return next();
      }
      return next();
    }, err => {
      throw err;
    });
    return true;
  };
  return middleware;
};

function processBundle(bundle, bundleOpts, res, next, opts) {
  const bundled = bundle.generate(bundleOpts);
  if (opts.debug) {
    log('Rolling up', 'finished');
    console.log(bundled.code);
  }
  if (opts.debug) {
    log('Writing out', 'started');
  }
  const writePromise = writeBundle(bundled, bundleOpts.dest);
  if (opts.serve === true || opts.serve === 'on-compile') {
    if (opts.debug) {
      log('Serving', 'ourselves');
    }
    res.writeHead(200, {
      'Content-Type': 'text/javascript',
      'Cache-Control': `max-age=${opts.maxAge}`
    });
    res.end(bundled.code);
  } else {
    writePromise.then(() => {
      if (opts.debug) {
        log('Serving', 'by next()');
      }
      next();
    }, err => {
      throw err;
    });
  }
  if (opts.debug) {
    writePromise.then(() => {
      log('Writing out', 'finished');
    }, err => {
      throw err;
    });
  }
}

function writeBundle(bundle, dest) {
  let promise = new Promise((resolve, reject) => {
    fs.writeFile(dest, bundle.code, err => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
  if (bundle.map) {
    const mapPromise = new Promise((resolve, reject) => {
      fs.writeFile(`${dest}.map`, bundle.map, err => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    promise = Promise.all([promise, mapPromise]);
  }

  return promise;
}

function checkNeedsRebuild(bundlePath, cache, rollupOpts) {
  if (!cache[bundlePath]) {
    return rollup.rollup(rollupOpts).then(bundle => {
      console.log(bundle.imports);
      console.log('=================================');
      console.log(bundle.modules);
      return { needed: true, bundle };
    }, err => {
      throw err;
    });
  }
  return new Promise((resolve, reject) => {
    resolve({ needed: true });
  });
}

function log(key, val) {
  console.error('  \x1B[90m%s:\x1B[0m \x1B[36m%s\x1B[0m', key, val);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`\x07\x1B[31m${message}\x1B[91m`);
  }
}
