const express = require('express');
const { ExalabService, KEEP_ALIVE_MS, DEFAULT_STATE_FILE } = require('../services/exalabService');
const { ExalabError } = require('../services/exalabHtml');
let service;
// Production keeps connected sessions across restarts and refreshes them in Exalab while idle.
const createExalabRoutes = (getService = () => (service ||= new ExalabService({ stateFile: DEFAULT_STATE_FILE, keepAliveMs: KEEP_ALIVE_MS }))) => {
  const router = express.Router();
  const route = operation => async (req, res) => {
    try { await operation(getService(), req, res); }
    catch (error) {
      const known = error instanceof ExalabError;
      res.status(known ? error.status : 502).json({ success: false, code: known ? error.code : 'SOURCE_UNAVAILABLE',
        error: known ? error.message : 'No se pudo completar la consulta Exalab. Vuelve a intentar.' });
    }
  };
  const owner = req => req.get('X-HHR-Lab-Owner');
  router.post('/pair', route(async (svc, req, res) => res.json({ success: true, ...svc.pair(owner(req)) })));
  router.post('/session/connect', route(async (svc, req, res) => res.json({ success: true, ...await svc.connect(req.body?.pair, req.body?.session, req.body?.expectedOwner) })));
  router.get('/session', route(async (svc, req, res) => res.json({ success: true, ...await svc.status(owner(req)) })));
  router.delete('/session', route(async (svc, req, res) => res.json({ success: true, ...svc.disconnect(owner(req)) })));
  router.post('/search', route(async (svc, req, res) => res.json({ success: true, data: await svc.search(owner(req), req.body) })));
  router.get('/pdf', route(async (svc, req, res) => res.type('application/pdf').send(await svc.pdf(owner(req), req.query.link))));
  return router;
};
module.exports = { createExalabRoutes };
