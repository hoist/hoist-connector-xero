'use strict';
require('../bootstrap');
var XeroConnector = require('../../lib/connector');
var sinon = require('sinon');
var BBPromise = require('bluebird');
var expect = require('chai').expect;
var OAuth = require('oauth').OAuth;

describe('XeroConnector', function () {
  var connector;
  before(function () {
    connector = new XeroConnector({
      privateKey: 'privateKey',
      publicKey: 'publicKey',
      consumerKey: 'BPEMJHODRTROXDVOMO6EE8J0YB6MPN',
      consumerSecret: 'EBTYHCQO5TSDHICSSWDYNEL3MYUA38'
    });
  });
  describe('#get', function () {
    var response = {};
    var result;
    before(function () {
      sinon.stub(connector, 'request').returns(BBPromise.resolve(response));
      result = connector.get('/contacts');
    });
    after(function () {
      connector.request.restore();
    });
    it('calls #request', function () {
      expect(connector.request)
        .to.have.been.calledWith('GET', '/contacts');
    });

  });
  describe('#request', function () {
    var result;
    var xml = '<result><key>name</key></result>';
    before(function () {
      sinon.stub(OAuth.prototype, '_performSecureRequest').callsArgWith(7, null, xml, {});
      connector = new XeroConnector({
        privateKey: 'privateKey',
        publicKey: 'publicKey',
        consumerKey: 'BPEMJHODRTROXDVOMO6EE8J0YB6MPN',
        consumerSecret: 'EBTYHCQO5TSDHICSSWDYNEL3MYUA38'
      });
      return (result = connector.request('GET', '/contacts'));
    });
    after(function () {
      OAuth.prototype._performSecureRequest.restore();
    });
    it('calls underlying auth library', function () {
      return expect(OAuth.prototype._performSecureRequest)
        .to.have.been.calledWith('BPEMJHODRTROXDVOMO6EE8J0YB6MPN', 'EBTYHCQO5TSDHICSSWDYNEL3MYUA38', 'GET', 'https://api.xero.com/api.xro/2.0/contacts', null, null, 'application/xml');
    });
    it('returns json', function () {
      return expect(result)
        .to.become({
          result: {
            key: 'name'
          }
        });
    });
  });
});