import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, decodeFunctionData, formatUnits, http, isAddress } from 'viem';
import { assertReadOnlyHttpMethod, createReadOnlyRpcFetch } from './readOnlyRpcGuard.js';
import type { MainnetReadOnlyClient } from '../settlement/mainnetPreflight.js';
import type { MainnetBuilderCodeReadClient } from '../settlement/mainnetBuilderCodes.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS = '4800000000000000';
const syntheticInvoiceId = '8f3c8a10-6a4e-4f56-9e3b-2c7d5f1a9b40';

// These are the fixed buyer/merchant wallets used by the existing Mainnet Phase 2 preflight fixture.
export const localMainnetPreflightParticipants = {
  buyer: '0xbabdfef588cf57efcc7c8857960e3ccdd9167589',
  merchant: '0x815c2fb8178f0bf80ada8c5b97ff44ece90e6e25',
} as const;

const approvalAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

type ApiObservation = {
  path: string;
  httpStatus: number;
  apiCode?: string;
  chain?: string;
  input?: string;
  output?: string;
  minimumReceive?: string;
  router?: string;
  spender?: string;
  receiver?: string | null;
};

function safeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const typed = error as { name?: unknown; shortMessage?: unknown; status?: unknown; apiCode?: unknown; message?: unknown };
    if (typeof typed.status === 'number' || typeof typed.apiCode === 'string') {
      return `OKX HTTP ${String(typed.status ?? 'n/a')}, API code ${String(typed.apiCode ?? 'n/a')}.`;
    }
    if (typeof typed.shortMessage === 'string') return redact(typed.shortMessage.replace(/\s+/g, ' '));
    if ((typed.name === 'OkxDexApiError' || typed.name === 'MainnetPreparationError') && typeof typed.message === 'string') {
      return redact(typed.message.replace(/https?:\/\/[^\s"']+/gi, '[URL REDACTED]'));
    }
  }
  return 'Request failed before a usable response; sensitive configuration is withheld.';
}

function redact(text: string): string {
  let result = text;
  for (const name of ['OKX_DEX_API_KEY', 'OKX_DEX_SECRET_KEY', 'OKX_DEX_PASSPHRASE']) {
    const secret = process.env[name];
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result.slice(0, 220);
}

function formatted(value: string | undefined, decimals: number): string {
  if (!value || !/^\d+$/.test(value)) return 'not available';
  return formatUnits(BigInt(value), decimals);
}

function print(label: string, value: string): void {
  console.log(`${label}: ${value}`);
}

export async function runLocalMainnetPreflight(): Promise<number> {
  // Load only backend/.env, independent of the shell's current working directory.
  dotenv.config({ path: resolve(scriptDirectory, '../../.env') });
  console.log('PortPay local X Layer Mainnet read-only preflight');
  print('Transaction signing/broadcast', 'disabled; none sent');
  print('Fixed input', `0.0048 wNVDAx (${LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS} base units)`);

  const requiredEnv = ['OKX_DEX_API_KEY', 'OKX_DEX_SECRET_KEY', 'OKX_DEX_PASSPHRASE'];
  const missing = requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    print('OKX connectivity/auth', `BLOCKED; missing backend environment setting(s): ${missing.join(', ')}`);
    return 1;
  }

  const [{ mainnetAddressConfig, mainnetSupportedAssets, xLayerMainnet, xLayerMainnetChain }, { OKXDEXMainnetAdapter }, { OkxDexApiClient }, { runMainnetPreflight }, { InMemoryMainnetReconciliationRepository }] = await Promise.all([
    import('../config/xlayerMainnet.js'),
    import('../settlement/mainnet.js'),
    import('../settlement/okxDexApi.js'),
    import('../settlement/mainnetPreflight.js'),
    import('../settlement/mainnetReconciliationRepository.js'),
  ]);

  const apiObservations: ApiObservation[] = [];
  const apiFetch: typeof fetch = async (input, init) => {
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    assertReadOnlyHttpMethod(method);
    const response = await globalThis.fetch(input, init);
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    const observation: ApiObservation = { path, httpStatus: response.status };
    try {
      const body = await response.clone().json() as { code?: unknown; data?: unknown };
      if (typeof body.code === 'string') observation.apiCode = body.code;
      const first = Array.isArray(body.data) ? body.data[0] as Record<string, unknown> | undefined : undefined;
      if (first && path.endsWith('/quote')) {
        observation.chain = typeof first.chainIndex === 'string' ? first.chainIndex : undefined;
        observation.input = typeof first.fromTokenAmount === 'string' ? first.fromTokenAmount : undefined;
        observation.output = typeof first.toTokenAmount === 'string' ? first.toTokenAmount : undefined;
      } else if (first && path.endsWith('/approve-transaction')) {
        observation.spender = typeof first.dexContractAddress === 'string' ? first.dexContractAddress : undefined;
      } else if (first && path.endsWith('/swap')) {
        const result = first.routerResult as Record<string, unknown> | undefined;
        const transaction = first.tx as Record<string, unknown> | undefined;
        observation.chain = typeof result?.chainIndex === 'string' ? result.chainIndex : undefined;
        observation.input = typeof result?.fromTokenAmount === 'string' ? result.fromTokenAmount : undefined;
        observation.output = typeof result?.toTokenAmount === 'string' ? result.toTokenAmount : undefined;
        observation.minimumReceive = typeof transaction?.minReceiveAmount === 'string' ? transaction.minReceiveAmount : undefined;
        observation.router = typeof transaction?.to === 'string' ? transaction.to : undefined;
        observation.receiver = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).searchParams.get('swapReceiverAddress');
      }
    } catch {
      // The production API client validates the complete response; retain only status here.
    }
    apiObservations.push(observation);
    return response;
  };

  const publicClient = createPublicClient({
    chain: xLayerMainnetChain,
    transport: http(xLayerMainnet.rpcUrl, { fetchFn: createReadOnlyRpcFetch(), timeout: 15_000 }),
  });

  try {
    const chainId = await publicClient.getChainId();
    print('X Layer RPC chain ID', chainId === 196 ? '196 — PASS' : `${chainId} — FAIL (expected 196)`);
    if (chainId !== 196) return 1;
  } catch (error) {
    print('X Layer RPC chain ID', `BLOCKED — ${safeError(error)}`);
    return 1;
  }

  const api = new OkxDexApiClient({ fetchFn: apiFetch });
  let supportedChains: string[];
  try {
    supportedChains = await api.getSupportedChains();
    const auth = apiObservations.at(-1);
    const apiOk = auth?.httpStatus !== undefined && auth.httpStatus >= 200 && auth.httpStatus < 300 && auth.apiCode === '0';
    print('OKX connectivity/auth', apiOk ? `PASS — HTTP ${auth.httpStatus}, API code 0${supportedChains.includes('196') ? ', chain 196 supported' : ''}` : 'FAIL — authenticated response was not successful');
    if (!apiOk || !supportedChains.includes('196')) return 1;
  } catch (error) {
    const auth = apiObservations.at(-1);
    print('OKX connectivity/auth', auth ? `FAIL — HTTP ${auth.httpStatus}, API code ${auth.apiCode ?? 'unavailable'}` : `BLOCKED — ${safeError(error)}`);
    return 1;
  }

  if (!mainnetAddressConfig.builderCode || !mainnetAddressConfig.builderPayoutAddress) {
    print('Builder Code', 'BLOCKED — backend mainnet code/payout configuration is missing');
    return 1;
  }

  const { buyer, merchant } = localMainnetPreflightParticipants;
  if (!isAddress(buyer) || !isAddress(merchant)) {
    print('Participants', 'BLOCKED — fixed local preflight wallet configuration is invalid');
    return 1;
  }
  const now = new Date().toISOString();
  const invoice = {
    id: syntheticInvoiceId,
    title: 'Local read-only mainnet preflight',
    amountUsdt0: '1.00',
    merchantAddress: merchant,
    paymentUrl: `https://portpay.invalid/pay/${syntheticInvoiceId}`,
    status: 'pending' as const,
    createdAt: now,
    updatedAt: now,
  };
  const adapter = new OKXDEXMainnetAdapter({ apiClient: api, builderCode: mainnetAddressConfig.builderCode });
  const wnvda = mainnetSupportedAssets.find((asset) => asset.key === 'wNvda');
  if (!wnvda) {
    print('Preflight', 'BLOCKED — wNVDAx is not configured as a supported mainnet asset');
    return 1;
  }

  try {
    // Fixed literal by design: do not size this input from the synthetic invoice.
    const quote = await adapter.getQuote({ assetKey: 'wNvda', assetAmount: LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS, buyerAddress: buyer, invoice });
    const approval = await adapter.prepareApprovalTransaction(quote);
    const decodedApproval = decodeFunctionData({ abi: approvalAbi, data: approval.data });
    const spender = decodedApproval.args[0];
    const approvalAmount = decodedApproval.args[1];
    if (approvalAmount !== BigInt(LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS)) throw new Error('OKX exact approval amount did not equal the fixed input.');

    const repository = new InMemoryMainnetReconciliationRepository();
    const preflight = await runMainnetPreflight({
      adapter,
      invoice,
      quote,
      approval,
      publicClient: publicClient as unknown as MainnetReadOnlyClient,
      builderCodeClient: publicClient as unknown as MainnetBuilderCodeReadClient,
      repository,
      expectedBuilderPayoutAddress: mainnetAddressConfig.builderPayoutAddress,
    });
    const balances = preflight.balances;
    const evidence = preflight.preparationId ? await repository.getPreparation(preflight.preparationId) : null;
    const swapResponse = [...apiObservations].reverse().find((item) => item.path.endsWith('/swap'));

    const expectedOutput = evidence?.expectedOutput ?? swapResponse?.output;
    const minimumReceive = evidence?.minimumReceive ?? swapResponse?.minimumReceive;
    const router = evidence?.router ?? swapResponse?.router;
    const verifiedSpender = evidence?.spender ?? spender;
    const minimumCoversInvoice = minimumReceive !== undefined && /^\d+$/.test(minimumReceive) && BigInt(minimumReceive) >= 1_000_000n;
    const allowance = balances?.allowance;
    const exactAllowance = allowance !== undefined && BigInt(allowance) === BigInt(LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS);
    const assetBalance = balances?.assetBalance;
    const balanceSufficient = assetBalance !== undefined && BigInt(assetBalance) >= BigInt(LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS);

    print('Fresh OKX quote', `input ${quote.assetAmount} base units; expires ${quote.expiresAt}`);
    print('Buyer wNVDAx balance', balances ? `${formatted(assetBalance, 18)} (${assetBalance} base units) — ${balanceSufficient ? 'sufficient' : 'insufficient'}` : 'not verified');
    print('Expected USD₮0 output', expectedOutput ? `${formatted(expectedOutput, 6)} (${expectedOutput} base units)` : 'not available — fresh swap response was not accepted');
    print('Minimum receive', minimumReceive ? `${formatted(minimumReceive, 6)} (${minimumReceive} base units); >= 1.00: ${minimumCoversInvoice ? 'yes' : 'no'}` : 'not available');
    print('Merchant receiver', evidence?.merchant ?? swapResponse?.receiver ?? 'not verified');
    print('Router', router ?? 'not available');
    print('Spender', `${verifiedSpender}${verifiedSpender.toLowerCase() === wnvda.address.toLowerCase() ? ' — INVALID (token address)' : ''}`);
    print('Allowance', allowance !== undefined ? `${formatted(allowance, 18)} (${allowance} base units); exact: ${exactAllowance ? 'yes' : 'no'}` : 'not verified');
    print('Builder Code', `${preflight.builderCode.status}${preflight.builderCode.payoutAddress ? ` — payout ${preflight.builderCode.payoutAddress}` : ''}`);

    let approvalSimulation = preflight.simulations?.approval === 'passed' ? 'PASS' : preflight.simulations?.approval === 'not-run' ? 'not run (exact allowance already exists)' : 'not reached';
    let approvalGasReport = 'not estimated';
    let approvalGasEstimateSucceeded = false;
    let approvalGasSufficient: boolean | undefined;
    if (preflight.status === 'APPROVAL_REQUIRED' && preflight.simulations?.approval === 'passed' && approval.attributedData && balances) {
      approvalSimulation = 'PASS — exact attributed approve calldata';
      try {
        const [rawGas, gasPrice] = await Promise.all([
          publicClient.estimateGas({ account: approval.from, to: approval.to, data: approval.attributedData, value: approval.value }),
          publicClient.getGasPrice(),
        ]);
        const bufferedGas = (rawGas * 12_000n + 9_999n) / 10_000n;
        const bufferedCost = bufferedGas * gasPrice;
        const buyerOkb = BigInt(balances.buyerOkbBalance);
        approvalGasSufficient = buyerOkb >= bufferedCost;
        approvalGasReport = `${rawGas} gas; ${bufferedGas} gas with 20% margin; ${formatUnits(bufferedCost, 18)} OKB required; buyer has ${formatUnits(buyerOkb, 18)} OKB at snapshot (${approvalGasSufficient ? 'sufficient' : 'insufficient'})`;
        approvalGasEstimateSucceeded = true;
      } catch (error) {
        approvalGasReport = `estimate failed — ${safeError(error)}`;
      }
    } else if (preflight.simulations?.stage === 'swap' && balances?.approvalGasEstimate && balances.gasPriceWei) {
      const bufferedGas = BigInt(balances.approvalGasEstimate);
      const bufferedCost = bufferedGas * BigInt(balances.gasPriceWei);
      approvalGasReport = `${bufferedGas} gas with 20% margin; ${formatUnits(bufferedCost, 18)} OKB required`;
    }
    print('Approval simulation', approvalSimulation);
    print('Approval gas + 20%', approvalGasReport);
    print('Final preflight state', preflight.status);
    print('Stage B', preflight.simulations?.stage === 'swap' ? (exactAllowance ? 'ran with exact pinned allowance' : 'INVALID — invariant violation') : 'not run');
    if (preflight.status === 'APPROVAL_REQUIRED' && minimumCoversInvoice && balanceSufficient && preflight.simulations?.approval === 'passed') {
      if (!approvalGasEstimateSucceeded) {
        print('Exact next action', 'Approval gas could not be estimated; do not approve yet. Restore RPC access and rerun this preflight.');
      } else if (approvalGasSufficient === false) {
        print('Exact next action', 'Buyer OKB is below the reported buffered transaction gas requirement; do not approve yet.');
      } else {
        print('Exact next action', `approval for ${LOCAL_MAINNET_PREFLIGHT_INPUT_BASE_UNITS} wNVDAx base units to ${spender}; never unlimited. This runner did not request a signature.`);
      }
    } else {
      print('Exact next action', redact(preflight.reason));
    }
    print('Authenticated OKX calls', apiObservations.filter((item) => item.path.includes('/aggregator/')).map((item) => `${item.path.split('/').at(-1)} HTTP ${item.httpStatus} / API ${item.apiCode ?? 'n/a'}`).join('; ') || 'none');
    return preflight.status === 'READY' || (preflight.status === 'APPROVAL_REQUIRED' && approvalGasEstimateSucceeded && approvalGasSufficient !== false) ? 0 : 1;
  } catch (error) {
    const apiError = error as { status?: unknown; apiCode?: unknown };
    const responseInfo = typeof apiError.status === 'number' || typeof apiError.apiCode === 'string'
      ? `HTTP ${String(apiError.status ?? 'n/a')} / API ${String(apiError.apiCode ?? 'n/a')}`
      : safeError(error);
    print('Preflight', `BLOCKED — ${responseInfo}`);
    const quoteResponse = [...apiObservations].reverse().find((item) => item.path.endsWith('/quote'));
    if (quoteResponse?.output) print('Fresh quote preview output', `${formatted(quoteResponse.output, 6)} (${quoteResponse.output} base units)`);
    const swapResponse = [...apiObservations].reverse().find((item) => item.path.endsWith('/swap'));
    if (swapResponse?.output) print('Fresh swap expected output', `${formatted(swapResponse.output, 6)} (${swapResponse.output} base units)`);
    if (swapResponse?.minimumReceive) print('Fresh swap minimum receive', `${formatted(swapResponse.minimumReceive, 6)} (${swapResponse.minimumReceive} base units)`);
    if (swapResponse?.router) print('Fresh swap router', swapResponse.router);
    if (swapResponse?.receiver) print('Fresh swap requested receiver', swapResponse.receiver);
    print('Authenticated OKX calls', apiObservations.map((item) => `${item.path.split('/').at(-1)} HTTP ${item.httpStatus} / API ${item.apiCode ?? 'n/a'}`).join('; ') || 'none');
    print('Transaction signing/broadcast', 'disabled; none sent');
    return 1;
  }
}
