/* Just copy and paste this snippet into your code */
var test = require('test');
var wfm = require('workflowmax');

module.main = function(req, res, done) {

  return wfm.invoice.new(req.body, done);

};