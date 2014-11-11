'use strict';
require('../bootstrap');
var XeroConnector = require('../../lib/connector');
var fs = require('fs');
var path = require('path');
var expect = require('chai').expect;

describe.skip('XeroConnector', function () {
  this.timeout(50000);
  describe('valid connection to get /contacts', function () {
    var response;
    var expectedResponse = require(path.resolve(__dirname, '../fixtures/responses/get_contacts.json'));
    before(function () {
      var privateKey = fs.readFileSync(path.resolve(__dirname, '../fixtures/xero-private.pem')).toString();
      var publicKey = fs.readFileSync(path.resolve(__dirname, '../fixtures/xero-private.cer')).toString();
      var connector = new XeroConnector({
        privateKey: privateKey,
        publicKey: publicKey,
        consumerKey: 'BPEMJHODRTROXDVOMO6EE8J0YB6MPN',
        consumerSecret: 'EBTYHCQO5TSDHICSSWDYNEL3MYUA38'
      });
      response = connector.get('/contacts');
    });
    it('returns expected json', function () {
      return expect(response.then(function (json) {
        return json.Response.Contacts.Contact.length;
      })).to.become(expectedResponse.Response.Contacts.Contact.length);
    });
  });
});
