/* Just copy and paste this snippet into your code */
var _ = require('lodash');

/* either return a promise or call done, here we're returning a promise */
module.exports = function(event, done) {

  var xero = Hoist.connector("<key>");

  return xero.get('Invoices')
    .then(function(invoices) {
      _.each(invoices, function(invoice) {
        Hoist.event.raise('INVOICE:FOUND', invoice);
      });
    });

};
