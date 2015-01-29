'use strict';

function Authorization(token) {
  this._token = token;
  
}
Authorization.prototype.set = function (key, value, callback) {
  this._token.state[key] = value;
  this._token.markModified('state');
  return this._token.saveAsync().bind(this).then(function () {
    return this;
  }).nodeify(callback);
};
Authorization.prototype.get = function (key) {
  return this._token.state[key];
};
Authorization.prototype.delete = function (key, callback) {
  delete this._token.state[key];
  this._token.markModified('state');
  return this._token.saveAsync().bind(this).then(function () {
    return this;
  }).nodeify(callback);
};

module.exports = Authorization;