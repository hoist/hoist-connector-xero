'use strict';
var _ = require('lodash');
var Connector = require('./connector');
var BBPromise = require('bluebird');
var moment = require('moment');
var logger = require('hoist-logger');
var classLogger = logger.child({
  cls: 'XeroPoller'
});
var apiLimit = 500; // actual daily limit is 1000, have it lower to allow for other api calls
var errors = require('hoist-errors');
var APILimitReachedError = errors.create({
  name: 'APILimitReachedError'
});
var ConnectorRequiresAuthorizationError = errors.create({
  name: 'ConnectorRequiresAuthorizationError'
});


function XeroPoller(context) {
  logger.debug(context, 'constructed poller');
  this.context = context;
  context.settings.applicationId = context.application._id;
  this.connector = new Connector(context.settings);
}
XeroPoller.prototype = {
  assertCanPoll: function () {
    return BBPromise.try(function () {
      var frequency = 24 * 60 * this.context.subscription.endpoints.length / apiLimit;
      var lastPolled = this.context.subscription.get('lastPolled');
      classLogger.info({
        subscription: this.context.subscription._id,
        application: this.context.application._id
      }, 'last polled at:', lastPolled);
      if (lastPolled > moment().subtract(frequency, 'minutes').utc().format()) {
        classLogger.warn({
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, 'xero poller limit reached');
        this.context.subscription.delayTill(moment(lastPolled).add(frequency, 'minutes').toDate());
        throw new APILimitReachedError();
      }
      if (this.context.settings.authType !== 'Private' && !(this.context.authorization)) {
        classLogger.warn({
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, 'Xero connector needs auth and no auth set');
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
          classLogger.info({
            subscription: this.context.subscription._id,
            application: this.context.application._id
          }, 'setting auth');
          this.connector.authorize(this.context.authorization);
        } else {
          classLogger.info({
            subscription: this.context.subscription._id,
            application: this.context.application._id
          }, 'no auth to set');
        }
      })
      .then(function () {
        classLogger.info({
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, 'generating pollEndpoing promises');
        return _.map(this.context.subscription.endpoints, _.bind(this.pollEndpoint, this));
      }).then(function (pollPromises) {
        classLogger.info({
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, 'settling promises');
        return BBPromise.settle(pollPromises);
      })
      .then(function () {
        classLogger.info({
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, 'done with poll');
      }).catch(function (err) {
        classLogger.error({
          err: {
            message: err.message,
            stack: err.stack
          },
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, err.message);
        if (!(err instanceof APILimitReachedError) && !(err instanceof ConnectorRequiresAuthorizationError)) {
          logger.alert(err);
        }
      });

  },
  pollEndpoint: function (endpoint) {
    var singularEndpointName = endpoint.replace(/s$/, '');
    var _lastPoll = this.context.subscription.get(endpoint) ? this.context.subscription.get(endpoint).lastPolled : null;
    var extraHeader = _lastPoll ? {
      'If-Modified-Since': _lastPoll
    } : {};
    var formattedEndpoint = '/' + endpoint;
    classLogger.info({
      subscription: this.context.subscription._id,
      application: this.context.application._id,
      formattedEndpoint: formattedEndpoint,
      extraHeader: extraHeader
    }, 'polling endpoint');
    var timeNow = moment.utc().format();
    var get = this.connector.get(formattedEndpoint, extraHeader);
    return get
      .bind(this)
      .then(function (results) {
        classLogger.info({
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, 'got results from endpoint');
        classLogger.debug({
          results: results,
          endpoint: endpoint
        }, 'got results from endpoint');
        return this.handleResults(results, endpoint, singularEndpointName, _lastPoll, timeNow);
      }).catch(function (err) {
        classLogger.info({
          subscription: this.context.subscription._id,
          application: this.context.application._id,
          error: err.message
        }, 'error from get request');
        classLogger.error({
          err: {
            message: err.message,
            stack: err.stack
          },
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, err.message);
        classLogger.error(err);
      });
  },
  handleResults: function (results, endpoint, singularEndpointName, _lastPoll, timeNow) {
    var self = this;
    if (!results.Response[endpoint]) {
      classLogger.info({
        subscription: this.context.subscription._id,
        application: this.context.application._id,
        endpoint: endpoint
      }, 'no results in response');
      return BBPromise.resolve();
      //   return this.subscription.set(endpoint, {
      //     lastPolled: timeNow
      //   });
    }
    var entities = [].concat(results.Response[endpoint][singularEndpointName]);
    classLogger.debug({
      subscription: this.context.subscription._id,
      application: this.context.application._id,
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
    logger.info({
      subscription: this.context.subscription._id,
      application: this.context.application._id
    }, "mapping results to events");
    return BBPromise.settle(_.map(mappedResults, _.bind(this.raiseEvent, this)))
      .bind(this)
      .then(function (promises) {
        var lastPolled = _.foldr(entities, function (max, next) {
          return next.UpdatedDateUTC > max ? next.UpdatedDateUTC : max;
        }, '');
        lastPolled = lastPolled || results.Response.DateTimeUTC || timeNow;
        var endpointData = this.context.subscription.get(endpoint);
        endpointData.lastPolled = lastPolled;
        this.context.subscription.set(endpoint, endpointData);
        return promises;
      }).catch(function (err) {
        classLogger.error({
          err: {
            message: err.message,
            stack: err.stack
          },
          subscription: this.context.subscription._id,
          application: this.context.application._id
        }, err.message);
      });
  },
  raiseEvent: function (result) {
    logger.info({
      result: result,
      subscription: this.context.subscription._id,
      application: this.context.application._id
    }, 'raising event');
    return this.checkIfNew(result)
      .bind(this)
      .then(function (isNew) {
        var eventName = result.connectorKey + (isNew ? ':new:' : ':modified:') + result.singularEndpointName.toLowerCase();
        classLogger.info({
          eventName: eventName,
          subscription: this.context.subscription._id,
          application: this.context.application._id
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
    if (!meta) {
      this.context.subscription.set(result.endpoint, {
        ids: []
      });
    }
    meta = this.context.subscription.get(result.endpoint);
    meta.ids = meta.ids || [];
    if (result.result[result.singularEndpointName + 'ID'] && meta.ids.indexOf(result.result[result.singularEndpointName + 'ID']) === -1) {
      meta.ids.push(result.result[result.singularEndpointName + 'ID']);
      classLogger.info({
        subscription: this.context.subscription._id,
        application: this.context.application._id,
        meta: meta
      }, 'saving id to meta');
    }
    return BBPromise.resolve(isNew);
  }
};
module.exports = function (context, raiseMethod) {
  var poller = new XeroPoller(context);
  poller.emit = raiseMethod;
  return poller.pollSubscription();
};
