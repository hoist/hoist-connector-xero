'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var moment = require('moment');
var logger = require('hoist-logger');
var apiLimit = 500; // actual daily limit is 1000, have it lower to allow for other api calls
var errors = require('hoist-errors');
var APILimitReachedError = errors.create({
  name: 'APILimitReachedError'
});
var ConnectorRequiresAuthorizationError = errors.create({
  name: 'ConnectorRequiresAuthorizationError'
});


function XeroPoller(context) {
  logger.info(context, 'constructed poller');
  this.context = context;
  this.connector = new Connector(context.settings);
}
XeroPoller.prototype = {
  assertCanPoll: function () {
    return BBPromise.try(function () {
      var frequency = 24 * 60 * this.subscription.endpoints.length / apiLimit;
      if (this.context.subscription.get('lastPolled') > moment().subtract(frequency, 'minutes').utc().format()) {
        throw new APILimitReachedError();
      }
      if (this.context.settings.authType !== 'Private' && !(this.context.authorization)) {
        throw new ConnectorRequiresAuthorizationError();
      }
    }, [], this);
  },
  pollSubscription: function () {
    return BBPromise.try(function () {
        return this.assertCanPoll();
      }, [], this)
      .bind(this)
      .then(function () {
        this.context.subscription.set('lastPolled', moment.utc().format());
      }).then(function () {

        if (this.context.authorization) {
          logger.info('setting auth');
          this.connector.authorize(this.context.authorization);
        } else {
          logger.info('no auth to set');
        }
      })
      .then(function () {
        logger.info('generating pollEndpoing promises');
        return _.map(this.context.subscription.endpoints, _.bind(this.pollEndpoint, this));
      }).then(function (pollPromises) {
        logger.info('settling promises');
        return BBPromise.settle(pollPromises);
      })
      .then(function () {
        logger.info('done with poll');
      }).catch(function (err) {
        logger.error(err, 'polling error');
        logger.alert(err);
      });

  },
  pollEndpoint: function (endpoint) {
    var singularEndpointName = endpoint.replace(/s$/, '');
    var _lastPoll = this.context.subscription.get(endpoint) ? this.context.subscription.get(endpoint).lastPolled : null;
    var extraHeader = _lastPoll ? {
      'If-Modified-Since': _lastPoll
    } : {};
    var formattedEndpoint = '/' + endpoint;
    logger.info({
      formattedEndpoint: formattedEndpoint,
      extraHeader: extraHeader
    }, 'polling endpoint');
    var timeNow = moment.utc().format();
    var get = this.connector.get(formattedEndpoint, extraHeader);
    return get
      .bind(this)
      .then(function (results) {
        logger.info({
          results: results,
          endpoint: endpoint
        }, 'got results from endpoint');
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
    var entities = [].concat(results.Response[endpoint][singularEndpointName]);
    logger.info({
      entities: entities
    }, 'parsed entities from endpoint');
    var mappedResults = _.map(entities, function (result) {
      return {
        result: result,
        endpoint: endpoint,
        singularEndpointName: singularEndpointName,
        lastPoll: _lastPoll,
        connectorKey: self.context.connectorKey
      };
    });
    return BBPromise.settle(_.map(mappedResults, _.bind(this.raiseEvent, this)))
      .bind(this)
      .then(function (promises) {
        var lastPolled = _.foldr(entities, function (max, next) {
          return next.UpdatedDateUTC > max ? next.UpdatedDateUTC : max;
        }, '');
        lastPolled = lastPolled || results.Response.DateTimeUTC || timeNow;
        this.context.subscription.set(endpoint, {
          lastPolled: lastPolled
        });
        return promises;
      }).catch(function (err) {
        logger.info('Error ', err, err.stack);
      });
  },
  raiseEvent: function (result) {
    logger.info({
      result: result
    }, 'raising event');
    return this.checkIfNew(result)
      .bind(this)
      .then(function (isNew) {
        var eventName = result.connectorKey + (isNew ? ':new:' : ':modified:') + result.singularEndpointName.toLowerCase();
        logger.info({
          eventName: eventName
        }, 'raising event');
        return this.emit(eventName, result.result);
      });
  },
  checkIfNew: function (result) {
    var isNew = false;
    if (result.result.CreatedDateUTC && moment(result.result.CreatedDateUTC).isAfter(result.lastPoll)) {
      isNew = true;
    }
    var meta = this.context.subscription.get(result.endpoint);
    meta = meta || {};
    meta.ids = meta.ids || [];
    if (result.result[result.singularEndpointName + 'ID'] && meta.ids.indexOf(result.result[result.singularEndpointName + 'ID']) === -1) {
      meta.ids.push(result.result[result.singularEndpointName + 'ID']);
      this.context.subscription.set(result.endpoint, {
        ids: meta.ids
      });
    }
    return BBPromise.resolve(isNew);
  }
};
module.exports = function (context, raiseMethod) {
  var poller = new XeroPoller(context);
  poller.emit = raiseMethod;
  return poller.pollSubscription();
};
