'use strict';

const rollup  = require('rollup');
const fsp     = require('fs-promise');
const url     = require('url');
const dirname = require('path').dirname;
const join    = require('path').join;

function log(key, val) {
  if (!val) {
    console.error('  \x1B[0m\x1B[36m%s\x1B[0m', key);
  } else {
    console.error('  \x1B[90m%s:\x1B[0m \x1B[36m%s\x1B[0m', key, val);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`\x07\x1B[31m${message}\x1B[91m`);
  }
}

const defaults = {
  mode: 'compile', // or 'polyfill'
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
  debug: false,
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
      if (rebuild.needed) {
        if (opts.debug) {
          log('Needs rebuild', 'true');
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
            console.error(err);
          });
        }
        return true;
      } else if (opts.serve === true) {
        /** serves js code from cache by ourselves */
        res.status(200)
          .type('javascript')
          .set('Cache-Control', `max-age=${opts.maxAge}`)
          .sendFile(jsPath, err => {
            if (err) {
              console.error(err);
              res.status(err.status).end();
            } else if (opts.debug) {
              log('Serving', 'ourselves');
            }
          });
        return true;
      }
      return next();
    }, err => {
      console.error(err);
    });
    return true;
  }

  processBundle(bundle, bundleOpts, res, next, opts) {
    const bundled = bundle.generate(bundleOpts);
    if (opts.debug) {
      log('Rolling up', 'finished');
    }
    const writePromise = this.writeBundle(bundled, bundleOpts.dest, opts);
    if (opts.debug) {
      log('Writing out', 'started');
    }
    if (opts.serve === true || opts.serve === 'on-compile') {
      /** serves js code by ourselves */
      if (opts.debug) {
        log('Serving', 'ourselves');
      }
      res.status(200)
        .type('javascript')
        .set('Cache-Control', `max-age=${opts.maxAge}`)
        .send(bundled.code);
    } else {
      writePromise.then(() => {
        if (opts.debug) {
          log('Serving', 'by next()');
        }
        next();
      } /* Error case for this is handled below */);
    }
    if (opts.debug) {
      writePromise.then(() => {
        log('Writing out', 'finished');
      }, err => {
        console.error(err);
        // Hope, that maybe another middleware can handle things
        next();
      });
    }
  }

  writeBundle(bundle, dest, opts) {
    const dirPath = dirname(dest);
    const dirExists = fsp.stat(dirPath)
      .catch(() => fsp.mkdirs(dirPath).then(() => {
        if (opts.debug) { log('Direcotry created', dirPath); }
      }))
      .then(stats => {
        if (stats && !stats.isDirectory()) {
          throw new Error('Directory to write to does not exist (not a directory)');
        }
      });

    return dirExists.then(() => {
      let promise = fsp.writeFile(dest, bundle.code);
      if (bundle.map) {
        const mapPromise = fsp.writeFile(`${dest}.map`, bundle.map);
        promise = Promise.all([promise, mapPromise]);
      }
      return promise;
    }, err => { throw err; });
  }

  allFilesOlder(file, files) {
    const statsPromises = [file].concat(files).map(f => fsp.stat(f));
    return Promise.all(statsPromises).then(stats => {
      const fileStat = stats[0];
      if (this.opts.debug) {
        log('Stats loaded', `${stats.length - 1} dependencies`);
      }
      for (let i = 1; i < stats.length; ++i) {
        if (fileStat.mtime.valueOf() <= stats[i].mtime.valueOf()) {
          if (this.opts.debug) {
            log('File is newer', files[i - 1]);
          }
          return false;
        }
      }
      return true;
    }, err => {
      throw err;
    });
  }

  checkNeedsRebuild(jsPath, rollupOpts) {
    const testExists = fsp.access(jsPath, fsp.F_OK);
    const cache = this.cache;
    if (!cache[jsPath]) {
      if (this.opts.debug) {
        log('Cache miss');
      }
      return testExists
      .then(() => ({ exists: true, bundle: rollup.rollup(rollupOpts) }), () => ({ exists: false }))
      .then(res => {
        if (res.exists === false) {
          // it does not exist, so we MUST rebuild (allFilesOlder = false)
          return Promise.all([false, false]);
        }
        return res.bundle.then(bundle => {
          if (this.opts.debug) {
            log('Bundle loaded');
          }
          const dependencies = bundle.modules.map(module => module.id);
          cache[jsPath] = dependencies;
          return Promise.all([this.allFilesOlder(jsPath, dependencies), bundle]);
        }, err => { throw err; });
      })
      .then(results => ({ needed: !results[0], bundle: results[1] }))
      .catch(err => {
        console.error(err);
      });
    }
    return testExists
    .then(() => this.allFilesOlder(jsPath, cache[jsPath]))
    .then(allOlder => ({ needed: !allOlder }), err => {
      console.error(err);
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

  if (options.mode === 'polyfill') {
    // some values will be overwritten when mode='polyfill'
    Object.assign(opts, {
      serve: true,
      bundleExtension: '.js',
      dest: opts.cache || opts.dest || 'cache'
    });
    delete opts.cache;
  } else {
    // Destination directory (source by default)
    opts.dest = opts.dest || opts.src;
  }

  const expressRollup = new ExpressRollup(opts);
  const middleware = (...args) => expressRollup.handle(...args);
  return middleware;
};
