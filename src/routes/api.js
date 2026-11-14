const express = require('express');
const empresas = require('../controllers/empresaController');
const periodos = require('../controllers/periodoController');
const documentos = require('../controllers/documentoController');

function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const router = express.Router();

router.get('/empresas', wrap(empresas.listar));
router.post('/empresas', wrap(empresas.crear));
router.put('/empresas/:id', wrap(empresas.editar));
router.delete('/empresas/:id', wrap(empresas.eliminar));

router.get('/periodos', wrap(periodos.asegurar));
router.put('/periodos/:id', wrap(periodos.editar));
router.get('/historial', wrap(periodos.historial));

router.get('/documentos', wrap(documentos.listar));
router.post('/documentos/importar-sii', wrap(documentos.importarSii));
router.post('/documentos/resumen-rapido', wrap(documentos.resumenRapido));
router.post('/documentos', wrap(documentos.crear));
router.put('/documentos/:id', wrap(documentos.editar));
router.delete('/documentos/:id', wrap(documentos.eliminar));

module.exports = router;
