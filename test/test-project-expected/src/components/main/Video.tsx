import React, { lazy } from 'react';

export const Video = () => {
  const PaymentToolsReasons = lazy(() => import('./Button'));

  return <PaymentToolsReasons />;
};
