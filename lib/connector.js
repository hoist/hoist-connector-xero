'use strict';
var BBPromise = require('bluebird');
var xml2js = require('xml2js');
var OAuth = require('oauth').OAuth;
var crypto = require('crypto');
var _ = require('lodash');
var logger = require('hoist-logger');
var path = require('path');
var authConfigs = require(path.resolve(__dirname, './auth_config.json'));
var keyPairGenerator = require('./key_pair_generator');
var certificateStore = require('hoist-certificate-store');
var http = require('http');
var https = require('https');
var moment = require('moment');


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
  if (settings.authType === 'Partner') {
    this.auth._createClient = _.bind(function (port, hostname, method, path, headers, sslEnabled) {
      headers = headers || {};
      headers['user-agent'] = 'Hoist Apps: ' + this.settings.applicationName;
      var certificates = certificateStore.get('entrust');
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
  this.auth._authorize_callback = 'https://bouncer.hoist.io/bounce';
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
  this.auth._performSecureRequestAsync = BBPromise.promisify(this.auth._performSecureRequest, this.auth);
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
  this.authorization = authorization;
  this.settings.accessKey = authorization.get('AccessToken');
  this.settings.accessSecret = authorization.get('AccessTokenSecret');
};

XeroConnector.prototype.swapRequestToken = function (requestToken, requestTokenSecret, verifier) {
  return this.auth.getOAuthAccessTokenAsync(requestToken, requestTokenSecret, verifier);
};

XeroConnector.prototype.generateRequestToken = function () {
  logger.info('requesting auth token');
  return this.auth.getOAuthRequestTokenAsync();
};
/* istanbul ignore next */
XeroConnector.prototype.refreshToken = function () {
  var accessToken = this.authorization.get('AccessToken');
  var accessTokenSecret = this.authorization.get('AccessTokenSecret');
  /*jshint camelcase: false */
  return this.auth.getOAuthAccessTokenAsync(accessToken, accessTokenSecret, {
    oauth_session_handle: this.authorization.get('SessionHandle')
  }).bind(this).spread(function (accessToken, accessTokenSecret, auth_headers) {
    logger.info(auth_headers);
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
  logger.info(this.settings);
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
  logger.info('inside hoist-connector-xero.get');
  return this.request('GET', url, null, extraHeader);
};

XeroConnector.prototype.put = function put(url, data) {
  logger.info('inside hoist-connector-xero.put');
  return this.request('PUT', url, data);
};

XeroConnector.prototype.post = function post(url, data) {
  logger.info('inside hoist-connector-xero.post');
  return this.request('POST', url, data);
};



XeroConnector.prototype.request = function request(method, path, data, extraHeader) {
  var originalArgs = arguments;
  if (this.settings.authType === 'Partner') {
    var tokenExpiry = this.authorization.get('TokenExpiresAt');
    logger.info({
      tokenExpiry: tokenExpiry
    }, 'token expires');
    if (tokenExpiry) {
      tokenExpiry = moment(tokenExpiry);
      logger.info(moment().subtract(30, 'seconds'));
      logger.info(tokenExpiry);
      logger.info(tokenExpiry.isBefore(moment().subtract(30, 'seconds')));
      if (tokenExpiry.isValid() && tokenExpiry.isBefore(moment().subtract(30, 'seconds'))) {
        logger.info('about to refresh token');
        return this.refreshToken().bind(this).then(function () {
          return this.request.apply(this, originalArgs);
        });
      }
    }
  }
  var contentType = 'application/xml';
  data = data ? data : null;

  logger.info({
    method: method,
    path: path
  }, 'inside hoist-connector-xero.request');
  extraHeader = extraHeader ? extraHeader : null;

  return this.auth._performSecureRequestAsync(this.settings.accessKey, this.settings.accessSecret, method, this.authConfig.url + path, null, data, contentType, extraHeader)
    .bind(this).spread(function parseXml(xml) {
      logger.info({
        xml: xml
      }, 'got response from request');
      return this.parser.parseStringAsync(xml);
    });
};


module.exports = XeroConnector;
