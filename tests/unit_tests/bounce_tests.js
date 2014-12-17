'use strict';
var XeroConnector = require('../../lib/connector');
var sinon = require('sinon');
var OAuth = require('oauth').OAuth;
var expect = require('chai').expect;
var BBPromise = require('bluebird');
describe('Xero Connector', function () {
  describe('Public app', function () {
    describe('#receiveBounce', function () {
      describe('first bounce', function () {
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
        after(function () {
          OAuth.prototype.getOAuthRequestToken.restore();
        });
        it('redirects to xero', function () {
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
      describe('on return from Xero', function () {
        var mockBounce = {
          get: sinon.stub(),
          set: sinon.stub().returns(BBPromise.resolve(null)),
          query: {
            /* jshint camelcase:false */
            oauth_verifier: 'oauth_verifier_value'
          },
          redirect: sinon.stub(),
          done: sinon.stub(),
          delete: sinon.stub().returns(BBPromise.resolve(null))
        };
        before(function () {
          mockBounce.get.withArgs('RequestToken').returns('request_token');
          mockBounce.get.withArgs('RequestTokenSecret').returns('request_token_secret');
          sinon.stub(OAuth.prototype, 'getOAuthAccessToken').yields(null, 'token', 'token_secret');
          var connector = new XeroConnector({
            authType: 'Public'
          });
          connector.receiveBounce(mockBounce);
        });
        after(function () {
          OAuth.prototype.getOAuthAccessToken.restore();
        });
        it('redirects back to app', function () {
          return expect(mockBounce.done)
            .to.have.been
            .called;
        });
        it('sends correct params to get access token', function () {
          expect(OAuth.prototype.getOAuthAccessToken)
            .to.have.been.calledWith('request_token', 'request_token_secret', 'oauth_verifier_value');
        });
        it('saves access token', function () {
          expect(mockBounce.set)
            .to.have.been.calledWith('AccessToken', 'token');
        });
        it('saves access token secret', function () {
          expect(mockBounce.set)
            .to.have.been.calledWith('AccessTokenSecret', 'token_secret');
        });
      });

    });
  });
});
