'use strict';
var config = require('config');
var Poll = require('../../lib/poll');
require('../bootstrap');
var BBPromise = require('bluebird');
var expect = require('chai').expect;
var Model = require('hoist-model');
var mongoose = BBPromise.promisifyAll(Model._mongoose);
var SubscriptionController = require('../fixtures/subscription_controller');

describe.skip('Poll Integration', function () {
  before(function () {
    return mongoose.connectAsync(config.get('Hoist.mongo.db'));
  });
  after(function () {
    return mongoose.disconnectAsync();
  });
  describe('with a Private connector', function () {
    describe('with no lastPolled for each endpoint', function () {
      var _app, _bucket, _subscription, _conn, _user;
      describe('with results from Xero', function () {
        var _response;
        this.timeout(600000);
        before(function (done) {
          BBPromise.all([
            new Model.Organisation({
              _id: 'orgId',
              name: 'test org',
              slug: 'org'
            }).saveAsync(),
            new Model.Application({
              _id: 'appId',
              organisation: 'orgId',
              name: 'test app',
              apiKey: 'apiKey',
              slug: 'app',
              maxExecutors: 1,
              currentExecutors: 0
            }).saveAsync()
            .then(function (app) {
              _app = app[0];
            }),
            new Model.ConnectorSetting({
              _id: 'ConnectorSettingIdPrivate',
              settings: {
                authType: 'Private',
                consumerKey: '0Y8ZYKARNOHINIBNCK3JRE1X56G7TA',
                consumerSecret: 'LEYF1T0YC5AQIQRJQSOFOO2MXVPX66',
                publicKey: "-----BEGIN CERTIFICATE-----\r\nMIIDFjCCAn+gAwIBAgIJAOpAilf4TP34MA0GCSqGSIb3DQEBCwUAMIGjMQswCQYD\r\nVQQGEwJOWjETMBEGA1UECAwKV2VsbGluZ3RvbjETMBEGA1UEBwwKV2VsbGluZ3Rv\r\nbjEOMAwGA1UECgwFSG9pc3QxHzAdBgNVBAsMFnVuZGVmaW5lZDE0MjE4MDM4NjY5\r\nOTgxEzARBgNVBAMMCmFwcC5ob2kuaW8xJDAiBgkqhkiG9w0BCQEWFXN1cHBvcnRA\r\naG9pc3RhcHBzLmNvbTAeFw0xNTAxMjEwMTMxMDdaFw0yMDAxMjAwMTMxMDdaMIGj\r\nMQswCQYDVQQGEwJOWjETMBEGA1UECAwKV2VsbGluZ3RvbjETMBEGA1UEBwwKV2Vs\r\nbGluZ3RvbjEOMAwGA1UECgwFSG9pc3QxHzAdBgNVBAsMFnVuZGVmaW5lZDE0MjE4\r\nMDM4NjY5OTgxEzARBgNVBAMMCmFwcC5ob2kuaW8xJDAiBgkqhkiG9w0BCQEWFXN1\r\ncHBvcnRAaG9pc3RhcHBzLmNvbTCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA\r\nzM4QuFZjKlZenK1x5vPCTrFlBk/wtsRg6CRjJOOUwevVfwZdwNd8OzoZG8u2Xwhp\r\nYGQpXxPXDbJPFthmd4+GFtCJrxhTxJFg03YgpkaKeLtafWyGxbY5tUmzQrnLQLrk\r\nZZObiSEwlYZarWF6dyomM+BJi16Jy7210SwmBYt2KgECAwEAAaNQME4wHQYDVR0O\r\nBBYEFGdi7COATWJhfyq4NqsBSgCwr1cuMB8GA1UdIwQYMBaAFGdi7COATWJhfyq4\r\nNqsBSgCwr1cuMAwGA1UdEwQFMAMBAf8wDQYJKoZIhvcNAQELBQADgYEAvsWVF6TD\r\nU1qNCyU+EICI3JX+1YOgNFl1//QjDVmHUjPHBUVrMLoGj2rY9Nc6nKUa9Q9CeTo9\r\ncEA+1vtc15meVi7D6ZE4xCRvgl5nTo+D4Tu9hajcP44Piim9eUoesIJuDH1i7mN5\r\ns6pT3xPsFCaZZxGEvkAKq14sXQ4kJwQpNOI=\r\n-----END CERTIFICATE-----",
                privateKey: "-----BEGIN RSA PRIVATE KEY-----\r\nMIICXQIBAAKBgQDMzhC4VmMqVl6crXHm88JOsWUGT/C2xGDoJGMk45TB69V/Bl3A\r\n13w7Ohkby7ZfCGlgZClfE9cNsk8W2GZ3j4YW0ImvGFPEkWDTdiCmRop4u1p9bIbF\r\ntjm1SbNCuctAuuRlk5uJITCVhlqtYXp3KiYz4EmLXonLvbXRLCYFi3YqAQIDAQAB\r\nAoGBAMk/qEBraxB8RIYzDV0DpKkNOhdk0EXYXN1gfCgQlemko2spx1CqroHIikm8\r\n+N0Td/DnG5w487aaw4rQZIgR+ZCInRoUGYzQCy48qTw9vbXpLw1K3ft2gJ9z3rJK\r\nGisPUO+sYDzTHGHQETAqCMkzrt5YElS9NU394KeRPpzyOrZBAkEA9PL/VRQa2byD\r\nbEDpc+J4BB4+95mT86OurSshq0y8Y9WauaBI5ktNjiiWjYXt49T7xtzFzNEU2x4j\r\nG2/orygAeQJBANYLbZELDSKaYKG6t38FmMCY3FQufGquhXNiOYx5l0zIKCQBGwhW\r\nhwTF8075+S/lkfWW8AjJfTAnhHYH7xIXY8kCQQDqAHoMPPipqX2jnR9opaEhzgM5\r\nZm4BAw2MQPgZPWV7ukPlsUnzN10PwZaR/LAWRxGAGMidsd/KtC+1tmMDcaOBAkBa\r\nP+1N19wM+AzAhIr0SvbSVmGoOQWKsdVhBkx/l5Ec9dQ/AhxU0q8Raymg5jOUZ3a4\r\nl5DUE6juUes/HS9HcIdJAkBXGv+S2pGVB5c74GB7EX8I7EEhxycPSYvyl21sfaKi\r\nVsP29AKskt7LAgNU/t0yWQxbKWHOq7u//LqDOb6jzR6E\r\n-----END RSA PRIVATE KEY-----"
              },
              environment: 'test',
              key: 'connectorKey',
              application: 'appId',
              name: 'connectorName'
            }).saveAsync()
            .then(function (conn) {
              _conn = conn[0];
            }),
            new Model.Subscription({
              _id: 'subscriptionId',
              connector: 'connectorKey',
              application: 'appId',
              environment: 'test',
              endpoints: ['Invoices', 'Contacts', 'Users', 'Payments']
            }).saveAsync()
            .then(function (subscription) {
              _subscription = new SubscriptionController(subscription[0]);
            }),
            new Model.Bucket({
              _id: 'bucketId',
              application: 'appId',
              environment: 'test'
            }).saveAsync()
            .then(function (bucket) {
              _bucket = bucket[0];
            })
          ]).then(function () {
            _subscription.eventEmitter.on('done', function () {
              _response = 'done';
              done();
            });
            _subscription.eventEmitter.on('connectorKey:new:user', function (user) {
              _user = user;
            });
            return new Poll(_app.toObject(), _subscription, _conn);
          }).catch(function (err) {
            console.log('error', err, err.stack);
          });
        });
        after(function () {
          return BBPromise.all([
            Model.ConnectorSetting.removeAsync({}),
            Model.Application.removeAsync({}),
            Model.Organisation.removeAsync({}),
            Model.Bucket.removeAsync({}),
            Model.Subscription.removeAsync({})
          ]);
        });
        it('emits done event', function () {
          expect(_response)
            .to.eql('done');
        });
        it('emits a connectorKey:new:user event', function () {
           /* jshint -W030 */
          expect(_user).to.exist;
          /* jshint +W030 */
        });
      });
    });
  });
  describe('with a Public connector', function () {
    describe('with no lastPolled for each endpoint', function () {
      var _app, _bucket, _subscription, _bouncerToken, _conn;
      describe('with results from Xero', function () {
        var _response;
        this.timeout(600000);
        before(function (done) {
          BBPromise.all([
            new Model.Organisation({
              _id: 'orgId',
              name: 'test org',
              slug: 'org'
            }).saveAsync(),
            new Model.Application({
              _id: 'appId',
              organisation: 'orgId',
              name: 'test app',
              apiKey: 'apiKey',
              slug: 'app',
              maxExecutors: 1,
              currentExecutors: 0
            }).saveAsync()
            .then(function (app) {
              _app = app[0];
            }),
            new Model.ConnectorSetting({
              _id: 'ConnectorSettingId',
              settings: {
                authType: 'Public',
                consumerKey: 'SZ9MEML6RHTGI1DOCQUHAA8WP5K2AB',
                consumerSecret: 'TUVSWFDU8UWQRI2HG6JCWRQRQI6TPF'
              },
              environment: 'test',
              key: 'connectorKey',
              application: 'appId',
              name: 'connectorName'
            }).saveAsync()
            .then(function (conn) {
              _conn = conn[0];
            }),
            new Model.Subscription({
              _id: 'subscriptionId',
              connector: 'connectorKey',
              application: 'appId',
              environment: 'test',
              endpoints: ['Invoices', 'Contacts', 'Users', 'Payments']
            }).saveAsync()
            .then(function (subscription) {
              _subscription = new SubscriptionController(subscription[0]);
            }),
            new Model.BouncerToken({
              _id: 'bouncerTokenId',
              eventId: 'eventId4',
              application: 'appId',
              environment: 'test',
              bucketId: 'bucketId',
              connectorKey: 'connectorName',
              connectorType: 'hoist-connector-xero',
              key: 'PRkBiadcRCTyldLnoMIZQEALBzx6ja2Q',
              state: {
                AccessTokenSecret: 'OUORKUDBOZ1KRD1DEL5OQHY8ZEWRZX',
                AccessToken: 'NQDQSMA3YSYA1F1DKYRBAM9FQEJ8MY'
              }
            }).saveAsync()
            .then(function (bouncerToken) {
              _bouncerToken = bouncerToken[0];
            }),
            new Model.Bucket({
              _id: 'bucketId',
              application: 'appId',
              environment: 'test'
            }).saveAsync()
            .then(function (bucket) {
              _bucket = bucket[0];
            })
          ]).then(function () {
            _subscription.eventEmitter.on('done', function () {
              _response = 'done';
              done();
            });
            return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
          }).catch(function (err) {
            console.log('error', err);
          });
        });
        after(function () {
          return BBPromise.all([
            Model.ConnectorSetting.removeAsync({}),
            Model.Application.removeAsync({}),
            Model.BouncerToken.removeAsync({}),
            Model.Organisation.removeAsync({}),
            Model.Bucket.removeAsync({}),
            Model.Subscription.removeAsync({})
          ]);
        });
        it('emits done event', function () {
          expect(_response).to.eql('done');
        });
      });
    });
  });
});

//tests for invalid bounce token/ expired tokens, does it still emit events
