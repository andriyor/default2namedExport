import React, { lazy } from 'react';

const Video = () => {
  const PaymentToolsReasons = lazy(() => import('./Button'));

  return <PaymentToolsReasons />;
};

export default Video;
