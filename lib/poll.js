'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var Authorization = require('./authorization');
var moment = require('moment');

function XeroPoller(app, subscription, connector, bouncerToken) {
  this.app = app;
  this.subscription = subscription;
  this.bouncerToken = bouncerToken || null;
  this.connectorKey = connector.key;
  this.connector = new Connector(connector.settings);
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
    var singularEndpointName = endpoint.replace(/s$/, '');
    var _lastPoll = this.subscription.get(endpoint) ? this.subscription.get(endpoint).lastPolled : null;
    var extraHeader = _lastPoll ? {
      'If-Modified-Since': _lastPoll
    } : {};
    var formattedEndpoint = '/' + endpoint;
    var get = this.connector.get(formattedEndpoint, extraHeader);
    var timeNow = moment.utc().format();
    return get
      .bind(this)
      .then(function (results) {
        return this.handleResults(results, endpoint, singularEndpointName, _lastPoll, timeNow);
      }).catch(function (err) {
        console.log(1);
        return console.log('Error', err, err.stack);
      });
  },
  handleResults: function (results, endpoint, singularEndpointName, _lastPoll, timeNow) {
    var self = this;
    if (!results.Response[endpoint]) {
      return this.subscription.set(endpoint, {
        lastPolled: timeNow
      });
    }
    if (!(results.Response[endpoint][singularEndpointName] instanceof Array)) {
        // when only one result it is not returned as an array
      var singleResult = {
        result: results.Response[endpoint][singularEndpointName],
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll,
        connectorKey: this.connectorKey
      };
      return BBPromise.resolve(this.raiseEvent(singleResult))
        .bind(this)
        .then(function () {
          return this.subscription.set(endpoint, {
            lastPolled: timeNow
          }).then(function (updatedSubscription) {
            this.subscription = updatedSubscription;
            return updatedSubscription;
          });
        }).bind(this);
    }
    var mappedResults = _.map(results.Response[endpoint][singularEndpointName], function (result) {
      return {
        result: result,
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll,
        connectorKey: self.connectorKey
      };
    });
    return BBPromise.settle(_.map(mappedResults, _.bind(this.raiseEvent, this)))
      .bind(this)
      .then(function (promises) {
        return this.subscription.set(endpoint, {
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
    // console.log(result)
    var _event;
    if (result.result.CreatedDateUTC && moment(result.result.CreatedDateUTC).isBefore(result.lastPoll)) {
      // its an updated result
      _event = result.connectorKey + ':modified:' + result.singularEndpointName;
      return this.subscription.eventEmitter.emit(_event, result.result);
    } else if (!result.CreatedDateUTC) {
      _event = result.connectorKey + ':modified:' + result.singularEndpointName;
      // dont know if modified or not
      return this.subscription.eventEmitter.emit(_event, result.result);
    } else {
      _event = result.connectorKey + ':new:' + result.singularEndpointName;
      return this.subscription.eventEmitter.emit(_event, result.result);
    }
  }
};
module.exports = function (app, subscription, connector, bouncerToken) {
  var poller = new XeroPoller(app, subscription, connector, bouncerToken);
  return poller.pollSubscription();
};