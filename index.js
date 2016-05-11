'use strict';

const rollup  = require('rollup');
const fs      = require('fs');
const url     = require('url');
const dirname = require('path').dirname;
const join    = require('path').join;

const defaults = {
  bundleExtension: '.bundle',
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
  debug: true,
  maxAge: 0
};

class ExpressRollup {
  constructor(opts) {
    this.opts = opts;

    // Cache for bundles' dependencies list
    this.cache = {};
  }

  handle(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    const opts = this.opts;
    const src = opts.src;
    const dest = opts.dest;
    const root = opts.root;
    const rollupOpts = Object.assign({}, opts.rollupOpts);
    const bundleOpts = Object.assign({}, opts.bundleOpts);
    const extRegex = /\.js$/;

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

    if (opts.debug) {
      log('source', bundlePath);
      log('dest', jsPath);
    }

    rollupOpts.entry = bundlePath;
    bundleOpts.dest = jsPath;
    this.checkNeedsRebuild(jsPath, rollupOpts).then(rebuild => {
      console.log(rebuild);
      if (rebuild.needed) {
        if (opts.debug) {
          log('Rolling up', 'started');
        }
        // checkNeedsRebuild may need to inspect the bundle, so re-use the
        // one already available instead of creating a new one
        if (rebuild.bundle) {
          this.processBundle(rebuild.bundle, bundleOpts, res, next, opts);
        } else {
          rollup.rollup(rollupOpts).then(bundle => {
            this.processBundle(bundle, bundleOpts, res, next, opts);
          }, err => {
            console.err(err);
          });
        }
        return true;
      } else if (opts.serve === true) {
        // TODO we want to do the serving for the user instead of express' static middleware
        return next();
      }
      return next();
    }, err => {
      console.err(err);
    });
    return true;
  }

  processBundle(bundle, bundleOpts, res, next, opts) {
    const bundled = bundle.generate(bundleOpts);
    if (opts.debug) {
      log('Rolling up', 'finished');
      console.log(bundled.code);
    }
    if (opts.debug) {
      log('Writing out', 'started');
    }
    const writePromise = this.writeBundle(bundled, bundleOpts.dest);
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
        console.err(err);
      });
    }
    if (opts.debug) {
      writePromise.then(() => {
        log('Writing out', 'finished');
      }, err => {
        console.err(err);
      });
    }
  }

  writeBundle(bundle, dest) {
    const destDir = dirname(dest);
    // TODO test if destDir exists and if not either warn or create
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

  allFilesOlder(file, files) {
    // TODO
    return new Promise((resolve, reject) => {
      resolve(true);
    });
  }

  checkNeedsRebuild(jsPath, rollupOpts) {
    const testExists = new Promise((resolve, reject) => {
      fs.access(jsPath, fs.F_OK, (err) => {
        if (err) { reject(err); } else { resolve(); }
      });
    });
    const cache = this.cache;
    if (!cache[jsPath]) {
      console.log('Cache miss');
      return testExists
      .then(() => rollup.rollup(rollupOpts), () => false) // it does not exist, so we MUST rebuild
      .then(bundle => {
        if (bundle === false) {
          return Promise.all([true, false]);
        }
        console.log('Loaded bundle');
        const dependencies = bundle.modules.map(module => module.id);
        cache[jsPath] = dependencies;
        return Promise.all([this.allFilesOlder(jsPath, dependencies), bundle]);
      })
      .then(results => ({ needed: results[0], bundle: results[1] }))
      .catch(err => {
        console.err(err);
      });
    }
    return testExists
    .then(() => this.allFilesOlder(jsPath, cache[jsPath]))
    .then(allOlder => ({ needed: allOlder }), err => {
      console.err(err);
    });
  }
}

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
  // Destination directory (source by default)
  opts.dest = opts.dest || opts.src;

  const expressRollup = new ExpressRollup(opts);
  const middleware = (...args) => expressRollup.handle(...args);
  return middleware;
};

function log(key, val) {
  console.error('  \x1B[90m%s:\x1B[0m \x1B[36m%s\x1B[0m', key, val);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`\x07\x1B[31m${message}\x1B[91m`);
  }
}
