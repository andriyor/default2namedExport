import React, { lazy } from 'react';

const Video = () => {
  const PaymentToolsReasons = lazy(() => import('./LazyButton'));

  return <PaymentToolsReasons />;
};

export default Video;
