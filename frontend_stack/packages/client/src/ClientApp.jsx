import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import ClientLayout from './layout/ClientLayout.jsx';

import Splash from './pages/Splash.jsx';
import Login from './pages/Login.jsx';
import KycVerify from './pages/KycVerify.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Explore from './pages/Explore.jsx';
import FundDetail from './pages/FundDetail.jsx';
import StartSipSheet from './pages/StartSipSheet.jsx';
import LumpsumSheet from './pages/LumpsumSheet.jsx';
import PaymentStatus from './pages/PaymentStatus.jsx';
import MandateAuth from './pages/MandateAuth.jsx';
import MandateDetail from './pages/MandateDetail.jsx';
import Portfolio from './pages/Portfolio.jsx';
import WithdrawalRequests from './pages/WithdrawalRequests.jsx';
import Transactions from './pages/Transactions.jsx';
import Statements from './pages/Statements.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import KycDetail from './pages/KycDetail.jsx';
import Security from './pages/Security.jsx';
import Support from './pages/Support.jsx';
import Legal from './pages/Legal.jsx';
import InvestorCharter from './pages/InvestorCharter.jsx';
import GrievanceRedressal from './pages/GrievanceRedressal.jsx';
import { useSession } from './store/SessionContext.jsx';
import { getInvestingEligibility } from './services/eligibilityApi.js';
import { RouteErrorBoundary } from '@beonedge/shared/components/RouteErrorBoundary.jsx';
import AppUpdateGate from './components/AppUpdateGate.jsx';
import './styles/mobile/index.css';

// Execution routes (invest / pay / authorize a mandate) require investing
// eligibility. Eligibility is derived server-side on every read — never trust a
// stored status — so this gate asks `GET /v1/client/eligibility` and sends
// `canInvest=false` users to the email-verification (KYC OTP) step. If the
// check itself fails we let the user through: order/SIP creation enforces the
// same rule server-side, so a failed check must not lock the app.
function RequireApproved({ children }) {
  const { user, isLoading } = useSession();
  const [check, setCheck] = useState({ done: false, canInvest: null });

  useEffect(() => {
    if (isLoading || !user) return;
    let cancelled = false;
    getInvestingEligibility()
      .then((eligibility) => {
        if (!cancelled) setCheck({ done: true, canInvest: eligibility?.canInvest !== false });
      })
      .catch(() => {
        if (!cancelled) setCheck({ done: true, canInvest: null });
      });
    return () => {
      cancelled = true;
    };
  }, [user, isLoading]);

  if (isLoading || !user || !check.done) return null;
  if (check.canInvest === false) return <Navigate to="/app/verify-email" replace />;
  return children;
}

export default function ClientApp() {
  return (
    <>
      {/*
        Mounted above the routes so a required update can also be enforced on the
        login screen; it renders nothing while the splash is on screen, and
        nothing at all on the web build where there is no APK to update.
      */}
      <AppUpdateGate />
      <Routes>
      <Route index element={<Navigate to="splash" replace />} />
      <Route element={<ClientLayout />}>
        <Route path="splash" element={<RouteErrorBoundary><Splash /></RouteErrorBoundary>} />
        <Route path="login" element={<RouteErrorBoundary><Login /></RouteErrorBoundary>} />
        <Route path="verify-email" element={<RouteErrorBoundary><KycVerify /></RouteErrorBoundary>} />
        <Route path="start" element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<RouteErrorBoundary><Dashboard /></RouteErrorBoundary>} />
        <Route path="explore" element={<RouteErrorBoundary><Explore /></RouteErrorBoundary>} />
        <Route path="funds/:fundId" element={<RouteErrorBoundary><FundDetail /></RouteErrorBoundary>} />
        <Route path="invest/sip/:fundId" element={<RequireApproved><RouteErrorBoundary><StartSipSheet /></RouteErrorBoundary></RequireApproved>} />
        <Route path="invest/lumpsum/:fundId" element={<RequireApproved><RouteErrorBoundary><LumpsumSheet /></RouteErrorBoundary></RequireApproved>} />
        <Route path="payment/:paymentId" element={<RequireApproved><RouteErrorBoundary><PaymentStatus /></RouteErrorBoundary></RequireApproved>} />
        <Route path="mandates/:mandateId/authorize" element={<RequireApproved><RouteErrorBoundary><MandateAuth /></RouteErrorBoundary></RequireApproved>} />
        <Route path="mandates/:mandateId" element={<RouteErrorBoundary><MandateDetail /></RouteErrorBoundary>} />
        <Route path="portfolio" element={<RouteErrorBoundary><Portfolio /></RouteErrorBoundary>} />
        <Route path="withdrawals" element={<RouteErrorBoundary><WithdrawalRequests /></RouteErrorBoundary>} />
        <Route path="transactions" element={<RouteErrorBoundary><Transactions /></RouteErrorBoundary>} />
        <Route path="statements" element={<RouteErrorBoundary><Statements /></RouteErrorBoundary>} />
        <Route path="notifications" element={<RouteErrorBoundary><Notifications /></RouteErrorBoundary>} />
        <Route path="profile" element={<RouteErrorBoundary><Profile /></RouteErrorBoundary>} />
        <Route path="profile/kyc" element={<RouteErrorBoundary><KycDetail /></RouteErrorBoundary>} />
        <Route path="profile/security" element={<RouteErrorBoundary><Security /></RouteErrorBoundary>} />
        <Route path="profile/support" element={<RouteErrorBoundary><Support /></RouteErrorBoundary>} />
        <Route path="profile/legal" element={<RouteErrorBoundary><Legal /></RouteErrorBoundary>} />
        <Route path="investor-charter" element={<RouteErrorBoundary><InvestorCharter /></RouteErrorBoundary>} />
        <Route path="grievance" element={<RouteErrorBoundary><GrievanceRedressal /></RouteErrorBoundary>} />
      </Route>
      <Route path="*" element={<Navigate to="splash" replace />} />
      </Routes>
    </>
  );
}
