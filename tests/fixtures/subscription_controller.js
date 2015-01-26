'use strict';
var _ = require('lodash');

function SubscriptionController(subscription) {
  var privateSubscription = subscription;
  _.forOwn(subscription.toObject(), _.bind(function (n, key) {
    this[key] = n;
  }, this));

  this.set = function (key, value) {
    privateSubscription.meta = privateSubscription.meta ? privateSubscription.meta : {};
    if (typeof privateSubscription.meta[key] === 'object' && typeof value === 'object') {
      privateSubscription.meta[key] = _.merge(privateSubscription.meta[key], value);
    } else {
      privateSubscription.meta[key] = value;
    }
    privateSubscription.markModified('meta');
    return privateSubscription.saveAsync();
  };

  this.get = function (key) {
    return privateSubscription.meta[key];
  };
}
module.exports = SubscriptionController;