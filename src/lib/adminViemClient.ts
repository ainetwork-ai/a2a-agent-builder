import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

/**
 * Base mainnet chainId. SIWE messages must use this chainId.
 */
export const EXPECTED_CHAIN_ID = 8453;

const DEFAULT_RPC_URL = 'https://mainnet.base.org';

type AdminViemClient = ReturnType<typeof createBaseClient>;

function createBaseClient() {
  const rpcUrl = process.env.ADMIN_RPC_URL || DEFAULT_RPC_URL;
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

let cachedClient: AdminViemClient | null = null;

/**
 * Returns a cached viem PublicClient connected to Base mainnet.
 *
 * Uses ADMIN_RPC_URL env var if set, otherwise falls back to the official
 * Base public RPC (rate-limited; replace with a paid RPC for production).
 *
 * The returned client supports `verifyMessage()` which transparently handles
 * EOA, EIP-1271 (deployed smart wallets), and ERC-6492 (counterfactual smart
 * wallets) signatures via the universalSignatureValidator contract.
 */
export function getAdminViemClient(): AdminViemClient {
  if (!cachedClient) {
    cachedClient = createBaseClient();
  }
  return cachedClient;
}
