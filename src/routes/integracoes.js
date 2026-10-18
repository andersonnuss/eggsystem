const express = require('express');
const modelo = require('../alexa/modelo');

const router = express.Router();

router.get('/alexa', (req, res) => {
  res.render('integracoes/alexa', {
    titulo: 'Alexa',
    configurada: !!process.env.ALEXA_SKILL_ID,
    semVerificacao: process.env.ALEXA_SEM_VERIFICACAO === 'true',
    invocacao: modelo.INVOCACAO,
    endpoint: `${req.protocol}://${req.get('host')}/alexa`,
    json: JSON.stringify(modelo.gerar(), null, 2),
  });
});

router.get('/alexa/modelo.json', (req, res) => {
  res.attachment('eggsystem-alexa-pt-BR.json').json(modelo.gerar());
});

module.exports = router;
