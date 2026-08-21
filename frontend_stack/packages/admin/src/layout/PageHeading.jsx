import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PageHeadingContext = createContext(null);

export default function PageHeadingProvider({ children }) {
  const [heading, setHeading] = useState(null);
  const value = useMemo(() => ({ heading, setHeading }), [heading]);
  return <PageHeadingContext.Provider value={value}>{children}</PageHeadingContext.Provider>;
}

export function usePageHeading() {
  return useContext(PageHeadingContext)?.heading ?? null;
}

export function useSetPageHeading(title, crumb) {
  const context = useContext(PageHeadingContext);
  const setHeading = context?.setHeading;

  useEffect(() => {
    if (!setHeading) return undefined;
    if (!title) {
      setHeading(null);
      return undefined;
    }
    setHeading({ title, crumb: crumb ?? title });
    return () => setHeading(null);
  }, [setHeading, title, crumb]);
}
