require('dotenv').config();

const path = require('path');
const express = require('express');
const api = require('./src/routes/api');
const { initDb } = require('./src/config/db');
const { installWordPressSession } = require('./wordpress-session');

const app = express();
const port = Number(process.env.PORT) || 3002;

app.disable('x-powered-by');
installWordPressSession(app, process.env.JWT_SECRET, 'app_iva_f29');
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada.' });
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  const conexion = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', '28P01', '28000', '3D000', '57P01'];
  const falloDeRed = /SSL|certificate|pg_hba|ECONNREFUSED|ENOTFOUND|password authentication/i.test(error.message || '');
  if (String(error.message || '').includes('password must be a')) {
    res.status(503).json({
      error: 'PostgreSQL rechazó la clave. En .env defina PGPASSWORD o una DATABASE_URL con contraseña.',
    });
    return;
  }
  if (conexion.includes(error.code) || falloDeRed) {
    res.status(503).json({
      error: 'No hay conexión con PostgreSQL. Revise DATABASE_URL en Railway o las variables PGHOST, PGPORT, PGDATABASE, PGUSER y PGPASSWORD en local.',
    });
    return;
  }
  if (error.code === '42P01') {
    res.status(503).json({
      error: 'Faltan las tablas de la aplicación. Revise que database/schema.sql se haya aplicado sobre activa_iva.',
    });
    return;
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: status >= 500 ? 'No se pudo completar la operación. Intente de nuevo.' : error.message,
  });
});

initDb()
  .then(() => {
    const server = app.listen(port, () => {
      console.log(`Activa IVA · Previsión F29 escuchando en http://localhost:${port}`);
    });
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`El puerto ${port} ya está en uso. Cierre el otro proceso o cambie PORT en .env.`);
        process.exit(1);
      }
      console.error(error);
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error('No se pudo preparar PostgreSQL:', error.message);
    process.exitCode = 1;
  });
