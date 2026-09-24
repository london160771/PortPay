import { loadBackendEnvironment } from './config/environment.js';

loadBackendEnvironment(import.meta.url);

// Import after loading env because app/config modules read process.env at initialization.
const { app } = await import('./app.js');

const port = Number.parseInt(process.env.PORT || '3001', 10);

app.listen(port, () => {
  console.log(`PortPay backend listening on http://localhost:${port}`);
});
