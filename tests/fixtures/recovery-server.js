// Synthetic subprocess used only by the recovery integration test.
const http = require('node:http');
let hang = false;
process.on('message', message => { hang = message.hang === true; process.send({ changed: true }); });
http.createServer((_req, res) => {
  if (hang) return;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: true, service: 'syslab-scraper' }));
}).listen(0, '127.0.0.1', function () { process.send({ port: this.address().port }); });
