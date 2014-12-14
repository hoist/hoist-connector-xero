/* Just copy and paste this snippet into your code */
var _ = require('lodash');

module.exports = function(req, res, done) {

  var xero = Hoist.connector("<key>");

  return xero.get('Invoices')
    .then(function(invoices) {
      _.each(invoices, function(invoice) {
        Hoist.event.raise('INVOICE:FOUND', invoice);
      });
    });

};