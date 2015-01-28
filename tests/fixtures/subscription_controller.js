'use strict';
var _ = require('lodash');
var EventEmitter = require('events').EventEmitter;


function SubscriptionController(subscription) {
  _.forOwn(subscription.toObject(), _.bind(function (n, key) {
    this[key] = n;
  }, this));
  this.eventEmitter = new EventEmitter();
  
  this.set = function (key, value) {
    subscription.meta = subscription.meta ? subscription.meta : {};
    if (typeof subscription.meta[key] === 'object' && typeof value === 'object') {
      subscription.meta[key] = _.merge(subscription.meta[key], value);
    } else {
      subscription.meta[key] = value;
    }
    subscription.markModified('meta');
    return subscription.saveAsync().bind(this).then(function (savedSubscription) {
      this.meta = savedSubscription[0].meta;
      return this;
    });
  };

  this.get = function (key) {
    if (!subscription.meta) {
      return null;
    }
    return subscription.meta[key];
  };
}
module.exports = SubscriptionController;