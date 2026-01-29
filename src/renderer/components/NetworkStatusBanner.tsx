import React from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

function NetworkStatusBanner(): React.ReactElement | null {
  const { isOnline, wasOffline } = useNetworkStatus();

  // Show banner only when offline or just came back online
  if (isOnline && !wasOffline) {
    return null;
  }

  if (!isOnline) {
    return (
      <div className="network-banner network-banner-offline">
        <span className="network-banner-icon">!</span>
        <span className="network-banner-text">
          You are currently offline. Some features may not work.
        </span>
      </div>
    );
  }

  // Just came back online
  return (
    <div className="network-banner network-banner-online">
      <span className="network-banner-icon">{'\u2713'}</span>
      <span className="network-banner-text">
        Connection restored. You may need to refresh to see the latest data.
      </span>
    </div>
  );
}

export default NetworkStatusBanner;
