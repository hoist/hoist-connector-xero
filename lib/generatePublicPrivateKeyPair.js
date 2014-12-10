var openssl = require('./open_ssl');
var q = require('q');

var proxySecurity = function () {

};
 
proxySecurity.prototype.generatePublicPrivateKeyPair = function (data) {

  var _privateKey, _publicKey;
  console.log("Starting", data);

  return q.fcall(function () {

    var deferred = q.defer();

    openssl.createPrivateKey(1024, "", function (err, privateKey) {

      deferred.resolve(privateKey);

    });

    return deferred.promise;

  }).then(function (privateKey) {

    _privateKey = privateKey;

    var a = q.defer();

    openssl.createPublicKey(privateKey, data, function (err, publicKey) {

      if (err) {

        console.log(err);

      } else {

        a.resolve(publicKey);

      }


    });

    return a.promise;


  }).then(function (publicKey) {

    _publicKey = publicKey;
    return {
      public: _publicKey,
      private: _privateKey
    };

  });

};

module.exports = new proxySecurity();
