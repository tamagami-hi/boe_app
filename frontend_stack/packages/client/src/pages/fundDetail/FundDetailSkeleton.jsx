import React from 'react';
import { Skeleton } from '@beonedge/shared';

export default function FundDetailSkeleton() {
  return (
    <div className="apk-detail-stack">
      <div className="apk-detail-main">
        <div className="apk-detail-hero">
          <Skeleton variant="text" width="30%" height={16} />
          <Skeleton variant="text" width="80%" height={36} delay={40} />
          <Skeleton variant="text" width="60%" height={14} delay={80} />
        </div>
        <div className="be-card apk-detail-skel-card">
          <Skeleton variant="text" width="40%" height={20} />
          <Skeleton variant="text" width="100%" height={120} delay={40} />
        </div>
        <div className="be-card apk-detail-skel-card">
          <Skeleton variant="text" width="50%" height={20} />
          <Skeleton variant="text" width="100%" height={80} delay={40} />
        </div>
        <div className="be-card apk-detail-skel-card">
          <Skeleton variant="text" width="40%" height={20} />
          <Skeleton variant="text" width="100%" height={60} delay={40} />
        </div>
      </div>
    </div>
  );
}
