'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var Authorization = require('./authorization');
var moment = require('moment');
var logger = require('hoist-logger');
var apiLimit = 500;  // actual daily limit is 1000, have it lower to allow for other api calls

function XeroPoller(app, subscription, connector, bouncerToken) {
  logger.info(connector.key, 'inside xero-poll-constructor');
  this.app = app;
  this.subscription = subscription;
  this.bouncerToken = bouncerToken || null;
  this.connectorKey = connector.key;
  this.connector = new Connector(connector.settings);
}
XeroPoller.prototype = {
  pollSubscription: function () {
    var frequency = 24 * 60 * this.subscription.endpoints.length / apiLimit;
    if (this.subscription.get('lastPolled') > moment().subtract(frequency, 'minutes').utc().format()) {
      return BBPromise.resolve(this.subscription.eventEmitter.emit('done'));
    } else {
      this.subscription.set('lastPolled', moment.utc().format());
    }
    logger.info(this.connectorKey, 'inside xero-poll-#pollSubscription before pollEndpoint');
    if (this.connector.settings.authType === 'Public') {
      this.bouncerToken = new Authorization(this.bouncerToken);
      this.connector.authorize(this.bouncerToken);
    }
    return BBPromise.settle(_.map(this.subscription.endpoints, _.bind(this.pollEndpoint, this)))
      .bind(this)
      .then(function (returnedPromises) {
        logger.info(returnedPromises, 'inside xero-poll #pollSubscription before done');
        //deal with promises with isFulfilled/isRejected depending on result from xero
        return this.subscription.eventEmitter.emit('done', returnedPromises);
      }).catch(function (err) {
        logger.info('polling error', err, err.stack);
      });
  },
  pollEndpoint: function (endpoint) {
    var singularEndpointName = endpoint.replace(/s$/, '');
    var _lastPoll = this.subscription.get(endpoint) ? this.subscription.get(endpoint).lastPolled : null;
    var extraHeader = _lastPoll ? {
      'If-Modified-Since': _lastPoll
    } : {};
    var formattedEndpoint = '/' + endpoint;
    logger.info(this.connectorKey, 'inside xero-poll-#pollEndpoint before get');
    var timeNow = moment.utc().format();
    var get = this.connector.get(formattedEndpoint, extraHeader);
    return get
      .bind(this)
      .then(function (results) {
        logger.info(results, 'inside xero-poll-#pollEndpoint after get');
        return this.handleResults(results, endpoint, singularEndpointName, _lastPoll, timeNow);
      }).catch(function (err) {
        logger.info('Error', err, err.stack);
      });
  },
  handleResults: function (results, endpoint, singularEndpointName, _lastPoll, timeNow) {
    var self = this;
    if (!results.Response[endpoint]) {
      return BBPromise.resolve();
      //   return this.subscription.set(endpoint, {
      //     lastPolled: timeNow
      //   });
    }
    if (!(Array.isArray(results.Response[endpoint][singularEndpointName]))) {
      // when only one result it is not returned as an array
      var singleResult = {
        result: results.Response[endpoint][singularEndpointName],
        endpoint: endpoint,
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll,
        connectorKey: this.connectorKey
      };
      logger.info(singleResult, 'single result received from xero');
      return this.raiseEvent(singleResult)
        .bind(this)
        .then(function () {
          var lastPolled = results.Response[endpoint][singularEndpointName].UpdatedDateUTC || results.Response.DateTimeUTC || timeNow;
          return this.subscription.set(endpoint, {
            lastPolled: lastPolled
          });
        }).then(function (updatedSubscription) {
          this.subscription = updatedSubscription;
          return updatedSubscription;
        }).bind(this);
    }
    var mappedResults = _.map(results.Response[endpoint][singularEndpointName], function (result) {
      return {
        result: result,
        endpoint: endpoint,
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll,
        connectorKey: self.connectorKey
      };
    });
    return BBPromise.settle(_.map(mappedResults, _.bind(this.raiseEvent, this)))
      .bind(this)
      .then(function (promises) {
        var lastPolled = _.foldr(results.Response[endpoint][singularEndpointName], function (max, next) {
          return next.UpdatedDateUTC > max ? next.UpdatedDateUTC : max;
        }, '');
        lastPolled = lastPolled || results.Response.DateTimeUTC || timeNow;
        return this.subscription.set(endpoint, {
          lastPolled: lastPolled
        }).bind(this).then(function (updatedSubscription) {
          this.subscription = updatedSubscription;
          return promises;
        });
      }).catch(function (err) {
        logger.info('Error ', err, err.stack);
      });
  },
  raiseEvent: function (result) {
    logger.info(result, 'inside poll-xero-raiseEvent');
    return this.checkIfNew(result)
      .bind(this)
      .then(function (isNew) {
        var eventName = result.connectorKey + (isNew ? ':new:' : ':modified:') + result.singularEndpointName.toLowerCase();
        logger.info(eventName, 'inside poll-xero-before-emitting');
        return this.subscription.eventEmitter.emit(eventName, result.result);
      });
  },
  checkIfNew: function (result) {
    var isNew = false;
    if (result.result.CreatedDateUTC && moment(result.result.CreatedDateUTC).isAfter(result.lastPoll)) {
      isNew = true;
    }
    var meta = this.subscription.get(result.endpoint);
    meta = meta || {};
    meta.ids = meta.ids || [];
    if (result.result[result.singularEndpointName + 'ID'] && meta.ids.indexOf(result.result[result.singularEndpointName + 'ID']) === -1) {
      meta.ids.push(result.result[result.singularEndpointName + 'ID']);
      return this.subscription.set(result.endpoint, {
        ids: meta.ids
      }).bind(this).then(function (updatedSubscription) {
        this.subscription = updatedSubscription;
        return true;
      });
    }
    return BBPromise.resolve(isNew);
  }
};
module.exports = function (app, subscription, connector, bouncerToken) {
  var poller = new XeroPoller(app, subscription, connector, bouncerToken);
  return poller.pollSubscription();
};