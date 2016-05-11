const express = require('express');
const rollup  = require('../../');
const path    = require('path');

const app = express();
app.use(rollup({
  src: 'client/js',
  dest: 'static/js',
  root: __dirname,
  prefix: '/js'
}));
app.use(express.static(path.join(__dirname, 'static')));
app.listen(3000);
