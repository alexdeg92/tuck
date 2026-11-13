import { useEffect, useState } from 'react';

const QUERY = '(width < 600px)';

export function usePhoneTier(): boolean {
  const [phone, setPhone] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => {
      setPhone(media.matches);
    };
    onChange();
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  return phone;
}
