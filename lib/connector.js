'use strict';
var BBPromise = require('bluebird');
var xml2js = require('xml2js');
var OAuth = require('oauth').OAuth;
var crypto = require('crypto');
var _ = require('lodash');
var baseUrl = 'https://api.xero.com/api.xro/2.0';

function XeroConnector(settings) {
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
  this.auth._createSignature = _.bind(function (signatureBase) {
    return crypto.createSign('RSA-SHA1').update(signatureBase).sign(this.settings.privateKey, "base64");
  }, this);
  this.auth._performSecureRequestAsync = BBPromise.promisify(this.auth._performSecureRequest, this.auth);
}

XeroConnector.prototype.get = function (url) {
  return this.request('GET', url);
};

XeroConnector.prototype.request = function (method, path) {
  return this.auth._performSecureRequestAsync(this.settings.consumerKey, this.settings.consumerSecret, method, baseUrl + path, null, null, 'application/xml')
    .bind(this).spread(function (xml) {
      console.log(xml);
      return this.parser.parseStringAsync(xml);
    });
};


module.exports = XeroConnector;
