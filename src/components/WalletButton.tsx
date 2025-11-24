'use client';

import { useAccount, useDisconnect } from 'wagmi';
import { ConnectWallet } from '@coinbase/onchainkit/wallet';

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  if (!isConnected) {
    return (
      <ConnectWallet
        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition font-semibold shadow-md"
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="px-4 py-2 bg-white border-2 border-blue-200 rounded-lg">
        <span className="text-sm font-mono text-gray-700">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
      </div>
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-semibold shadow-md"
      >
        Disconnect
      </button>
    </div>
  );
}
