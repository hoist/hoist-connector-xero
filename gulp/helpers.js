'use strict';
var notifier = require('node-notifier');

var error;

module.exports = {
  getError: function () {
    return error;
  },
  errorHandler: function (err) {
    notifier.notify({
      title: 'A Gulp error occurred',
      message: err.message
    });
    error = err;
    console.log('Error:', err.message, err.stack);
  }
};
