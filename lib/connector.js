'use strict';
var BBPromise = require('bluebird');
var xml2js = require('xml2js');
var OAuth = require('oauth').OAuth;
var crypto = require('crypto');
var _ = require('lodash');
var baseUrl = 'https://api.xero.com/api.xro/2.0';
var logger = require('hoist-logger');

function XeroConnector(settings) {
  logger.info({
    settings: settings
  }, 'constructed xero-connector');
  this.settings = settings;
  this.parser = BBPromise.promisifyAll(new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    async: true
  }));
  this.auth = BBPromise.promisifyAll(new OAuth(
    null,
    null,
    settings.consumerKey,
    settings.consumerSecret,
    '1.0A',
    null,
    'RSA-SHA1'
  ));

  this.auth._signatureMethod = 'RSA-SHA1';
  this.auth._createSignature = _.bind(function createXeroSignature(signatureBase) {
    logger.info({
      signatureBase: signatureBase,
      settings: this.settings
    }, 'creating signature');
    return crypto.createSign('RSA-SHA1')
      .update(signatureBase)
      .sign(this.settings.privateKey, "base64");
  }, this);
  this.auth._performSecureRequestAsync = BBPromise.promisify(this.auth._performSecureRequest, this.auth);
}

XeroConnector.prototype.get = function get(url) {
  logger.info('inside hoist-connector-xero.get');
  return this.request('GET', url);
};

XeroConnector.prototype.put = function put(url, data) {
  logger.info('inside hoist-connector-xero.put');
  data = {xml:data};
  return this.request('PUT', url, data);
};

XeroConnector.prototype.request = function request(method, path, data) {
  var contentType = method === 'PUT' ? 'application/x-www-form-urlencoded' : 'application/xml';
  data = data ? data : null;
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
