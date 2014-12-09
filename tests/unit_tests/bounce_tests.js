'use strict';
var XeroConnector = require('../../lib/connector');
var sinon = require('sinon');
var OAuth = require('oauth').OAuth;
var expect = require('chai').expect;
var BBPromise = require('bluebird');
describe('Xero Connector', function () {
  describe('Public app', function () {
    describe('#receiveBounce', function () {
      var mockBounce = {
        get: sinon.stub(),
        set: sinon.stub().returns(BBPromise.resolve(null)),
        redirect: sinon.stub(),
        done: sinon.stub()
      };
      before(function () {
        sinon.stub(OAuth.prototype, 'getOAuthRequestToken').yields(null, 'token', 'token_secret');
        var connector = new XeroConnector({
          authType: 'Public'
        });
        connector.receiveBounce(mockBounce);
      });
      it('should redirect to xero', function () {
        expect(mockBounce.redirect)
          .to.have.been
          .calledWith('https://api.xero.com/oauth/Authorize?oauth_token=token');
      });
      it('saves request token', function () {
        expect(mockBounce.set)
          .to.have.been.calledWith('RequestToken', 'token');
      });
      it('saves request token secret', function () {
        expect(mockBounce.set)
          .to.have.been.calledWith('RequestTokenSecret', 'token_secret');
      });
    });
  });
});
