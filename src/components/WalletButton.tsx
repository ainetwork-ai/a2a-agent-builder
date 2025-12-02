'use client';

import { useAccount, useDisconnect } from 'wagmi';
import { ConnectWallet } from '@coinbase/onchainkit/wallet';

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  if (!isConnected) {
    return (
      <ConnectWallet
        render={({ label, onClick, isLoading }) => (
          <button
            onClick={onClick}
            className="px-2.5 sm:px-4 h-[30px] sm:h-[40px] bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition font-semibold shadow-md text-xs sm:text-base whitespace-nowrap flex justify-center items-center"
            title="Connect Wallet"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 sm:h-5 sm:w-5 text-white sm:mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="hidden sm:inline">Connecting...</span>
              </>
            ) : (
              <>
                <span className="hidden sm:inline">{label || 'Connect Wallet'}</span>
                <span className="sm:hidden">Connect</span>
              </>
            )}
          </button>
        )}
      />
    );
  }

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <div className="px-2 sm:px-4 bg-white border-2 border-blue-200 rounded-lg h-[30px] sm:h-[40px] flex items-center">
        <span className="text-xs sm:text-sm font-mono text-gray-700">
          {address?.slice(0, 4)}...{address?.slice(-3)}
        </span>
      </div>
      <button
        onClick={() => disconnect()}
        className="px-2 sm:px-4 h-[30px] sm:h-[40px] bg-red-500 text-white rounded-lg hover:bg-red-600 transition font-semibold shadow-md text-xs sm:text-base whitespace-nowrap flex items-center justify-center"
        title="Disconnect Wallet"
      >
        <span className="hidden sm:inline">Disconnect</span>
        <span className="sm:hidden">✕</span>
      </button>
    </div>
  );
}
