'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var Model = require('hoist-model');
var mongoose = BBPromise.promisifyAll(Model._mongoose);
var BBPromise = require('bluebird');
var Authorization = require('./authorization');
var config = require('config');
var moment = require('moment');
var Errors = require('hoist-errors');

function XeroPoller(app, bucket, subscription, bouncerToken) {
  this.app = app;
  this.bucket = bucket;
  this.subscription = subscription;
  this.bouncerToken = bouncerToken || null;

  if (mongoose.connection.readyState === 0) {
    console.log('mongo connected');
    mongoose.connectAsync(config.get('Hoist.mongo.db'));
  }
  return this.findConnector().bind(this);
}
XeroPoller.prototype = {
  findConnector: function () {
    return Model.ConnectorSetting.findOneAsync({
      key: this.subscription.connector,
      environment: this.bucket.environment,
      application: this.app._id
    }).bind(this).then(function (connSettings) {
      if (!connSettings) {
        throw new Errors.HoistErrors.connector.ConnectorError('Connector not found');
      }
      this.connector = new Connector(connSettings.settings);
      if (this.connector.settings.authType === 'Public') {
        this.bouncerToken = new Authorization(this.bouncerToken);
      }
      return BBPromise.settle(_.map(this.subscription.endpoints, _.bind(this.pollXero, this)))
        .then(function (returnedPromises) {
          return returnedPromises;
        }).catch(function (err) {
          console.log('polling error', err);
        });
    }).catch(function (err) {
      console.log('err', err, err.stack);
    });
  },
  pollXero: function (endpoint) {
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
    // authorize the bouncer token
    if (this.connector.settings.authType === 'Public') {
      this.connector.authorize(this.bouncerToken);
    }
    var get = this.connector.get(endpoint, extraHeader);
    return get
      .bind(this)
      .then(function (results) {
        return this.checkResults(results, endpointName, singularEndpointName);
      }).catch(function (err) {
        return console.log('Error', err, err.stack);
      });
  },
  checkResults: function (results, endpointName, singularEndpointName) {
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
        .then(function markSubsciption() {
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
      return BBPromise.resolve({result: result});
      // Hoist.event.raise(eventName, result);
    } else if (!result.CreatedDateUTC) {
      // dont know if modified or not
      console.log('modified item!', result);
      return BBPromise.resolve({result: result});
      // Hoist.event.raise(eventName, result);
    } else {
      console.log('new item!', result);
      return BBPromise.resolve({result: result});
      // Hoist.event.raise(eventName, result);
    }

  }
};
module.exports = XeroPoller;