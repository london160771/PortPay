import { runLocalMainnetPreflight } from './mainnetPreflightLocal.js';

if (process.argv.includes('--help')) {
  console.log('Usage: npm --prefix backend run mainnet:preflight:local');
  console.log('Runs the fixed-input X Layer Mainnet preflight using read-only RPC methods and authenticated OKX GET requests.');
} else {
  runLocalMainnetPreflight().then((code) => { process.exitCode = code; }).catch(() => {
    console.error('Local read-only preflight stopped before producing a report; configuration values were not printed.');
    process.exitCode = 1;
  });
}
