'use strict';
var openssl = require('./open_ssl');
var Promise = require('bluebird'); /* jshint ignore:line */

var proxySecurity = function () {
};
 
proxySecurity.prototype.generatePublicPrivateKeyPair = function (data) {

  var _privateKey, _publicKey;

  return new Promise(function (resolve, reject) {

    openssl.createPrivateKey(1024, "", function (err, privateKey) {
      if(err) {
        reject(err);
      } else {
        resolve(privateKey);
      }
    });

  }).then(function (privateKey) {

    _privateKey = privateKey;
    return new Promise(function (resolve, reject) {
      
      openssl.createPublicKey(privateKey, data, function (err, publicKey) {
        if (err) {
          reject(err);
        } else {
          resolve(publicKey);
        }
      });

    });

  }).then(function (publicKey) {

    _publicKey = publicKey;
    return {
      public: _publicKey,
      private: _privateKey
    };

  });

};

module.exports = new proxySecurity();
