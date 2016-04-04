/* jshint ignore:start */
/*
  <!-- Globals
*/

var exec = require('child_process').exec;
var fs = require('fs');
var uuid = require('node-uuid');
var validator = require('validator');
/*
  -->
  <!-- Local settings
*/

var binary = '/usr/bin/openssl';
var cipher = 'aes-256-cbc';
var tmpFolder = '/tmp/';

/*
  -->
  <!-- Exports
*/
/* istanbul ignore next */
exports.createPrivateKey = function (keylength, password, callback) {
  exec(binary + ' genrsa ' + keylength + ' -x509', function (err, stdout, stderr) {
    if (err) {
      return callback(new Error(err));
    } else {
      var privateKey;
      privateKey = stdout.substring(0, stdout.lastIndexOf("\n"));

      callback(null, privateKey);
    }
  });
};


// openssl req -new -x509 -key privatekey.pem -out publickey.cer -days 1825
// openssl pkcs12 -export -out public_privatekey.pfx -inkey privatekey.pem -in publickey.cer
/* istanbul ignore next */
exports.createPublicKey = function (privateKey, data, callback) {
  var tmpFile = tmpFolder + uuid.v4();

  fs.writeFile(tmpFile, privateKey, function (err) {

    if (err) {
      return callback(new Error(err));
    } else {


      var tag = Date.now().toString();

      // openssl genrsa -out privatekey.pem 1024
      // openssl req -new -x509 -key privatekey.pem -out publickey.cer
      // openssl pkcs12 -export -out public_privatekey.pfx -inkey privatekey.pem -in publickey.cer

      exec(binary + ' req -new -x509 -days 1825 -subj "/C=NZ/ST=Wellington/L=Wellington/O=Hoist/OU=' + data.appName + tag + '/CN=app.hoi.io/emailAddress=support@hoistapps.com" -key ' + tmpFile, function (err, stdout, stderr) {
        if (err) {
          return callback(new Error(err));
        } else {
          var publicKey;
          publicKey = stdout.substring(0, stdout.lastIndexOf("\n"));

          callback(null, publicKey);

          fs.unlink(tmpFile, function (err) {
            if (err) {
              throw err;
            }
          });
        }
      });
    }
  });
};

/* istanbul ignore next */
exports.encryptText = function (decText, password, base64, callback) {
  var tmpFile = tmpFolder + uuid.v4();

  if (base64 == true) {
    var base = '-base64';
  } else {
    var base = '';
  }

  fs.writeFile(tmpFile, decText, function (err) {
    if (err) {
      return callback(new Error(err));
    } else {
      var cmdstring = binary + ' enc -' + cipher + ' -salt ' + base + ' -in ' + tmpFile + ' -pass pass:' + password;

      exec(cmdstring, function (err, stdout, stderr) {
        if (err) {
          return callback(new Error(err));
        } else {
          fs.writeFile(tmpFile + '.out', stdout, function (err) {
            if (err) {
              return callback(new Error(err));
            } else {
              var encText;
              encText = stdout.substring(0, stdout.lastIndexOf("\n"));

              callback(null, encText);

              fs.unlink(tmpFile, function (err) {
                if (err) {
                  throw err;
                }
              });
              fs.unlink(tmpFile + '.out', function (err) {
                if (err) {
                  throw err;
                }
              });
            }
          });
        }
      });
    }
  });
};

/* istanbul ignore next */
exports.decryptText = function (encText, password, base64, callback) {
  var tmpFile = tmpFolder + uuid.v4();

  if (base64 == true) {
    var base = '-base64';
  } else {
    var base = '';
  }

  fs.writeFile(tmpFile, encText + "\n", function (err) {
    if (err) {
      return callback(new Error(err));
    } else {

      var cmdstring = binary + ' enc -d -' + cipher + ' -salt ' + base + ' -in ' + tmpFile + ' -pass pass:' + password;

      exec(cmdstring, function (err, stdout, stderr) {
        if (err) {
          return callback(new Error(err));
        } else {
          console.log(stdout);
          callback(null, stdout);

          fs.unlink(tmpFile, function (err) {
            if (err) {
              throw err;
            }
          });
        }
      })
    }
  });
};

/* istanbul ignore next */
exports.randomString = function (length, base64, callback) {
  if (base64 == true) {
    var base = '-base64';
  } else {
    var base = '';
  }

  if (!length) {
    var length = 128;
  }

  exec(binary + ' rand ' + base + ' ' + length, function (err, stdout, stderr) {
    if (err) {
      return callback(new Error(error));
    } else {
      var rand;
      rand = stdout.substring(0, stdout.lastIndexOf("\n"));

      callback(null, rand);
    }
  });
};

/* istanbul ignore next */
exports.encryptMessage = function (publicKey, message, base64, callback) {
  if (base64 == true) {
    var base = '| base64';
  } else {
    var base = '';
  }

  var tmpKey = tmpFolder + uuid.v4();
  var tmpFile = tmpFolder + uuid.v4();

  fs.writeFile(tmpKey, publicKey, function (err) {
    if (err) {
      return callback(new Error(err));
    } else {
      fs.writeFile(tmpFile, message, function (err) {
        if (err) {
          return callback(new Error(err));
        } else {
          var cmdstring = binary + ' rsautl -encrypt -pubin -inkey ' + tmpKey + ' -in ' + tmpFile + base;

          exec(cmdstring, function (err, stdout, stderr) {
            if (err) {
              return callback(new Error(err));
            } else {
              encMsg = stdout.substring(0, stdout.lastIndexOf("\n"));

              callback(null, encMsg);

              fs.unlink(tmpFile, function (err) {
                if (err) {
                  throw err;
                }
              });
              fs.unlink(tmpKey, function (err) {
                if (err) {
                  throw err;
                }
              });
            }
          });
        }
      });
    }
  });
};

/* istanbul ignore next */
exports.decryptMessage = function (privateKey, encMsg, base64, callback) {
  if (base64 == true) {
    var base = 'base64 -d '
  } else {
    var base = '';
  }

  var tmpKey = tmpFolder + uuid.v4();
  var tmpFile = tmpFolder + uuid.v4();

  fs.writeFile(tmpKey, privateKey, function (err) {
    if (err) {
      return callback(new Error(err));
    } else {
      fs.writeFile(tmpFile, encMsg, function (err) {
        if (err) {
          return callback(new Error(err));
        } else {
          var cmdstring = base + tmpFile + ' > ' + tmpFile + '.enc ; ' + binary + ' rsautl -decrypt -inkey ' + tmpKey + ' -in ' + tmpFile + '.enc';

          exec(cmdstring, function (err, stdout, stderr) {
            if (err) {
              return callback(new Error(err));
            } else {
              decMsg = stdout + "\n";

              callback(null, decMsg);

              fs.unlink(tmpFile, function (err) {
                if (err) throw err;
              });
              fs.unlink(tmpFile + '.enc', function (err) {
                if (err) throw err;
              });
              fs.unlink(tmpKey, function (err) {
                if (err) throw err;
              });
            }
          });
        }
      });
    }
  });
};
/* jshint ignore:end */