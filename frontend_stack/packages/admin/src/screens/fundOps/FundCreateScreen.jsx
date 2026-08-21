import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import I from '../../components/I.jsx';
import FundProfileForm from './FundProfileForm.jsx';
import { EMPTY_PROFILE } from './fundOpsModel.js';
import '../admin-screens-shared.css';

export default function FundCreateScreen({ onCreate }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);

  async function create(payload) {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    try {
      const fundId = await onCreate?.(payload);
      if (fundId) {
        navigate(`/admin/funds/${fundId}`, { replace: true });
        return;
      }
      navigate('/admin/funds', { replace: true });
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="adm-screen adm-screen--narrow">
      <Link className="be-btn be-btn-ghost be-btn-sm adm-back-link" to="/admin/funds">
        <I icon={ArrowLeft} size={14} /> Back to funds
      </Link>

      <FundProfileForm
        initial={EMPTY_PROFILE}
        mode="create"
        submitLabel="Create fund"
        busy={busy}
        onSubmit={create}
        onCancel={() => navigate('/admin/funds')}
      />
    </div>
  );
}
