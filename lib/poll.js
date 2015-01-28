'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var Authorization = require('./authorization');
var moment = require('moment');
var _eventPrefix = 'xero:';

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
      .bind(this)
      .then(function (returnedPromises) {
        //deal with promises with isFulfilled/isRejected depending on result from xero
        return this.subscription.eventEmitter.emit('done', returnedPromises);
      }).catch(function (err) {
        console.log('polling error', err, err.stack);
      });
  },
  pollEndpoint: function (endpoint) {
    var endpointName = endpoint.replace(/\//, '');
    var singularEndpointName = endpointName.replace(/s$/, '');

    var _lastPoll = this.subscription.get(endpointName) ? this.subscription.get(endpointName).lastPolled : null;
    var extraHeader = _lastPoll ? {
      'If-Modified-Since': _lastPoll
    } : {};
    var get = this.connector.get(endpoint, extraHeader);
    var timeNow = moment.utc().format();
    return get
      .bind(this)
      .then(function (results) {
        return this.handleResults(results, endpointName, singularEndpointName, _lastPoll, timeNow);
      }).catch(function (err) {
        console.log(1);
        return console.log('Error', err, err.stack);
      });
  },
  handleResults: function (results, endpointName, singularEndpointName, _lastPoll, timeNow) {
    if (!results.Response[endpointName]) {
      return this.subscription.set(endpointName, {
        lastPolled: timeNow
      });
    }
    if (!(results.Response[endpointName][singularEndpointName] instanceof Array)) {
        // when only one result it is not returned as an array
      var singleResult = {
        result: results.Response[endpointName][singularEndpointName],
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll
      };
      return BBPromise.resolve(this.raiseEvent(singleResult))
        .bind(this)
        .then(function () {
          return this.subscription.set(endpointName, {
            lastPolled: timeNow
          }).then(function (updatedSubscription) {
            this.subscription = updatedSubscription;
            return updatedSubscription;
          });
        }).bind(this);
    }
    var mappedResults = _.map(results.Response[endpointName][singularEndpointName], function (result) {
      return {
        result: result,
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll
      };
    });
    return BBPromise.settle(_.map(mappedResults, _.bind(this.raiseEvent, this)))
      .bind(this)
      .then(function (promises) {
        return this.subscription.set(endpointName, {
          lastPolled: timeNow
        }).then(function (updatedSubscription) {
          this.subscription = updatedSubscription;
          return promises;
        });
      }).catch(function (err) {
        console.log('Error ', err, err.stack);
      });
  },
  raiseEvent: function (result) {
    var _event;
    if (result.result.CreatedDateUTC && moment(result.result.CreatedDateUTC).isBefore(result.lastPoll)) {
      // its an updated result
      _event = _eventPrefix + 'modified:' + result.singularEndpointName;
      return this.subscription.eventEmitter.emit(_event, result.result);
    } else if (!result.CreatedDateUTC) {
      _event = _eventPrefix + 'modified:' + result.singularEndpointName;
      // dont know if modified or not
      return this.subscription.eventEmitter.emit(_event, result.result);
    } else {
      _event = _eventPrefix + 'new:' + result.singularEndpointName;
      return this.subscription.eventEmitter.emit(_event, result.result);
    }
  }
};
module.exports = function (app, bucket, subscription, connector, bouncerToken) {
  var poller = new XeroPoller(app, bucket, subscription, bouncerToken, connector);
  return poller.pollSubscription();
};