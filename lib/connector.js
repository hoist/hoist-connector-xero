'use strict';
var BBPromise = require('bluebird');
var xml2js = require('xml2js');
var OAuth = require('oauth').OAuth;
var crypto = require('crypto');
var _ = require('lodash');
var baseUrl = 'https://api.xero.com/api.xro/2.0';
var logger = require('hoist-logger');
var path = require('path');
var authConfigs = require(path.resolve(__dirname, './auth_config.json'));

function XeroConnector(settings) {
    logger.info({
      settings: settings,
      authConfigs: authConfigs
    }, 'constructed xero-connector');
    this.settings = settings;
    this.parser = BBPromise.promisifyAll(new xml2js.Parser({
      explicitArray: false,
      ignoreAttrs: false,
      async: true
    }));
    var authConfig = authConfigs[settings.authType];
    this.authConfig = authConfig;

    this.auth = BBPromise.promisifyAll(new OAuth(
      authConfig.requestTokenUrl || null,
      authConfig.accessTokenUrl || null,
      settings.consumerKey,
      settings.consumerSecret,
      '1.0A',
      null,
      authConfig.encryptionType || 'RSA-SHA1'
    ));
    this.auth._authorize_callback = 'https://bouncer.hoist.io/bounce';
    if (authConfig.requiresSigning) {
      this.auth._signatureMethod = authConfig.signatureMethod;
      this.auth._createSignature = _.bind(function createXeroSignature(signatureBase) {
        logger.info({
          signatureBase: signatureBase,
          settings: this.settings
        }, 'creating signature');
        return crypto.createSign(authConfig.signatureMethod)
          .update(signatureBase)
          .sign(this.settings.privateKey, "base64");
      }, this);
      this.auth._performSecureRequestAsync = BBPromise.promisify(this.auth._performSecureRequest, this.auth);
    }
  }
  /* istanbul ignore next */
XeroConnector.prototype.authorize = function () {

};

XeroConnector.prototype.generateRequestToken = function () {
  return this.auth.getOAuthRequestTokenAsync();
};

XeroConnector.prototype.receiveBounce = function (bounce) {
  if (this.settings.authType === 'Public') {
    if (bounce.get('RequestToken')) {
      return this.swapRequestToken(bounce.get('RequestToken'))
        .then(function () {

        });
    } else {
      return this.generateRequestToken()
        .bind(this)
        .spread(function (requestToken, requestTokenSecret) {
          return bounce.set('RequestToken', requestToken)
            .bind(this)
            .then(function () {
              return bounce.set('RequestTokenSecret', requestTokenSecret);
            })
            .then(function () {
              bounce.redirect('https://api.xero.com/oauth/Authorize?oauth_token=' + requestToken);
            });
        });
    }
  }
  bounce.done();
};

XeroConnector.prototype.get = function get(url) {
  logger.info('inside hoist-connector-xero.get');
  return this.request('GET', url);
};

XeroConnector.prototype.put = function put(url, data) {
  logger.info('inside hoist-connector-xero.put');
  return this.request('PUT', url, data);
};

XeroConnector.prototype.post = function post(url, data) {
  logger.info('inside hoist-connector-xero.post');
  return this.request('POST', url, data);
};

XeroConnector.prototype.request = function request(method, path, data) {
  var contentType = 'application/xml';
  data = data ? data : null;
  if (method === 'PUT' || method === 'POST') {
    contentType = 'application/x-www-form-urlencoded';
    data = data && !data.xml ? {
      xml: data
    } : data;
  }
  logger.info({
    method: method,
    path: path
  }, 'inside hoist-connector-xero.request');
  return this.auth._performSecureRequestAsync(this.settings.consumerKey, this.settings.consumerSecret, method, baseUrl + path, null, data, contentType)
    .bind(this).spread(function parseXml(xml) {
      logger.info({
        xml: xml
      }, 'got response from request');
      return this.parser.parseStringAsync(xml);
    });
};


module.exports = XeroConnector;
