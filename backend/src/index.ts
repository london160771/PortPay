import 'dotenv/config';
import { app } from './app.js';

const port = Number.parseInt(process.env.PORT || '3001', 10);

app.listen(port, () => {
  console.log(`PortPay backend listening on http://localhost:${port}`);
});
