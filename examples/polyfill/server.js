const express = require('express');
const rollup  = require('../../');
const path    = require('path');

const app = express();
app.use(rollup({
  mode: 'polyfill',
  src: 'public',
  root: __dirname
}));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(3000);
