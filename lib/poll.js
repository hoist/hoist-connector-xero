'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var Authorization = require('./authorization');
var moment = require('moment');

function XeroPoller(app, bucket, subscription, bouncerToken, connectorSettings) {
  this.app = app;
  this.bucket = bucket;
  this.subscription = subscription;
  this.bouncerToken = bouncerToken || null;
  this.connector = new Connector(connectorSettings);
}
XeroPoller.prototype = {
  pollSubscription: function () {
    if (this.connector.settings.authType === 'Public') {
      this.bouncerToken = new Authorization(this.bouncerToken);
      this.connector.authorize(this.bouncerToken);
    }
    return BBPromise.settle(_.map(this.subscription.endpoints, _.bind(this.pollEndpoint, this)))
      .then(function (returnedPromises) {
        return returnedPromises;
      }).catch(function (err) {
        console.log('polling error', err);
      });
  },
  pollEndpoint: function (endpoint) {
    var endpointName = endpoint.replace(/\//, '');
    var singularEndpointName = endpointName.replace(/s$/, '');

    if (!this.subscription.meta || !this.subscription.meta[endpointName] || !this.subscription.meta[endpointName].lastPolled) {
      // create meta key if it doesnt exist
      this.subscription.meta = this.subscription.meta ? this.subscription.meta : {};
      this.subscription.meta[endpointName] = this.subscription.meta[endpointName] ? this.subscription.meta[endpointName] : {};
    }

    this._lastPoll = this.subscription.meta[endpointName].lastPolled;
    // only poll for items since the last poll time
    var extraHeader = this._lastPoll ? {
      'If-Modified-Since': this._lastPoll
    } : {};

    var get = this.connector.get(endpoint, extraHeader);
    return get
      .bind(this)
      .then(function (results) {
        return this.handleResults(results, endpointName, singularEndpointName);
      }).catch(function (err) {
        return console.log('Error', err, err.stack);
      });
  },
  handleResults: function (results, endpointName, singularEndpointName) {
    if (!results.Response[endpointName]) {
      // no results
      this.subscription.meta[endpointName].lastPolled = moment.utc().format();
      return this.markSubscriptionModified();
    }
    // set lastpoll time to now
    this.subscription.meta[endpointName].lastPolled = moment.utc().format();
    if (!(results.Response[endpointName][singularEndpointName] instanceof Array)) {
      // when only one result it is not return as an array
      return this.raiseEvent(results.Response[endpointName][singularEndpointName])
        .bind(this)
        .then(function markSubscription() {
          return this.markSubscriptionModified();
        }).bind(this);
    }
    return BBPromise.settle(_.map(results.Response[endpointName][singularEndpointName], this.raiseEvent))
      .bind(this)
      .then(function (promises) {
        return this.markSubscriptionModified().then(function () {
          return promises;
        });
      }).catch(function (err) {
        console.log('Error ', err);
      });
  },
  markSubscriptionModified: function () {
    this.subscription.markModified('meta');
    return this.subscription.saveAsync();
  },
  raiseEvent: function (result) {
    if (result.CreatedDateUTC && moment(result.CreatedDateUTC).isBefore(this._lastPoll)) {
      // its an updated result
      console.log('modified item!', result);
      return BBPromise.resolve({
        result: result
      });
      // Hoist.event.raise(eventName, result);
    } else if (!result.CreatedDateUTC) {
      // dont know if modified or not
      console.log('modified item!', result);
      return BBPromise.resolve({
        result: result
      });
      // Hoist.event.raise(eventName, result);
    } else {
      console.log('new item!', result);
      return BBPromise.resolve({
        result: result
      });
      // Hoist.event.raise(eventName, result);
    }

  }
};
module.exports = function (app, bucket, subscription, connector, bouncerToken) {
  var poller = new XeroPoller(app, bucket, subscription, bouncerToken, connector);
  return poller.pollSubscription();
};