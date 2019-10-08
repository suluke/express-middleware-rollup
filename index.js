'use strict';

const rollup  = require('rollup');
const fsp     = require('fs-extra');

let fecha     = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved, node/no-missing-require
  fecha = require('fecha');
} catch (e) { /* empty */ }
const url     = require('url');
const path    = require('path');
const { dirname, join } = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`\x07\x1B[31m${message}\x1B[91m`);
  }
}

const defaults = {
  mode: 'compile',
  bundleExtension: '.bundle',
  src: null,
  dest: null,
  root: process.cwd(),
  prefix: null,
  rebuild: 'deps-change', // or 'never' or 'always'
  serve: false, /* or 'on-compile' or true. 'on-compile' has the benefit
                   that the bundle which is already in memory will be
                   written directly into the response */
  type: 'javascript',
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
    this.lastTimeStamp = Date.now();
  }

  log(key, val) {
    if (this.opts.debug) {
      let time = '';
      let diff = '';
      if (fecha !== null) {
        const now = new Date();
        time = `${fecha.format(now, 'hh:mm:ss')} `;
        diff = `+${fecha.format(now.getTime() - this.lastTimeStamp, 'ss.SSS')} `;
        this.lastTimeStamp = now;
      }
      if (!val) {
        console.error('\x1B[33m%s\x1B[34m%s\x1B[36m%s\x1B[0m', diff, time, key);
      } else {
        console.error('\x1B[33m%s\x1B[34m%s\x1B[90m%s: \x1B[36m%s\x1B[0m', diff, time, key, val);
      }
    }
  }

  handle(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const { opts } = this;
    const { src, dest, root } = opts;
    const rollupOpts = Object.assign({}, opts.rollupOpts);
    const bundleOpts = Object.assign({}, opts.bundleOpts);
    const extRegex = /\.js$/;

    let { pathname } = url.parse(req.url);
    if (opts.prefix && pathname.indexOf(opts.prefix) === 0) {
      pathname = pathname.substring(opts.prefix.length);
    }

    if (!extRegex.test(pathname)) {
      next();
      return;
    }

    const jsPath = join(root, dest, pathname.replace(new RegExp(`^${dest}`), ''));
    const bundlePath = join(root, src, pathname
      .replace(new RegExp(`^${dest}`), '')
      .replace(extRegex, opts.bundleExtension));

    this.log('source', bundlePath);
    this.log('dest', jsPath);

    rollupOpts.input = bundlePath;
    fsp.access(bundlePath, fsp.constants.R_OK)
      .then(() => this.checkNeedsRebuild(jsPath, rollupOpts))
      .then((rebuild) => {
        if (rebuild.needed) {
          this.log('Needs rebuild', 'true');
          this.log('Rolling up', 'started');
          // checkNeedsRebuild may need to inspect the bundle, so re-use the
          // one already available instead of creating a new one
          if (rebuild.bundle) {
            this.processBundle(rebuild.bundle, bundleOpts, jsPath, res, next, opts);
          } else {
            rollup.rollup(rollupOpts).then((bundle) => {
              this.processBundle(bundle, bundleOpts, jsPath, res, next, opts);
            }, (err) => {
              console.error(err);
            });
          }
        } else if (opts.serve === true) {
          // serve js code from cache by ourselves
          res.status(200)
            .type(opts.type)
            .set('Cache-Control', `max-age=${opts.maxAge}`)
            .sendFile(jsPath, (err) => {
              if (err) {
                console.error(err);
                res.status(err.status).end();
              } else {
                this.log('Serving', 'ourselves');
              }
            });
        } else {
          // have someone else take care of things
          next();
        }
      }, (err) => {
        if (err.syscall && err.syscall === 'access') {
          this.log('Bundle file not found. Since you might intend to serve this file statically, this is a silent warning.');
        } else {
          console.error(err);
        }
        next();
      });
  }

  processBundle(bundle, bundleOpts, dest, res, next, opts) {
    // after loading the bundle, we first want to make sure the dependency
    // cache is up-to-date
    this.cache[dest] = ExpressRollup.getBundleDependencies(bundle);
    bundle.generate(bundleOpts)
      .then((bundled) => {
        this.log('Rolling up', 'finished');
        const writePromise = ExpressRollup.writeBundle(bundled, dest);
        this.log('Writing out', 'started');
        if (opts.serve === true || opts.serve === 'on-compile') {
          /** serves js code by ourselves */
          this.log('Serving', 'ourselves');
          res.status(200)
            .type(opts.type)
            .set('Cache-Control', `max-age=${opts.maxAge}`)
            .send(bundled.code);
        } else {
          writePromise.then(() => {
            this.log('Serving', 'by next()');
            next();
          } /* Error case for this is handled below */);
        }
        writePromise.then(() => {
          this.log('Writing out', 'finished');
        }, (err) => {
          console.error(err);
          // Hope, that maybe another middleware can handle things
          next();
        });
      });
  }

  static writeBundle(bundle, dest) {
    const dirExists = fsp.stat(dirname(dest))
      .catch(() => Promise.reject(new Error('Directory to write to does not exist')))
      .then((stats) => (!stats.isDirectory()
        ? Promise.reject(new Error('Directory to write to does not exist (not a directory)'))
        : Promise.resolve()));

    return dirExists.then(() => {
      let promise = fsp.writeFile(dest, bundle.code);
      if (bundle.map) {
        const mapPromise = fsp.writeFile(`${dest}.map`, bundle.map);
        promise = Promise.all([promise, mapPromise]);
      }
      return promise;
    });
  }

  allFilesOlder(file, files) {
    const statsPromises = [file].concat(files)
      .map((f) => fsp.stat(f).then((stat) => stat, () => false));
    return Promise.all(statsPromises).then((stats) => {
      const fileStat = stats[0];
      assert(fileStat, 'File tested for allFilesOlder does not exist?');
      this.log('Stats loaded', `${stats.length - 1} dependencies`);
      for (let i = 1; i < stats.length; i += 1) {
        // return false if a file does not exist (any more)
        if (stats[i] === false) {
          return false;
        }
        if (fileStat.mtime.valueOf() <= stats[i].mtime.valueOf()) {
          this.log('File is newer', files[i - 1]);
          return false;
        }
      }
      return true;
    });
  }

  checkNeedsRebuild(jsPath, rollupOpts) {
    const testExists = fsp.access(jsPath, fsp.F_OK);
    const { cache } = this;
    if (!cache[jsPath]) {
      this.log('Cache miss');
      return testExists
        .then(
          () => ({ exists: true, bundle: rollup.rollup(rollupOpts) }),
          () => ({ exists: false })
        )
        .then((res) => {
          if (res.exists === false) {
            // it does not exist, so we MUST rebuild (allFilesOlder = false)
            return Promise.all([false, false]);
          }
          return res.bundle.then((bundle) => {
            this.log('Bundle loaded');
            const dependencies = ExpressRollup.getBundleDependencies(bundle);
            cache[jsPath] = dependencies;
            return Promise.all([this.allFilesOlder(jsPath, dependencies), bundle]);
          }, (err) => { throw err; });
        })
        .then((results) => ({ needed: !results[0], bundle: results[1] }));
    }
    return testExists
      .then(() => this.allFilesOlder(jsPath, cache[jsPath]))
      .then((allOlder) => ({ needed: !allOlder }));
  }

  static getBundleDependencies(bundle) {
    return (bundle.modules || bundle.cache.modules).map(
      (module) => module.id
    ).filter(path.isAbsolute);
  }
}

module.exports = function createExpressRollup(options) {
  const opts = Object.assign({}, defaults);
  if (options.mode === 'polyfill' || (!options.mode && defaults.mode === 'polyfill')) {
    if (options.dest || options.serve || options.bundleExtension) {
      console.warn('Explicitly setting options of compile mode in polyfill mode');
    }
    // some default values will be different if mode === 'polyfill'
    Object.assign(opts, {
      serve: true,
      bundleExtension: '.js',
      dest: options.cache || options.dest || 'cache'
    });
  }
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
  // eslint-disable-next-line prefer-rest-params, prefer-spread
  function middleware() { expressRollup.handle.apply(expressRollup, arguments); }
  return middleware;
};
