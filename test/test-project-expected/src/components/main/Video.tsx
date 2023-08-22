import React, { lazy } from 'react';

export const Video = () => {
  const PaymentToolsReasons = lazy(() => import('./LazyButton'));

  return <PaymentToolsReasons />;
};
