import { http, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    coinbaseWallet({
      appName: 'A2A Agent Builder',
      preference: 'all', // smartWalletOnly, eoaOnly, all
    }),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true, // Enable Server-Side Rendering support
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
