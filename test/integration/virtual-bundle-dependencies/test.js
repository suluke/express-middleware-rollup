'use strict';

const fs      = require('fs');
const path    = require('path');
const plugin  = require('./rollup-plugin');
const express = require('express');
const rollup  = require('../../../');
let   request = require('supertest');

const app = express();
app.use(rollup({
  src: './',
  dest: './',
  root: __dirname,
  serve: 'on-compile',
  // Because we can't know reliably what express' mime.lookup returns for the default 'javascript'
  type: 'application/javascript',
  rollupOpts: {plugins: [plugin]}
}));

describe('virtual bundle dependencies', function() {
  const cachePath = path.join(__dirname, 'module.js');
  before(function() {
    try {
      fs.statSync(cachePath).isFile(); // throws if not existing
      fs.unlinkSync(cachePath);
    } catch (e) {};
  });
  after(function() {
    fs.unlinkSync(cachePath);
  });
  it ('respond with javascript', function(done) {
    request(app).get('/module.js')
    .expect('Content-Type', /javascript/)
    .expect(200)
    .end(err => {
      if (err) return done(err);
      request(app).get('/module.js')
      .expect(404, done); // we don't have a static middleware installed and `serve` is 'on-compile' only
    });
  });
});
