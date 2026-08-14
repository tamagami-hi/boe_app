import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

// Was methods on the shell-wide data provider, so a screen had to mount a
// six-collection repository just to link to a user record. This is navigation.
// openUserDetail is a route, not an overlay: the old overlay left the URL on the
// directory, so the detail could not be linked or refreshed and Android Back
// navigated the page underneath it.
export function useAdminNavigation() {
  const navigate = useNavigate();

  const openUserDetail = useCallback((rowOrId) => {
    const id = rowOrId?.userId || rowOrId?.user_id || rowOrId?.id || rowOrId;
    if (id) navigate(`/admin/users/directory/${encodeURIComponent(id)}`);
  }, [navigate]);

  const navigateToUsers = useCallback(() => {
    navigate('/admin/users/directory');
  }, [navigate]);

  return useMemo(() => ({ openUserDetail, navigateToUsers }), [openUserDetail, navigateToUsers]);
}

export default useAdminNavigation;
