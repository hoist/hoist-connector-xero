'use strict';
var Connector = require('../../lib/connector');
var fs = require('fs');
var path = require('path');
var BBPromise = require('bluebird');
describe.skip('Partner Auth', function () {
  var connector;
  before(function () {
    var privateKey = fs.readFileSync(path.resolve('/Volumes/Store/Projects/hoist/ssl/xero/hoist_xero_private_key.pem')).toString();
    var publicKey = fs.readFileSync(path.resolve('/Volumes/Store/Projects/hoist/ssl/xero/hoist_xero.cer')).toString();
    connector = new Connector({
      authType: 'Partner',
      privateKey: privateKey,
      publicKey: publicKey,
      consumerKey: 'NXKZHFJYX3SFUHZ7RXKXLE0LTZPMM0',
      consumerSecret: '2TIE2ST6N1U54JZ8KHRDWONLW02SZM'
    });
  });
  this.timeout(50000);
  describe('initial bounce', function () {
    before(function () {
      var bounce = {
        get: function (key) {
          if (key === 'AccessToken') {
            return 'JPPFNJF9STVLRZCEIOFJUCSARMRGIO';
          }
          if (key === 'AccessTokenSecret') {
            return 'N5SLLMLXEA04NNAAWHTY5QZR7CDGL8';
          }
          return undefined;
        },
        delete: function () {
          return BBPromise.resolve(null);
        },
        set: function () {
          console.log('set', arguments);
          return BBPromise.resolve(null);
        },
        redirect: function () {
          console.log('redirect', arguments);
          return BBPromise.resolve(null);
        },
        done: function () {
          console.log('done', arguments);
          return BBPromise.resolve(null);
        }
      };
      connector.authorize(bounce);
      return connector.get('/contacts').then(function () {
        console.log(arguments);
      }).catch(function (err) {
        console.log(err, err.stack);
      });

    });
    it('should do some redirect', function () {

    });
  });
});
