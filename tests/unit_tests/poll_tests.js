'use strict';
var config = require('config');
require('../bootstrap');
var Poll = require('../../lib/poll');
var sinon = require('sinon');
var BBPromise = require('bluebird');
var expect = require('chai').expect;
var Model = require('hoist-model');
var mongoose = BBPromise.promisifyAll(Model._mongoose);
var moment = require('moment');
var XeroConnector = require('../../lib/connector');
var Authorization = require('../../lib/authorization');
var SubscriptionController = require('../fixtures/subscription_controller');

describe('Poll', function () {
  var _app;
  var _bucket;
  var _moment = moment();
  var _momentInvoice = _moment.utc().format();
  var _momentPoll = _moment.subtract(5, 'minutes').utc().format();
  var _momentContact = _moment.subtract(5, 'minutes').utc().format();
  var _momentUser = _moment.subtract(5, 'minutes').utc().format();
  var _momentPayment = _moment.subtract(5, 'minutes').utc().format();
  before(function () {
    return mongoose.connectAsync(config.get('Hoist.mongo.db'))
      .then(function () {
        return BBPromise.all([
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
          new Model.Bucket({
            _id: 'bucketId',
            application: 'appId',
            environment: 'test'
          }).saveAsync()
          .then(function (bucket) {
            _bucket = bucket[0];
          }),
        ]);
      }).catch(function (err) {
        console.log('error', err);
      });
  });
  after(function () {
    return BBPromise.all([
      Model.Application.removeAsync({}),
      Model.Organisation.removeAsync({}),
      Model.Bucket.removeAsync({})
    ]).then(function () {
      return mongoose.disconnectAsync();
    });
  });
  describe('with a Public connector', function () {
    var _bouncerToken;
    var _conn;
    before(function () {
      return BBPromise.all([
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
        })
      ]).catch(function (err) {
        console.log('error', err);
      });
    });
    after(function () {
      return BBPromise.all([
        Model.ConnectorSetting.removeAsync({}),
        Model.BouncerToken.removeAsync({})
      ]);
    });
    describe('with no lastPolled for each endpoint', function () {
      describe('with meta.lastPolled within poll frequency', function () {
        var _subscription;
        before(function () {
          return new Model.Subscription({
              _id: 'subscriptionId',
              connector: 'connectorKey',
              application: 'appId',
              environment: 'test',
              endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
              meta: {
                lastPolled: _momentPoll
              }
            }).saveAsync()
            .then(function (subscription) {
              _subscription = new SubscriptionController(subscription[0]);
              return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
            });
        });
        after(function () {
          return Model.Subscription.removeAsync({});
        });
        it('should not update meta.lastPolled', function () {
          return Model.Subscription.findOneAsync().then(function (sub) {
            expect(sub.meta).to.eql({
              lastPolled: _momentPoll
            });
          });
        });
      });
      describe('with no meta.lastPolled', function () {
        describe('with no results from Xero', function () {
          var _subscription;
          var _header = {};
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments']
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken.toObject()));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the lastPoll on the subscription.meta but not for any endpoints', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta).to.have.keys('lastPolled');
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments']
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app, _subscription, _conn, _bouncerToken);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          var _header = {};
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
      describe('with meta.lastPolled earlier than poll frequency', function () {
        describe('with no results from Xero', function () {
          var _subscription;
          var _header = {};
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken.toObject()));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the lastPoll on the subscription.meta but not for any endpoints', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta).to.have.keys('lastPolled');
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app, _subscription, _conn, _bouncerToken);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          var _header = {};
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
    });
    describe('with a lastPolled time for each endpoint', function () {
      describe('with meta.lastPolled within poll frequency', function () {
        var _subscription;
        before(function () {
          return new Model.Subscription({
              _id: 'subscriptionId',
              connector: 'connectorKey',
              application: 'appId',
              environment: 'test',
              endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
              meta: {
                lastPolled: _momentPoll,
                Invoices: {
                  lastPolled: _momentPoll
                },
                Contacts: {
                  lastPolled: _momentPoll
                },
                Users: {
                  lastPolled: _momentPoll
                },
                Payments: {
                  lastPolled: _momentPoll
                }
              }
            }).saveAsync()
            .then(function (subscription) {
              _subscription = new SubscriptionController(subscription[0]);
              return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
            });
        });
        after(function () {
          return Model.Subscription.removeAsync({});
        });
        it('should not update meta.lastPolled', function () {
          return Model.Subscription.findOneAsync().then(function (sub) {
            expect(sub.meta).to.eql({
              lastPolled: _momentPoll,
              Invoices: {
                lastPolled: _momentPoll
              },
              Contacts: {
                lastPolled: _momentPoll
              },
              Users: {
                lastPolled: _momentPoll
              },
              Payments: {
                lastPolled: _momentPoll
              }
            });
          });
        });
      });
      describe('with no meta.lastPolled', function () {
        describe('with no results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken.toObject()));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('does not change the lastPolled for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Users.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPoll);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize');
                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken.toObject()));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
      describe('with meta.lastPolled earlier than poll frequency', function () {
        describe('with no results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment,
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken.toObject()));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('does not change the lastPolled for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Users.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPoll);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize');
                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app.toObject(), _subscription, _conn, _bouncerToken.toObject());
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('calls Connector#authorize with the bouncer token', function () {
            expect(XeroConnector.prototype.authorize)
              .to.have.been.calledWith(new Authorization(_bouncerToken.toObject()));
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
    });
  });
  describe('with a Private connector', function () {
    var _conn;
    before(function () {
      return new Model.ConnectorSetting({
          _id: 'ConnectorSettingId',
          settings: {
            authType: 'Private',
            consumerKey: '0Y8ZYKARNOHINIBNCK3JRE1X56G7TA',
            consumerSecret: 'LEYF1T0YC5AQIQRJQSOFOO2MXVPX66',
            publicKey: "-----BEGIN CERTIFICATE-----\r\nMIIDFjCCAn+gAwIBAgIJAOpAilf4TP34MA0GCSqGSIb3DQEBCwUAMIGjMQswCQYD\r\nVQQGEwJOWjETMBEGA1UECAwKV2VsbGluZ3RvbjETMBEGA1UEBwwKV2VsbGluZ3Rv\r\nbjEOMAwGA1UECgwFSG9pc3QxHzAdBgNVBAsMFnVuZGVmaW5lZDE0MjE4MDM4NjY5\r\nOTgxEzARBgNVBAMMCmFwcC5ob2kuaW8xJDAiBgkqhkiG9w0BCQEWFXN1cHBvcnRA\r\naG9pc3RhcHBzLmNvbTAeFw0xNTAxMjEwMTMxMDdaFw0yMDAxMjAwMTMxMDdaMIGj\r\nMQswCQYDVQQGEwJOWjETMBEGA1UECAwKV2VsbGluZ3RvbjETMBEGA1UEBwwKV2Vs\r\nbGluZ3RvbjEOMAwGA1UECgwFSG9pc3QxHzAdBgNVBAsMFnVuZGVmaW5lZDE0MjE4\r\nMDM4NjY5OTgxEzARBgNVBAMMCmFwcC5ob2kuaW8xJDAiBgkqhkiG9w0BCQEWFXN1\r\ncHBvcnRAaG9pc3RhcHBzLmNvbTCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEA\r\nzM4QuFZjKlZenK1x5vPCTrFlBk/wtsRg6CRjJOOUwevVfwZdwNd8OzoZG8u2Xwhp\r\nYGQpXxPXDbJPFthmd4+GFtCJrxhTxJFg03YgpkaKeLtafWyGxbY5tUmzQrnLQLrk\r\nZZObiSEwlYZarWF6dyomM+BJi16Jy7210SwmBYt2KgECAwEAAaNQME4wHQYDVR0O\r\nBBYEFGdi7COATWJhfyq4NqsBSgCwr1cuMB8GA1UdIwQYMBaAFGdi7COATWJhfyq4\r\nNqsBSgCwr1cuMAwGA1UdEwQFMAMBAf8wDQYJKoZIhvcNAQELBQADgYEAvsWVF6TD\r\nU1qNCyU+EICI3JX+1YOgNFl1//QjDVmHUjPHBUVrMLoGj2rY9Nc6nKUa9Q9CeTo9\r\ncEA+1vtc15meVi7D6ZE4xCRvgl5nTo+D4Tu9hajcP44Piim9eUoesIJuDH1i7mN5\r\ns6pT3xPsFCaZZxGEvkAKq14sXQ4kJwQpNOI=\r\n-----END CERTIFICATE-----",
            "privateKey": "-----BEGIN RSA PRIVATE KEY-----\r\nMIICXQIBAAKBgQDMzhC4VmMqVl6crXHm88JOsWUGT/C2xGDoJGMk45TB69V/Bl3A\r\n13w7Ohkby7ZfCGlgZClfE9cNsk8W2GZ3j4YW0ImvGFPEkWDTdiCmRop4u1p9bIbF\r\ntjm1SbNCuctAuuRlk5uJITCVhlqtYXp3KiYz4EmLXonLvbXRLCYFi3YqAQIDAQAB\r\nAoGBAMk/qEBraxB8RIYzDV0DpKkNOhdk0EXYXN1gfCgQlemko2spx1CqroHIikm8\r\n+N0Td/DnG5w487aaw4rQZIgR+ZCInRoUGYzQCy48qTw9vbXpLw1K3ft2gJ9z3rJK\r\nGisPUO+sYDzTHGHQETAqCMkzrt5YElS9NU394KeRPpzyOrZBAkEA9PL/VRQa2byD\r\nbEDpc+J4BB4+95mT86OurSshq0y8Y9WauaBI5ktNjiiWjYXt49T7xtzFzNEU2x4j\r\nG2/orygAeQJBANYLbZELDSKaYKG6t38FmMCY3FQufGquhXNiOYx5l0zIKCQBGwhW\r\nhwTF8075+S/lkfWW8AjJfTAnhHYH7xIXY8kCQQDqAHoMPPipqX2jnR9opaEhzgM5\r\nZm4BAw2MQPgZPWV7ukPlsUnzN10PwZaR/LAWRxGAGMidsd/KtC+1tmMDcaOBAkBa\r\nP+1N19wM+AzAhIr0SvbSVmGoOQWKsdVhBkx/l5Ec9dQ/AhxU0q8Raymg5jOUZ3a4\r\nl5DUE6juUes/HS9HcIdJAkBXGv+S2pGVB5c74GB7EX8I7EEhxycPSYvyl21sfaKi\r\nVsP29AKskt7LAgNU/t0yWQxbKWHOq7u//LqDOb6jzR6E\r\n-----END RSA PRIVATE KEY-----"
          },
          environment: 'test',
          key: 'connectorKey',
          application: 'appId',
          name: 'connectorName'
        }).saveAsync()
        .then(function (conn) {
          _conn = conn[0];
        });
    });
    after(function () {
      return BBPromise.all([
        Model.ConnectorSetting.removeAsync({})
      ]);
    });
    describe('with no lastPolled for each endpoint', function () {
      describe('with meta.lastPolled within poll frequency', function () {
        var _subscription;
        before(function () {
          return new Model.Subscription({
              _id: 'subscriptionId',
              connector: 'connectorKey',
              application: 'appId',
              environment: 'test',
              endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
              meta: {
                lastPolled: _momentPoll
              }
            }).saveAsync()
            .then(function (subscription) {
              _subscription = new SubscriptionController(subscription[0]);
              return new Poll(_app.toObject(), _subscription, _conn);
            });
        });
        after(function () {
          return Model.Subscription.removeAsync({});
        });
        it('should not update meta.lastPolled', function () {
          return Model.Subscription.findOneAsync().then(function (sub) {
            expect(sub.meta).to.eql({
              lastPolled: _momentPoll
            });
          });
        });
      });
      describe('with no meta.lastPolled', function () {
        describe('with no results from Xero', function () {
          var _header = {};
          var _subscription;
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments']
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });

          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the lastPoll on the subscription.meta but not for any endpoints', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta).to.have.keys('lastPolled');

            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments']
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize');

                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app.toObject(), _subscription, _conn);
              }).catch(function (err) {
                console.log('error', err);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          var _header = {};
          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
      describe('with meta.lastPolled earlier than poll frequency', function () {
        describe('with no results from Xero', function () {
          var _header = {};
          var _subscription;
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });

          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the lastPoll on the subscription.meta but not for any endpoints', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta).to.have.keys('lastPolled');
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize');

                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app.toObject(), _subscription, _conn);
              }).catch(function (err) {
                console.log('error', err);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          var _header = {};
          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
    });
    describe('with a lastPolled time for each endpoint', function () {
      describe('with meta.lastPolled within poll frequency', function () {
        var _subscription;
        before(function () {
          return new Model.Subscription({
              _id: 'subscriptionId',
              connector: 'connectorKey',
              application: 'appId',
              environment: 'test',
              endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
              meta: {
                lastPolled: _momentPoll,
                Invoices: {
                  lastPolled: _momentPoll
                },
                Contacts: {
                  lastPolled: _momentPoll
                },
                Users: {
                  lastPolled: _momentPoll
                },
                Payments: {
                  lastPolled: _momentPoll
                }
              }
            }).saveAsync()
            .then(function (subscription) {
              _subscription = new SubscriptionController(subscription[0]);
              return new Poll(_app.toObject(), _subscription, _conn);
            });
        });
        after(function () {
          return Model.Subscription.removeAsync({});
        });
        it('should not update meta.lastPolled', function () {
          return Model.Subscription.findOneAsync().then(function (sub) {
            expect(sub.meta).to.eql({
              lastPolled: _momentPoll,
              Invoices: {
                lastPolled: _momentPoll
              },
              Contacts: {
                lastPolled: _momentPoll
              },
              Users: {
                lastPolled: _momentPoll
              },
              Payments: {
                lastPolled: _momentPoll
              }
            });
          });
        });
      });
      describe('with no meta.lastPolled', function () {
        describe('with no results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('does not change the lastPolled for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Users.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPoll);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize');
                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app.toObject(), _subscription, _conn);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
      describe('with meta.lastPolled earlier than poll frequency', function () {
        describe('with no results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment,
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get').returns(BBPromise.resolve({
                  Response: {}
                }));
                sinon.stub(XeroConnector.prototype, 'authorize').returns(BBPromise.resolve());
                return new Poll(_app.toObject(), _subscription, _conn);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('does not change the lastPolled for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Users.lastPolled).to.eql(_momentPoll);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPoll);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
        describe('with results from Xero', function () {
          var _subscription;
          var _header = {
            'If-Modified-Since': _momentPoll
          };
          before(function () {
            return new Model.Subscription({
                _id: 'subscriptionId',
                connector: 'connectorKey',
                application: 'appId',
                environment: 'test',
                endpoints: ['Invoices', 'Contacts', 'Users', 'Payments'],
                meta: {
                  lastPolled: _momentPayment,
                  Invoices: {
                    lastPolled: _momentPoll
                  },
                  Contacts: {
                    lastPolled: _momentPoll
                  },
                  Users: {
                    lastPolled: _momentPoll
                  },
                  Payments: {
                    lastPolled: _momentPoll
                  }
                }
              }).saveAsync()
              .then(function (subscription) {
                _subscription = new SubscriptionController(subscription[0]);
                sinon.stub(XeroConnector.prototype, 'get');
                sinon.stub(XeroConnector.prototype, 'authorize');
                XeroConnector.prototype.get.onCall(0).returns(BBPromise.resolve({
                  Response: {
                    Invoices: {
                      Invoice: 'invoice'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(1).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Contacts: {
                      Contact: [{
                        UpdatedDateUTC: _momentPayment
                      }, {
                        UpdatedDateUTC: _momentContact
                      }, {
                        UpdatedDateUTC: _momentUser
                      }]
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(2).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentUser,
                    Users: {
                      User: 'user'
                    }
                  }
                }));
                XeroConnector.prototype.get.onCall(3).returns(BBPromise.resolve({
                  Response: {
                    DateTimeUTC: _momentInvoice,
                    Payments: {
                      Payment: {
                        UpdatedDateUTC: _momentPayment
                      }
                    }
                  }
                }));
                return new Poll(_app.toObject(), _subscription, _conn);
              });
          });
          after(function () {
            XeroConnector.prototype.authorize.restore();
            XeroConnector.prototype.get.restore();
            return Model.Subscription.removeAsync({});
          });
          it('does not call Connector#authorize', function () {
            return expect(XeroConnector.prototype.authorize.called)
              .to.eql(false);
          });
          it('calls Connector#get with the all the subscriptions endpoints', function () {
            expect(XeroConnector.prototype.get.firstCall.args[0])
              .to.eql('/' + _subscription.endpoints[0]);
            expect(XeroConnector.prototype.get.secondCall.args[0])
              .to.eql('/' + _subscription.endpoints[1]);
            expect(XeroConnector.prototype.get.thirdCall.args[0])
              .to.eql('/' + _subscription.endpoints[2]);
            expect(XeroConnector.prototype.get.lastCall.args[0])
              .to.eql('/' + _subscription.endpoints[3]);
          });
          it('calls Connector#get with the correct header', function () {
            expect(XeroConnector.prototype.get.firstCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.secondCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.thirdCall.args[1])
              .to.eql(_header);
            expect(XeroConnector.prototype.get.lastCall.args[1])
              .to.eql(_header);
          });
          it('sets the correct lastPoll for each endpoint', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.Invoices.lastPolled).to.be.at.least(_momentInvoice);
              expect(sub.meta.Contacts.lastPolled).to.eql(_momentContact);
              expect(sub.meta.Users.lastPolled).to.eql(_momentUser);
              expect(sub.meta.Payments.lastPolled).to.eql(_momentPayment);
            });
          });
          it('sets the correct meta.lastPoll', function () {
            return Model.Subscription.findOneAsync().then(function (sub) {
              expect(sub.meta.lastPolled).to.be.above(_momentPoll);
            });
          });
        });
      });
    });
  });
});