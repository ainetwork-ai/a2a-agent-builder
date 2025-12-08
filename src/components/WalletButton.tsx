'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectWallet } from '@coinbase/onchainkit/wallet';

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [showDisconnect, setShowDisconnect] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  // Close disconnect button when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setShowDisconnect(false);
      }
    };

    if (showDisconnect) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDisconnect]);

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
    <div ref={buttonRef} className="relative">
      <button
        onClick={() => {
          if (showDisconnect) {
            disconnect();
            setShowDisconnect(false);
          } else {
            setShowDisconnect(true);
          }
        }}
        className={`px-2.5 sm:px-4 h-[30px] sm:h-[40px] rounded-lg transition-all font-semibold shadow-md text-xs sm:text-base whitespace-nowrap flex items-center justify-center ${
          showDisconnect
            ? 'bg-red-500 text-white hover:bg-red-600'
            : 'bg-white border-2 border-blue-200 text-gray-700 hover:border-blue-300'
        }`}
        title={showDisconnect ? 'Click to disconnect' : 'Connected wallet'}
      >
        {showDisconnect ? (
          <span>Disconnect</span>
        ) : (
          <span className="font-mono">
            {address?.slice(0, 4)}...{address?.slice(-3)}
          </span>
        )}
      </button>
    </div>
  );
}
