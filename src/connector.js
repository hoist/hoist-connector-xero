'use strict';
var BBPromise = require('bluebird');
var xml2js = require('xml2js');
var OAuth = require('@hoist/oauth').OAuth;
var crypto = require('crypto');
var _ = require('lodash');
var logger = require('@hoist/logger').child({
  cls: 'XeroConnector'
});
var path = require('path');
var authConfigs = require(path.resolve(__dirname, './auth_config.js'));
var keyPairGenerator = require('./key_pair_generator');
var certificateStore = require('@hoist/certificate-store');
var http = require('http');
var https = require('https');
var moment = require('moment');
var config = require('config');

var payrollEndpoints = ["Employees",
  "LeaveApplications",
  "PayItems",
  "PayrollCalendars",
  "PayRuns",
  "Payslip",
  "Settings",
  "SuperFunds",
  "SuperFundProducts",
  "Timesheets"
];

function XeroConnector(settings) {
  logger.info({
      application: settings.applicationId
    },
    'creating Xero Connector');
  logger.debug({
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

  if (authConfig.accessTokenUrl && settings.payroll === true) {
    authConfig.accessTokenUrl = authConfig.accessTokenUrl + "?scope=payroll." + payrollEndpoints.join(',payroll.');
  }

  this.auth = BBPromise.promisifyAll(new OAuth(
    authConfig.requestTokenUrl || null,
    authConfig.accessTokenUrl || null,
    settings.consumerKey,
    settings.consumerSecret,
    '1.0A',
    null,
    authConfig.encryptionType || 'RSA-SHA1'
  ), {
    multiArgs: true
  });
  if (settings.authType === 'Partner') {
    this.auth._createClient = _.bind(function (port, hostname, method, path, headers, sslEnabled) {
      headers = headers || {};
      headers['user-agent'] = 'Hoist Apps: ' + this.settings.applicationName;
      var certificates = certificateStore.get('entrust');
      logger.info({

        application: this.settings.applicationId,
        cert: certificates.cert.length,
        key: certificates.key.length
      }, 'loaded certs');
      var options = {
        host: hostname,
        port: port,
        path: path,
        method: method,
        headers: headers,
        cert: certificates.cert,
        key: certificates.key
      };
      var httpModel;
      if (sslEnabled) {
        httpModel = https;
      } else {
        httpModel = http;
      }
      return httpModel.request(options);
    }, this);
  }
  /*jshint camelcase: false */
  this.auth._authorize_callback = 'https://' + config.get('Hoist.domains.bouncer') + '/bounce';
  logger.info(this.auth._authorize_callback, 'callback domain');
  if (authConfig.requiresSigning) {
    this.auth._signatureMethod = authConfig.signatureMethod;
    this.auth._createSignature = _.bind(function createXeroSignature(signatureBase) {

      logger.info({
        signatureBase: signatureBase,
        settings: this.settings
      }, 'authorization signature');
      return crypto.createSign(authConfig.signatureMethod)
        .update(signatureBase)
        .sign(this.settings.privateKey, "base64");
    }, this);
  }
  this.auth._performSecureRequestAsync = BBPromise.promisify(this.auth._performSecureRequest, this.auth,{multiArgs:true});
  if (this.settings.authType === 'Private') {
    this.settings.accessKey = this.settings.consumerKey;
    this.settings.accessSecret = this.settings.consumerSecret;
  }
  _.bindAll(this);
}

XeroConnector.defaultSettings = function (authType) {
  if (authType === 'Private' || authType === 'Partner') {
    return keyPairGenerator.generate({
        stamp: Date.now()
      })
      .then(function (keys) {
        return {
          publicKey: keys.public,
          privateKey: keys.private
        };
      });
  }
  return new BBPromise(function (resolve) {
    resolve({});
  });
};

/* istanbul ignore next */
XeroConnector.prototype.authorize = function (authorization) {
  logger.info({
    application: this.settings.applicationId
  }, 'authroizing xero connector');
  this.authorization = authorization;
  this.settings.accessKey = authorization.get('AccessToken');
  this.settings.accessSecret = authorization.get('AccessTokenSecret');
};

XeroConnector.prototype.swapRequestToken = function (requestToken, requestTokenSecret, verifier) {
  logger.info({
    application: this.settings.applicationId
  }, 'swapping request token');
  return this.auth.getOAuthAccessTokenAsync(requestToken, requestTokenSecret, verifier);
};

XeroConnector.prototype.generateRequestToken = function () {
  logger.info('requesting auth token');
  return this.auth.getOAuthRequestTokenAsync();
};
/* istanbul ignore next */
XeroConnector.prototype.refreshCredentials = function () {
  var accessToken = this.authorization.get('AccessToken');
  var accessTokenSecret = this.authorization.get('AccessTokenSecret');
  /*jshint camelcase: false */
  return this.auth.getOAuthAccessTokenAsync(accessToken, accessTokenSecret, {
    oauth_session_handle: this.authorization.get('SessionHandle')
  }).bind(this).spread(function (accessToken, accessTokenSecret, auth_headers) {
    logger.debug(auth_headers);
    logger.info('got request token');
    this.settings.accessKey = accessToken;
    this.settings.accessSecret = accessTokenSecret;
    return this.authorization.set('AccessToken', accessToken)
      .bind(this)
      .then(function () {
        return this.authorization.set('AccessTokenSecret', accessTokenSecret);
      }).then(function () {
        if (auth_headers && auth_headers.oauth_session_handle) {
          var tokenExpiresAt = moment().add(parseInt(auth_headers.oauth_expires_in), 'seconds');
          var sessionExpiresAt = moment().add(parseInt(auth_headers.oauth_authorization_expires_in), 'seconds');
          return this.authorization.set('SessionHandle', auth_headers.oauth_session_handle)
            .bind(this)
            .then(function () {
              this.authorization.set('SessionExpiresAt', sessionExpiresAt.toISOString());
            }).then(function () {
              this.authorization.set('TokenExpiresAt', tokenExpiresAt.toISOString());
            });
        }
      });
  });
};

XeroConnector.prototype.receiveBounce = function (bounce) {
  logger.debug(this.settings);
  if (this.settings.authType === 'Public' || this.settings.authType === 'Partner') {
    if (bounce.get('RequestToken')) {
      /*jshint camelcase: false */
      return this.swapRequestToken(bounce.get('RequestToken'), bounce.get('RequestTokenSecret'), bounce.query.oauth_verifier)
        .spread(function (accessToken, accessTokenSecret, auth_headers) {
          logger.info(auth_headers);
          logger.info('got request token');
          return bounce.delete('RequestToken')
            .then(function () {
              return bounce.delete('RequestTokenSecret');
            }).then(function () {
              return bounce.set('AccessToken', accessToken);
            }).then(function () {
              return bounce.set('AccessTokenSecret', accessTokenSecret);
            }).then(function () {
              if (auth_headers && auth_headers.oauth_session_handle) {
                var tokenExpiresAt = moment().add(parseInt(auth_headers.oauth_expires_in), 'seconds');
                var sessionExpiresAt = moment().add(parseInt(auth_headers.oauth_authorization_expires_in), 'seconds');
                return bounce.set('SessionHandle', auth_headers.oauth_session_handle)
                  .then(function () {
                    bounce.set('SessionExpiresAt', sessionExpiresAt.toISOString());
                  }).then(function () {
                    bounce.set('TokenExpiresAt', tokenExpiresAt.toISOString());
                  });
              }
            }).then(function () {
              bounce.done();
            });
        });
    } else {
      return this.generateRequestToken()
        .bind(this)
        .spread(function (requestToken, requestTokenSecret) {
          logger.info('got request token');
          return bounce.set('RequestToken', requestToken)
            .bind(this)
            .then(function () {
              return bounce.set('RequestTokenSecret', requestTokenSecret);
            })
            .bind(this)
            .then(function () {
              bounce.redirect('https://api.xero.com/oauth/Authorize?oauth_token=' + requestToken);
            });
        });
    }
  }
  bounce.done();
};

XeroConnector.prototype.get = function get(url, extraHeader) {
  logger.info({
    application: this.settings.applicationId,
  }, 'inside hoist-connector-xero.get');
  return this.request('GET', url, null, extraHeader);
};

XeroConnector.prototype.put = function put(url, data) {
  logger.info({
    application: this.settings.applicationId,
  }, 'inside hoist-connector-xero.put');
  return this.request('PUT', url, data);
};

XeroConnector.prototype.post = function post(url, data) {
  logger.info('inside hoist-connector-xero.post');
  return this.request('POST', url, data);
};


XeroConnector.prototype._getUrl = function (path) {
  logger.info({
    path: path
  }, 'generating url for xero');
  var url = this.authConfig.url + path;

  /* Payroll */
  var comparisonPath = path;
  if (path[0] === '/') {
    comparisonPath = path.substr(1);
  }
  comparisonPath = comparisonPath.split('/')[0];
  if (payrollEndpoints.indexOf(comparisonPath) !== -1) {
    url = this.authConfig.payroll + path;
  }
  /* Payroll */

  if (this.auth._createSignatureBaseOriginal) {
    this.auth._createSignatureBase = this.auth._createSignatureBaseOrginal;
    delete this.auth._createSignatureBaseOriginal;
  }
  if (this.settings.runscopeBucket && this.settings.authType !== 'Partner') {
    var uri = require('url').parse(url);
    delete uri.host;
    uri.hostname = uri.hostname.replace(/-/g, '--');
    uri.hostname = uri.hostname.replace(/\./g, '-');
    uri.hostname = uri.hostname + '-' + this.settings.runscopeBucket + '.runscope.net';
    var originalUrl = url;
    url = require('url').format(uri);
    this.auth._createSignatureBaseOriginal = this.auth._createSignatureBase;
    this.auth._createSignatureBase = function (method, u, parameters) {
      return this._createSignatureBaseOriginal(method, originalUrl, parameters);
    };
  }
  logger.info({
    url: url
  }, 'generated url');
  return url;
};
XeroConnector.prototype.request = function request(method, requestPath, data, extraHeader) {
  var _this = this;
  var originalArgs = arguments;
  return BBPromise.resolve()
    .bind(_this)
    .then(function () {
      logger.info({
        method: method,
        requestPath: requestPath,
        data: data,
        extraHeader: extraHeader
      }, 'making request');
      if (_this.settings.authType === 'Partner') {
        var tokenExpiry = _this.authorization.get('TokenExpiresAt');
        logger.info({
          application: _this.settings.applicationId,
          tokenExpiry: tokenExpiry
        }, 'token expires');
        if (tokenExpiry) {
          tokenExpiry = moment(tokenExpiry);
          logger.info(moment().subtract(30, 'seconds'));
          logger.info(tokenExpiry);
          logger.info(tokenExpiry.isBefore(moment().subtract(30, 'seconds')));
          if (tokenExpiry.isValid() && tokenExpiry.isBefore(moment().subtract(30, 'seconds'))) {
            logger.info('about to refresh token');

            return _this.refreshCredentials()
              .then(function () {
                return _this.request.apply(_this, originalArgs);
              });
          }
        }
      }
      var contentType = 'application/xml';
      data = data ? data : null;


      extraHeader = extraHeader ? extraHeader : null;
      var url = _this._getUrl(requestPath);
      logger.info({
        application: _this.settings.applicationId,
        method: method,
        path: requestPath,
        url: url
      }, 'inside hoist-connector-xero.request');
      return _this.auth._performSecureRequestAsync(_this.settings.accessKey, _this.settings.accessSecret, method, url, null, data, contentType, extraHeader)
        .bind(_this).then(function parseXml(xml) {
          logger.info({
            application: _this.settings.applicationId
          }, 'got response from request');
          return _this.parser.parseStringAsync(xml);
        });
    });
};


module.exports = XeroConnector;
