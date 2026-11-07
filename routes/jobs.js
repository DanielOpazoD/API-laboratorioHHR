const express = require('express');
const { getLaboratoryJobs } = require('../services/laboratoryJobs');

const createJobRoutes = (getJobs = getLaboratoryJobs) => {
  const router = express.Router();
  router.use(['/jobs', '/census'], (req, _res, next) => {
    // Only the authenticated Netlify gateway supplies this pseudonymous, verified actor.
    req.jobOwner = req.get('x-hhr-lab-owner');
    if (!/^[a-f0-9]{64}$/.test(req.jobOwner || '')) return next(Object.assign(new Error('Operador requerido.'), { status: 401 }));
    next();
  });
  const handle = fn => (req, res, next) => { try { fn(req, res); } catch (error) { next(error); } };
  router.post('/jobs/:kind(details|census)', handle((req, res) => {
    res.status(202).json({ success: true, job: getJobs().create(req.jobOwner, req.params.kind, req.body) });
  }));
  router.get('/jobs/:id/result', handle((req, res) => res.json({ success: true, ...getJobs().result(req.jobOwner, req.params.id, Number(req.query.offset || 0)) })));
  router.get('/jobs/:id', handle((req, res) => res.json({ success: true, job: getJobs().get(req.jobOwner, req.params.id) })));
  router.post('/jobs/:id/:action(cancel|retry)', handle((req, res) => res.json({ success: true, job: getJobs().change(req.jobOwner, req.params.id, req.params.action) })));
  router.post('/census/state', handle((req, res) => res.json({ success: true, ...getJobs().censusState(req.jobOwner, req.body) })));
  router.post('/census/review', handle((req, res) => {
    getJobs().review(req.jobOwner, req.body.id, req.body.revision);
    res.json({ success: true });
  }));
  router.use((error, _req, res, _next) => res.status([400, 401, 404, 409, 413, 429].includes(error.status) ? error.status : 503)
    .json({ success: false, error: error.status === 409
      ? 'El informe cambió o el resultado aún no está listo. Actualiza la bandeja antes de revisarlo.'
      : error.status === 429 ? 'Ya tienes tres trabajos pendientes. Espera o cancela uno antes de continuar.'
      : 'No se pudo completar la operación de laboratorio. Actualiza o reintenta lo pendiente.' }));
  return router;
};
module.exports = { createJobRoutes };
